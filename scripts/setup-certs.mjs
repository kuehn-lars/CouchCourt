#!/usr/bin/env node
/**
 * Generates the TLS material the dev server needs, into ./certs (gitignored).
 *
 * WHY THIS EXISTS: iOS refuses DeviceMotion outside a secure context, so the
 * phone must reach the host over HTTPS. A self-signed cert means every guest
 * installs a root CA before they can play, which is a wall in front of a party
 * game. Instead we use local-ip.co: `<lan-ip-with-dashes>.my.local-ip.co`
 * resolves to that LAN IP, and they publish a real publicly-trusted wildcard
 * cert for `*.my.local-ip.co`. Guests scan the QR and it just works.
 *
 * Knowledge vault:
 *   llm-knowledge/decisions/0004-lan-https-via-local-ip-co.md   why this approach
 *   llm-knowledge/platform/lan-https-cert-chain.md              why AIA, not chain.pem
 *   llm-knowledge/platform/lan-https-dns-rebind.md              why the DNS check exists
 */

import { execFileSync } from "node:child_process";
import { promises as dns } from "node:dns";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CERT_DIR = join(ROOT, "certs");
const CERT_PATH = join(CERT_DIR, "cert.pem");
const KEY_PATH = join(CERT_DIR, "key.pem");
const BASE = "https://local-ip.co/cert";

/** Single source of truth for the port, shared with vite.config.ts. */
const PORT = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).config
	.port;

/** Rebuild when fewer than this many days of validity remain. */
const RENEW_WITHIN_DAYS = 7;

/** The address guests' phones have to reach. Loopback is useless here. */
function lanIPv4() {
	for (const addresses of Object.values(networkInterfaces())) {
		for (const address of addresses ?? []) {
			if (address.family === "IPv4" && !address.internal)
				return address.address;
		}
	}
	return null;
}

async function download(name) {
	const response = await fetch(`${BASE}/${name}`, { redirect: "follow" });
	if (!response.ok) {
		throw new Error(`${BASE}/${name} returned ${response.status}`);
	}
	const text = await response.text();
	if (!text.includes("-----BEGIN")) {
		throw new Error(`${BASE}/${name} did not return PEM data`);
	}
	return text;
}

const openssl = (args, input) =>
	execFileSync("openssl", args, { input, encoding: "utf8" });

/**
 * The intermediate that actually signed the leaf, read from the leaf's own
 * Authority Information Access extension.
 *
 * We deliberately do NOT use local-ip.co's published chain.pem. It was stale on
 * 2026-09-19 — Sectigo intermediates for a leaf GlobalSign had issued — which
 * yields a chain macOS papers over via AIA fetching and iOS Safari rejects.
 * Reading AIA from the leaf follows whatever issuer is current, so this
 * survives the next rotation too.
 */
async function fetchIssuer(leafPem) {
	const extension = openssl(
		["x509", "-noout", "-ext", "authorityInfoAccess"],
		leafPem,
	);
	const url = /URI:(http:\/\/\S+?\.crt)/.exec(extension)?.[1];
	if (!url) throw new Error("Leaf certificate has no CA Issuers URI in AIA");

	const response = await fetch(url, { redirect: "follow" });
	if (!response.ok) throw new Error(`${url} returned ${response.status}`);

	// AIA serves DER; everything downstream wants PEM.
	return openssl(
		["x509", "-inform", "DER", "-outform", "PEM"],
		Buffer.from(await response.arrayBuffer()),
	);
}

/**
 * iOS rejects a chain that is incomplete, mismatched, or not valid for the name
 * being opened — and it does so with a generic "cannot verify server identity"
 * that tells you nothing. Checking here turns that into a real message on the
 * machine that can fix it.
 *
 * `-verify_hostname` matters as much as the chain itself: a chain can be
 * perfectly valid and still be for the wrong name, which is precisely what
 * would happen if local-ip.co reissued as `*.local-ip.co` and our two-label
 * hostname stopped matching the wildcard.
 */
function chainIsUsable(certPath, hostname) {
	try {
		execFileSync(
			"openssl",
			[
				"verify",
				"-verify_hostname",
				hostname,
				"-untrusted",
				certPath,
				certPath,
			],
			{ stdio: "pipe" },
		);
		return true;
	} catch {
		return false;
	}
}

