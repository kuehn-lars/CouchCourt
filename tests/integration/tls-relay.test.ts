/**
 * The relay has to survive the server Vite actually builds under HTTPS.
 *
 * `resolveHttpServer` in `vite/dist/node/chunks/config.js` returns
 * `http2.createSecureServer({ …, allowHTTP1: true })` for **any** `https`
 * option — dev and preview both. It is not an `https.Server`, which is the
 * only kind `ws` documents support, and the whole game runs over TLS because
 * iOS refuses motion sensors outside a secure context
 * (`llm-knowledge/platform/ios-motion-permission.md`). So: the one hop
 * nobody had checked, checked here, against the same server shape.
 *
 * See `llm-knowledge/platform/vite-https-is-http2.md`.
 */

import { readFileSync } from "node:fs";
import type { Server as HttpServer } from "node:http";
import { createSecureServer } from "node:http2";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { WebSocket } from "ws";
import { attachRelay } from "../../src/server/relay.ts";
import { PROTOCOL_VERSION, RELAY_PATH } from "../../src/shared/protocol.ts";

const fixture = (name: string) =>
	readFileSync(
		fileURLToPath(new URL(`../fixtures/tls/${name}`, import.meta.url)),
	);

it("relays over the http2+allowHTTP1 server Vite builds for https", async () => {
	const server = createSecureServer({
		key: fixture("key.pem"),
		cert: fixture("cert.pem"),
		allowHTTP1: true,
	});
	// Same cast, same reason, as `scripts/relay-plugin.ts`: `ws` types only
	// http/https servers, and this is exactly the shape Vite hands it.
	const relay = attachRelay(server as unknown as HttpServer);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;

	// Self-signed fixture, so no chain to verify — this test is about the
	// upgrade surviving http2, not about trust.
	const ws = new WebSocket(`wss://127.0.0.1:${port}${RELAY_PATH}`, {
		rejectUnauthorized: false,
	});
	await new Promise<void>((resolve, reject) => {
		ws.once("open", () => resolve());
		ws.once("error", reject);
	});
	ws.send(JSON.stringify({ t: "hello", v: PROTOCOL_VERSION }));

	const assigned = await new Promise<unknown>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("no assignment")), 2000);
		ws.once("message", (data: WebSocket.RawData) => {
			clearTimeout(timer);
			resolve(JSON.parse(data.toString()));
		});
	});
	expect(assigned).toMatchObject({ t: "assigned", side: "near" });

	ws.close();
	relay.close();
	await new Promise<void>((resolve) => server.close(() => resolve()));
});
