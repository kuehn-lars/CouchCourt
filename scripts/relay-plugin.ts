/**
 * Dev-only Vite plugin attaching the WebSocket relay to Vite's own
 * `httpServer`, so dev and production share one port and one code path —
 * see the NOTE this replaces in `vite.config.ts` and
 * llm-knowledge/decisions/0002-host-authoritative-simulation.md.
 */

import type { Server as HttpServer } from "node:http";
import type { Server as HttpsServer } from "node:https";
import type { Plugin } from "vite";
import { attachRelay } from "../src/server/relay.ts";

export function relayPlugin(): Plugin {
	return {
		name: "swingcourt-relay",
		apply: "serve",
		configureServer(server) {
			const httpServer = server.httpServer;
			if (!httpServer) return;
			// Vite's own type also allows an Http2SecureServer, for a config
			// option (`server.http2`) this project's vite.config.ts never sets —
			// TLS here is always a plain https.Server (decision 0004). `ws` only
			// supports http.Server/https.Server, matching what we actually run.
			const relay = attachRelay(httpServer as HttpServer | HttpsServer);
			httpServer.once("close", () => relay.close());
		},
	};
}
