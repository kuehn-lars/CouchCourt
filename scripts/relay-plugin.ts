/**
 * Attaches the WebSocket relay to Vite's own `httpServer`, in **both** of the
 * servers Vite runs: `vite` (dev) and `vite preview` (production —
 * llm-knowledge/decisions/0010-vite-preview-as-production-server.md).
 * One port, one origin, one code path either way — see the NOTE this replaces
 * in `vite.config.ts` and
 * llm-knowledge/decisions/0002-host-authoritative-simulation.md.
 *
 * `apply: "serve"` covers preview as well as dev: Vite resolves a preview
 * config with command `serve`. That is the same sharp edge
 * llm-knowledge/platform/vitest-is-a-vite-serve.md records for Vitest, used
 * deliberately here instead of tripped over.
 */

import type { Server as HttpServer } from "node:http";
import type { Server as HttpsServer } from "node:https";
import type { Plugin } from "vite";
import { attachRelay } from "../src/server/relay.ts";

// The cast is load-bearing and the old comment here was wrong. Under HTTPS
// this is NOT an https.Server: Vite's `resolveHttpServer` returns
// `http2.createSecureServer({ …, allowHTTP1: true })` for any `https`
// option, in dev and preview alike. `ws` only types http/https servers, so
// the cast stays — and `tests/integration/tls-relay.test.ts` proves the
// upgrade survives on the real shape. See
// llm-knowledge/platform/vite-https-is-http2.md.
function attach(httpServer: HttpServer | HttpsServer | null): void {
	if (!httpServer) return;
	const relay = attachRelay(httpServer);
	httpServer.once("close", () => relay.close());
}

export function relayPlugin(): Plugin {
	return {
		name: "couchcourt-relay",
		apply: "serve",
		configureServer(server) {
			attach(server.httpServer as HttpServer | HttpsServer | null);
		},
		configurePreviewServer(server) {
			attach(server.httpServer as HttpServer | HttpsServer);
		},
	};
}