function certNotAfter(pemPath) {
	try {
		const out = openssl(["x509", "-in", pemPath, "-noout", "-enddate"]);
		return new Date(out.replace("notAfter=", "").trim());
	} catch {
		return null;
	}
}

/**
 * Many home routers (AVM FritzBox out of the box, among others) run DNS rebind
 * protection, which silently drops any public DNS answer pointing into the
 * local subnet. That is exactly what local-ip.co does, so the name resolves
 * from the open internet but not from the sofa. Catching it here turns a
 * baffling "Safari cannot open the page" into one actionable sentence.
 *
 * Returns null when resolution is fine, otherwise the reason it is not.
 */
async function dnsProblem(hostname, expectedIp) {
	try {
		const { address } = await dns.lookup(hostname, { family: 4 });
		return address === expectedIp
			? null
			: `resolved to ${address}, expected ${expectedIp}`;
	} catch (error) {
		return error.code ?? String(error);
	}
}

async function buildCerts(hostname) {
	console.log("Fetching certificate from local-ip.co ...");
	const [leaf, key] = await Promise.all([
		download("server.pem"),
		download("server.key"),
	]);

	// Build the whole chain in memory, then write once. Writing the leaf first
	// and appending later would leave a leaf-only chain on disk if the AIA fetch
	// failed — exactly the broken state this script exists to prevent.
	const issuer = await fetchIssuer(leaf);

	writeFileSync(CERT_PATH, `${leaf.trim()}\n${issuer.trim()}\n`);
	writeFileSync(KEY_PATH, key, { mode: 0o600 });

	if (!chainIsUsable(CERT_PATH, hostname)) {
		// Leave nothing behind that `npm run dev` would happily serve to a phone.
		rmSync(CERT_PATH, { force: true });
		rmSync(KEY_PATH, { force: true });
		console.error(
			`Built a certificate chain that is not usable for ${hostname}.\n` +
				"Refusing to leave one behind that iOS would reject. This usually means\n" +
				"local-ip.co changed something — see\n" +
				"llm-knowledge/platform/lan-https-cert-chain.md",
		);
		return false;
	}

	const expiry = certNotAfter(CERT_PATH);
	console.log(
		`Wrote ./certs${expiry ? ` (valid until ${expiry.toDateString()})` : ""}.`,
	);
	return true;
}

async function main() {
	const ip = lanIPv4();
	if (!ip) {
		console.error("No non-loopback IPv4 address found. Are you on Wi-Fi?");
		process.exitCode = 1;
		return;
	}

	const hostname = `${ip.replaceAll(".", "-")}.my.local-ip.co`;
	mkdirSync(CERT_DIR, { recursive: true });

	const expiry = existsSync(CERT_PATH) ? certNotAfter(CERT_PATH) : null;
	// A cert that is in date but whose chain no longer verifies must be rebuilt.
	// That is exactly the state a stale chain.pem left behind.
	const reusable =
		expiry &&
		expiry.getTime() - Date.now() > RENEW_WITHIN_DAYS * 864e5 &&
		chainIsUsable(CERT_PATH, hostname);

	if (reusable) {
		console.log(`Reusing ./certs (valid until ${expiry.toDateString()}).`);
	} else if (!(await buildCerts(hostname))) {
		process.exitCode = 1;
		return;
	}

	console.log(`\n  Host:       https://${hostname}:${PORT}/host/`);
	console.log(`  Controller: https://${hostname}:${PORT}/controller/\n`);

	const problem = await dnsProblem(hostname, ip);
	if (problem) {
		console.warn(
			`WARNING: ${hostname} does not resolve on this network (${problem}).\n` +
				"This is almost always DNS rebind protection on your router, which\n" +
				"drops public DNS answers that point into your own LAN.\n\n" +
				"  FritzBox: Home Network > Network > Network Settings >\n" +
				"            DNS Rebind Protection > add `my.local-ip.co`\n\n" +
				"It is a one-time change on the router and fixes every device on the\n" +
				"network at once, so guests still do not have to configure anything.\n" +
				"See llm-knowledge/platform/lan-https-dns-rebind.md\n",
		);
		// Setup is genuinely incomplete: the phone cannot reach the host yet.
		process.exitCode = 1;
	}
}

await main();
