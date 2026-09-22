/**
 * Seam 2: the relay has to be alive in production, not only under
 * `npm run dev`. Production is `vite preview` serving `dist/`, so the same
 * plugin has to attach to the preview server's `httpServer` too.
 *
 * This is the test for that hop, and it is a real socket against a real
 * server rather than an assertion that the hook exists — a hook that is
 * present and wires nothing would pass the second and fail a player.
 */

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "vitest";
import { WebSocket } from "ws";
import { relayPlugin } from "../../scripts/relay-plugin.ts";
import { PROTOCOL_VERSION, RELAY_PATH } from "../../src/shared/protocol.ts";

const TIMEOUT_MS = 2000;

function firstMessage(ws: WebSocket): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error("timed out waiting for a message")),
			TIMEOUT_MS,
		);
		ws.once("message", (data: WebSocket.RawData) => {
			clearTimeout(timer);
			resolve(JSON.parse(data.toString()));
		});
	});
}

it("attaches the relay to a preview server, so `vite preview` is playable", async () => {
	const httpServer = createServer();
	await new Promise<void>((resolve) => httpServer.listen(0, resolve));
	const { port } = httpServer.address() as AddressInfo;

	const plugin = relayPlugin();
	const hook = plugin.configurePreviewServer;
	expect(typeof hook).toBe("function");
	// Vite hands the hook a PreviewServer; the relay only reads `httpServer`.
	(hook as (s: { httpServer: typeof httpServer }) => void).call(plugin, {
		httpServer,
	});

	const ws = new WebSocket(`ws://127.0.0.1:${port}${RELAY_PATH}`);
	await new Promise<void>((resolve) => ws.once("open", () => resolve()));
	ws.send(JSON.stringify({ t: "hello", v: PROTOCOL_VERSION }));

	expect(await firstMessage(ws)).toMatchObject({ t: "assigned", side: "near" });

	ws.close();
	await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});
