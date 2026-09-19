#!/usr/bin/env node
/**
 * Generates the TLS material the dev server needs, into ./certs (gitignored).
 *
 * WHY THIS EXISTS: iOS refuses DeviceMotion outside a secure context, so the
 * phone must reach the host over HTTPS. A self-signed cert means every guest
 * installs a root CA before they can play, which is a wall in front of a party
 * game. Instead we use local-ip.co: `<lan-ip-with-dashes>.my.local-ip.co`
 * resolves to that LAN IP, and they publish a real GlobalSign-issued wildcard
 * cert for `*.my.local-ip.co`. Guests scan the QR and it just works.
 *
 * Tradeoffs, verified 2026-09-19 — see llm-knowledge/decisions/0004:
 *   - The private key is PUBLIC by design. This buys browser trust, not
 *     secrecy. Anyone on your LAN could MITM the session. Fine for a game,
 *     never for anything else.
 *   - The cert is short-lived (~6 months). Re-run this script when it expires.
 *   - First resolution needs internet, and some routers block it outright.
 */

import { execFileSync } from "node:child_process";
import { promises as dns } from "node:dns";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CERT_DIR = join(ROOT, "certs");
const BASE = "https://local-ip.co/cert";

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

function certNotAfter(pemPath) {
	try {
		const out = execFileSync(
			"openssl",
			["x509", "-in", pemPath, "-noout", "-enddate"],
			{ encoding: "utf8" },
		);
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
 */
async function checkRebindProtection(hostname, expectedIp) {
	try {
		const { address } = await dns.lookup(hostname, { family: 4 });
		return address === expectedIp
			? { ok: true }
			: { ok: false, reason: `resolved to ${address}, expected ${expectedIp}` };
	} catch (error) {
		return { ok: false, reason: error.code ?? String(error) };
	}
}

async function main() {
	const ip = lanIPv4();
	if (!ip) {
		console.error("No non-loopback IPv4 address found. Are you on Wi-Fi?");
		process.exit(1);
	}

	const hostname = `${ip.replaceAll(".", "-")}.my.local-ip.co`;
	mkdirSync(CERT_DIR, { recursive: true });

	const certPath = join(CERT_DIR, "cert.pem");
	const keyPath = join(CERT_DIR, "key.pem");

	const existing = existsSync(certPath) ? certNotAfter(certPath) : null;
	const stillValid = existing && existing.getTime() - Date.now() > 7 * 864e5;

	if (stillValid) {
		console.log(`Reusing ./certs (valid until ${existing.toDateString()}).`);
	} else {
		console.log("Fetching certificate from local-ip.co ...");
		// The leaf alone is not enough: iOS rejects an incomplete chain, so the
		// GlobalSign intermediates have to be concatenated onto it.
		const [leaf, intermediates, key] = await Promise.all([
			download("server.pem"),
			download("chain.pem"),
			download("server.key"),
		]);
		writeFileSync(certPath, `${leaf.trim()}\n${intermediates.trim()}\n`);
		writeFileSync(keyPath, key, { mode: 0o600 });

		const expiry = certNotAfter(certPath);
		console.log(
			`Wrote ./certs${expiry ? ` (valid until ${expiry.toDateString()})` : ""}.`,
		);
	}

	const dnsCheck = await checkRebindProtection(hostname, ip);
	console.log(`\n  Host:       https://${hostname}:5173/host/`);
	console.log(`  Controller: https://${hostname}:5173/controller/\n`);

	if (!dnsCheck.ok) {
		console.warn(
			`WARNING: ${hostname} does not resolve on this network (${dnsCheck.reason}).\n` +
				"This is almost always DNS rebind protection on your router, which\n" +
				"drops public DNS answers that point into your own LAN.\n\n" +
				"  FritzBox: Home Network > Network > Network Settings >\n" +
				"            DNS Rebind Protection > add `my.local-ip.co`\n\n" +
				"It is a one-time change on the router and fixes every device on the\n" +
				"network at once, so guests still do not have to configure anything.\n" +
				"See llm-knowledge/platform/lan-https-dns-rebind.md\n",
		);
		process.exitCode = 1;
	}
}

await main();
