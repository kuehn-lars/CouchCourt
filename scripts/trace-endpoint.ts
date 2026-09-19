/**
 * Dev-only POST endpoint that saves a recorded `MotionTrace` to
 * `tests/fixtures/motion/`. Wired into `vite.config.ts` only when actually
 * serving a browser (see the `serving` constant there) — this writes to
 * disk, so it must never be alive under `vitest run` or `vite build`.
 */

import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";
import {
	formatTrace,
	isTrace,
	nextTraceName,
} from "../src/shared/swing/trace.ts";

const MAX_BODY_BYTES = 4 * 1024 * 1024;

export function traceEndpoint(dir: string): Plugin {
	return {
		name: "swingcourt-trace-endpoint",
		apply: "serve",
		configureServer(server) {
			server.middlewares.use("/__trace", (req, res) => {
				if (req.method !== "POST") {
					res.statusCode = 405;
					res.end();
					return;
				}

				const chunks: Buffer[] = [];
				let bytes = 0;
				let settled = false;

				req.on("data", (chunk: Buffer) => {
					if (settled) return;
					bytes += chunk.length;
					if (bytes > MAX_BODY_BYTES) {
						settled = true;
						req.destroy();
						res.statusCode = 413;
						res.end();
						return;
					}
					chunks.push(chunk);
				});

				// An aborted connection (e.g. a phone losing wifi mid-upload) must
				// not crash the dev server with an unhandled stream error.
				req.on("error", () => {
					if (settled) return;
					settled = true;
					res.statusCode = 400;
					res.end();
				});

				req.on("end", () => {
					if (settled) return;
					settled = true;

					let parsed: unknown;
					try {
						parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
					} catch {
						res.statusCode = 400;
						res.end();
						return;
					}

					if (!isTrace(parsed)) {
						res.statusCode = 400;
						res.end();
						return;
					}

					// isTrace has already narrowed `label` to the fixed TraceLabel
					// union, so the filename below is built from a known-closed set
					// of strings — no client-supplied string ever reaches the
					// filesystem path. That is why there is no traversal surface here.
					try {
						const existing = readdirSync(dir);
						const name = nextTraceName(existing, parsed.label);
						writeFileSync(join(dir, name), formatTrace(parsed));
						res.statusCode = 200;
						res.setHeader("content-type", "application/json");
						res.end(JSON.stringify({ file: name }));
					} catch (err) {
						res.statusCode = 500;
						res.end(err instanceof Error ? err.message : "write failed");
					}
				});
			});
		},
	};
}
