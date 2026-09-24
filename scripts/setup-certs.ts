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
 *
 * No `openssl`: the certificate work is `node:crypto` in ./cert-chain.ts, so
 * this runs on Windows too.
 */

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
import { rootCertificates } from "node:tls";
import { fileURLToPath } from "node:url";
import {
	chainProblem,
	derToPem,
	issuerUrl,
	keyProblem,
	notAfter,
} from "./cert-chain.ts";
import { lanUrlLines, localIpHostname } from "./lan-urls.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CERT_DIR = join(ROOT, "certs");
const CERT_PATH = join(CERT_DIR, "cert.pem");
const KEY_PATH = join(CERT_DIR, "key.pem");
const BASE = "https://local-ip.co/cert";

/** Single source of truth for the port, shared with vite.config.ts. */
const PORT: number = JSON.parse(
	readFileSync(join(ROOT, "package.json"), "utf8"),
).config.port;

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

async function download(name: string): Promise<string> {
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
async function fetchIssuer(leafPem: string): Promise<string> {
	const url = issuerUrl(leafPem);
	if (!url) throw new Error("Leaf certificate has no CA Issuers URI in AIA");

	const response = await fetch(url, { redirect: "follow" });
	if (!response.ok) throw new Error(`${url} returned ${response.status}`);

	return derToPem(Buffer.from(await response.arrayBuffer()));
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
async function dnsProblem(
	hostname: string,
	expectedIp: string,
): Promise<string | null> {
	try {
		const { address } = await dns.lookup(hostname, { family: 4 });
		return address === expectedIp
			? null
			: `resolved to ${address}, expected ${expectedIp}`;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code ?? String(error);
	}
}

/**
 * iOS rejects a bad chain with a generic "cannot verify server identity" that
 * tells you nothing, so every chain is checked here, on the machine that can
 * fix it. Null when the chain is usable, otherwise why it is not.
 */
const chainIssue = (chain: string, hostname: string): string | null =>
	chainProblem(chain, hostname, rootCertificates, new Date());

async function buildCerts(hostname: string): Promise<boolean> {
	console.log("Fetching certificate from local-ip.co ...");
	const [leaf, key] = await Promise.all([
		download("server.pem"),
		download("server.key"),
	]);

	// Build and check the whole chain in memory, then write once. Anything
	// written earlier — a leaf before its issuer, a chain before its check —
	// is exactly what `npm run dev` would happily serve to a phone. The key is
	// a second download, so a rotation in between can leave it not matching.
	const chain = `${leaf.trim()}\n${(await fetchIssuer(leaf)).trim()}\n`;
	const issue = chainIssue(chain, hostname) ?? keyProblem(chain, key);
	if (issue) {
		console.error(
			`Built a certificate chain that is not usable for ${hostname}:\n` +
				`  ${issue}\n` +
				"Refusing to write one that iOS would reject. This usually means\n" +
				"local-ip.co changed something — see\n" +
				"llm-knowledge/platform/lan-https-cert-chain.md",
		);
		return false;
	}

	writeFileSync(CERT_PATH, chain);
	writeFileSync(KEY_PATH, key, { mode: 0o600 });
	console.log(
		`Wrote ./certs (valid until ${notAfter(chain)?.toDateString()}).`,
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

	const hostname = localIpHostname(ip);
	mkdirSync(CERT_DIR, { recursive: true });

	// A cert that is in date but whose chain no longer verifies must be rebuilt.
	// That is exactly the state a stale chain.pem left behind.
	const existing = existsSync(CERT_PATH)
		? readFileSync(CERT_PATH, "utf8")
		: null;
	const issue = existing === null ? null : chainIssue(existing, hostname);
	if (issue) {
		// Gone before the rebuild, so a failed rebuild cannot leave it behind
		// for `npm run dev` to serve. A chain that is fine but close to expiry
		// stays: it still works if the rebuild fails.
		console.log(`Discarding ./certs: ${issue}`);
		rmSync(CERT_PATH, { force: true });
		rmSync(KEY_PATH, { force: true });
	}

	const expiry = existing === null || issue ? null : notAfter(existing);
	if (expiry && expiry.getTime() - Date.now() > RENEW_WITHIN_DAYS * 864e5) {
		console.log(`Reusing ./certs (valid until ${expiry.toDateString()}).`);
	} else if (!(await buildCerts(hostname))) {
		process.exitCode = 1;
		return;
	}

	console.log(`\n${lanUrlLines([`https://${ip}:${PORT}/`]).join("\n")}\n`);

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
