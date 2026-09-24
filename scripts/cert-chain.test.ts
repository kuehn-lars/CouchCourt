import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	chainProblem,
	derToPem,
	issuerUrl,
	keyProblem,
	notAfter,
} from "./cert-chain.ts";

// A throwaway root → intermediate → `*.my.local-ip.co` leaf, valid until 2126.
// How it was made: tests/fixtures/certs/README.md.
const fixture = (name: string) =>
	readFileSync(new URL(`../tests/fixtures/certs/${name}`, import.meta.url));
const pem = (name: string) => fixture(name).toString("utf8");

const root = pem("root.pem");
const intermediate = pem("intermediate.pem");
const leaf = pem("leaf.pem");
const HOST = "192-168-1-42.my.local-ip.co";
const NOW = new Date("2030-01-01T00:00:00Z");

describe("issuerUrl", () => {
	it("reads the CA Issuers URI from the leaf's AIA extension", () => {
		expect(issuerUrl(leaf)).toBe("http://ca.example.test/intermediate.crt");
	});

	it("is null when there is no AIA extension", () => {
		expect(issuerUrl(root)).toBeNull();
	});

	// Not "no CA Issuers URI" — that would send someone hunting for an AIA
	// problem when the download itself was broken.
	it("throws for something that is not a certificate", () => {
		expect(() => issuerUrl("not a certificate")).toThrow();
	});
});

describe("derToPem", () => {
	// AIA serves DER; the chain on disk is PEM.
	it("turns the DER an AIA URL serves into the same certificate as PEM", () => {
		expect(derToPem(fixture("intermediate.der")).trim()).toBe(
			intermediate.trim(),
		);
	});
});

describe("notAfter", () => {
	it("reads the leaf's expiry", () => {
		expect(notAfter(`${leaf}${intermediate}`)?.getUTCFullYear()).toBe(2126);
	});

	it("is null for something that is not a certificate", () => {
		expect(notAfter("not a certificate")).toBeNull();
	});
});

describe("chainProblem", () => {
	const chain = `${leaf}${intermediate}`;

	it("accepts a complete chain to a trusted root, for the right name", () => {
		expect(chainProblem(chain, HOST, [root], NOW)).toBeNull();
	});

	// The failure the script exists for: a leaf-only or stale chain.pem, which
	// macOS repairs by fetching AIA and iOS rejects.
	it("rejects a leaf without its intermediate", () => {
		expect(chainProblem(leaf, HOST, [root], NOW)).toMatch(
			/^no issuer for CN=\*\.my\.local-ip\.co/,
		);
	});

	it("rejects a chain that ends at a root nobody trusts", () => {
		expect(chainProblem(chain, HOST, [], NOW)).toMatch(
			/^no issuer for CN=Test Intermediate/,
		);
	});

	// A valid chain for the wrong name — what a reissue as `*.local-ip.co`
	// would silently produce.
	it("rejects a chain for a different hostname", () => {
		const other = `${pem("wrong-name-leaf.pem")}${intermediate}`;
		expect(chainProblem(other, HOST, [root], NOW)).toMatch(HOST);
	});

	// Same name as the real intermediate and no key identifier to tell them
	// apart, so only the signature check can see that it did not sign the leaf.
	it("rejects an intermediate that has the right name but did not sign the leaf", () => {
		const forged = `${leaf}${pem("impostor-intermediate.pem")}`;
		expect(chainProblem(forged, HOST, [root], NOW)).toMatch(
			/^no issuer for CN=\*\.my\.local-ip\.co/,
		);
	});

	it("rejects an expired chain", () => {
		const later = new Date("2200-01-01T00:00:00Z");
		expect(chainProblem(chain, HOST, [root], later)).toMatch(/expired/i);
	});

	it("rejects a chain that is not valid yet", () => {
		const earlier = new Date("2000-01-01T00:00:00Z");
		expect(chainProblem(chain, HOST, [root], earlier)).toMatch(
			/is not valid until/,
		);
	});

	// Same key and name as `root.pem`, but it expired in 2026 while the leaf
	// and intermediate run to 2126 — only the root's own dates are wrong.
	it("rejects a chain whose trusted root has expired", () => {
		const shortRoot = pem("short-lived-root.pem");
		expect(chainProblem(chain, HOST, [shortRoot], NOW)).toMatch(
			/^CN=Test Root expired/,
		);
	});

	it("rejects something that is not a certificate", () => {
		expect(chainProblem("garbage", HOST, [root], NOW)).not.toBeNull();
	});
});

describe("keyProblem", () => {
	// A matching keypair; the certs fixtures kept no private keys.
	const tlsCert = readFileSync(
		new URL("../tests/fixtures/tls/cert.pem", import.meta.url),
		"utf8",
	);
	const tlsKey = readFileSync(
		new URL("../tests/fixtures/tls/key.pem", import.meta.url),
		"utf8",
	);

	it("accepts the key that belongs to the certificate", () => {
		expect(keyProblem(tlsCert, tlsKey)).toBeNull();
	});

	// server.pem and server.key are two downloads. A rotation between them
	// gives a pair that fails every TLS handshake with no useful error.
	it("rejects a key that belongs to a different certificate", () => {
		expect(keyProblem(leaf, tlsKey)).toMatch(/does not match/);
	});

	it("rejects something that is not a key", () => {
		expect(keyProblem(leaf, "not a key")).toMatch(/unreadable/);
	});
});
