/**
 * Certificate chain checks for `npm run certs`, on `node:crypto` alone.
 *
 * These used to shell out to `openssl`, which macOS and Linux ship and Windows
 * does not. Node's `X509Certificate` covers everything the script needs, and
 * the caller passes `tls.rootCertificates` — the Mozilla store bundled with
 * Node — so the answer is the same on every machine.
 *
 * Roots and the clock are parameters, so the tests can use a throwaway chain.
 * Why the chain is rebuilt from AIA at all:
 * llm-knowledge/platform/lan-https-cert-chain.md
 */

import { createPrivateKey, X509Certificate } from "node:crypto";

const PEM_BLOCK =
	/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

/**
 * The URL the leaf names for its issuer (the AIA "CA Issuers" entry), or null
 * when it names none. Throws when `pem` is not a certificate at all.
 */
export function issuerUrl(pem: string): string | null {
	const access = new X509Certificate(pem).infoAccess ?? "";
	return /CA Issuers - URI:(\S+)/.exec(access)?.[1] ?? null;
}

/** AIA URLs serve DER; the chain on disk is PEM. */
export const derToPem = (der: Buffer): string =>
	new X509Certificate(der).toString();

/** When the first certificate in `pem` expires. */
export function notAfter(pem: string): Date | null {
	try {
		return new X509Certificate(pem).validToDate;
	} catch {
		return null;
	}
}

/**
 * Null when `keyPem` is the private key for the certificate in `certPem`,
 * otherwise why not. The leaf and its key are two separate downloads, and a
 * mismatched pair fails every TLS handshake without saying why.
 */
export function keyProblem(certPem: string, keyPem: string): string | null {
	try {
		return new X509Certificate(certPem).checkPrivateKey(
			createPrivateKey(keyPem),
		)
			? null
			: "the private key does not match the certificate";
	} catch (error) {
		return `unreadable key or certificate: ${String(error)}`;
	}
}

const signedBy = (child: X509Certificate, parent: X509Certificate) =>
	child.checkIssued(parent) && child.verify(parent.publicKey);

function validityProblem(cert: X509Certificate, now: Date): string | null {
	if (now > cert.validToDate)
		return `${cert.subject} expired on ${cert.validToDate.toDateString()}`;
	if (now < cert.validFromDate)
		return `${cert.subject} is not valid until ${cert.validFromDate.toDateString()}`;
	return null;
}

/**
 * Does `bundle` (leaf first, then intermediates) cover `hostname`, and chain
 * by signature to one of `roots` with every certificate on the way in date?
 * Null when it does, otherwise why not — iOS only ever says "cannot verify
 * server identity", so the reason has to come from here.
 *
 * The hostname matters as much as the chain: a chain can be perfectly valid
 * and still be for the wrong name, which is what a reissue as
 * `*.local-ip.co` would produce for our two-label hostname.
 *
 * Deliberately not a full path validation: basic constraints, key usage and
 * revocation are not checked. The chain comes from a public CA via AIA, and
 * what goes wrong in practice is a missing or stale intermediate, an expiry,
 * or the wrong name — the failures this names.
 */
export function chainProblem(
	bundle: string,
	hostname: string,
	roots: readonly string[],
	now: Date,
): string | null {
	let certs: X509Certificate[];
	let trusted: X509Certificate[];
	try {
		certs = (bundle.match(PEM_BLOCK) ?? []).map((b) => new X509Certificate(b));
		trusted = roots.map((r) => new X509Certificate(r));
	} catch (error) {
		return `unreadable certificate: ${String(error)}`;
	}

	const [leaf, ...pool] = certs;
	if (!leaf) return "no certificate found";
	if (!leaf.checkHost(hostname)) {
		return `the certificate is for ${leaf.subjectAltName ?? leaf.subject}, not ${hostname}`;
	}

	// Each step removes a certificate from the pool, so this ends.
	for (let cert = leaf; ; ) {
		const problem = validityProblem(cert, now);
		if (problem) return problem;

		const root = trusted.find((r) => signedBy(cert, r));
		if (root) return validityProblem(root, now);

		const next = pool.findIndex((c) => signedBy(cert, c));
		if (next === -1) {
			return `no issuer for ${cert.subject} in the chain or among the trusted roots (issued by ${cert.issuer})`;
		}
		[cert] = pool.splice(next, 1) as [X509Certificate];
	}
}
