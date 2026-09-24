/**
 * The URLs to open, printed in place of Vite's own `Local:` / `Network:`
 * lines, by both `npm run dev` and `npm start`.
 *
 * Vite prints `https://192.168.1.42:5173/`, but the certificate from
 * `npm run certs` covers `*.my.local-ip.co`, never a bare IP — so the address
 * Vite offers is the one that gets a certificate warning. Worse, the host page
 * puts its own origin in the join QR code, so a host opened at the IP hands
 * every phone a URL iOS will not trust. The local-ip.co name for the same
 * address is the one that works. Why that name:
 * llm-knowledge/decisions/0004-lan-https-via-local-ip-co.md
 *
 * `apply: "serve"` covers `vite preview` too, as it does for the relay.
 */

import type { Plugin, PreviewServer, ViteDevServer } from "vite";

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** The name local-ip.co resolves to `ip`, and the only kind the certificate covers. */
export const localIpHostname = (ip: string): string =>
	`${ip.replaceAll(".", "-")}.my.local-ip.co`;

/**
 * The host and controller URLs for each of Vite's network URLs, as lines to
 * print. Empty over plain HTTP, where the certificate is not in play and the
 * IP is as good as any name.
 */
export function lanUrlLines(networkUrls: readonly string[]): string[] {
	return networkUrls.flatMap((raw) => {
		const url = new URL(raw);
		if (url.protocol !== "https:" || !IPV4.test(url.hostname)) return [];
		const origin = `https://${localIpHostname(url.hostname)}:${url.port}`;
		return [
			`  ➜  Host:       ${origin}/host/`,
			`  ➜  Controller: ${origin}/controller/`,
		];
	});
}

function printLanUrls(server: ViteDevServer | PreviewServer): void {
	const printViteUrls = server.printUrls.bind(server);
	server.printUrls = () => {
		const lines = lanUrlLines(server.resolvedUrls?.network ?? []);
		// Nothing better to offer (plain HTTP, or no network): Vite's own
		// lines, and the "no certificates" warning above them, still stand.
		if (lines.length === 0) printViteUrls();
		else server.config.logger.info(lines.join("\n"));
	};
}

export function lanUrlsPlugin(): Plugin {
	return {
		name: "couchcourt-lan-urls",
		apply: "serve",
		configureServer: printLanUrls,
		configurePreviewServer: printLanUrls,
	};
}
