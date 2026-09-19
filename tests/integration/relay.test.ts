/**
 * Real sockets, real server. Per
 * llm-knowledge/decisions/0005-raw-websockets-over-socket-io.md: "resume-by-
 * playerId is our code and must be tested. It is the first thing in
 * tests/integration/." This file is that.
 */

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { attachRelay, type RelayOptions } from "../../src/server/relay.ts";
import { PROTOCOL_VERSION } from "../../src/shared/protocol.ts";

const TIMEOUT_MS = 2000;

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`timed out waiting for ${label}`)),
			TIMEOUT_MS,
		);
		promise.then(
			(v) => {
				clearTimeout(timer);
				resolve(v);
			},
			(e) => {
				clearTimeout(timer);
				reject(e);
			},
		);
	});
}

function nextMessages(ws: WebSocket, n: number): Promise<unknown[]> {
	return withTimeout(
		new Promise((resolve) => {
			const out: unknown[] = [];
			const onMessage = (data: WebSocket.RawData) => {
				out.push(JSON.parse(data.toString()));
				if (out.length === n) {
					ws.off("message", onMessage);
					resolve(out);
				}
			};
			ws.on("message", onMessage);
		}),
		`${n} message(s)`,
	);
}

function waitOpen(ws: WebSocket): Promise<void> {
	return withTimeout(
		new Promise((resolve) => ws.once("open", () => resolve())),
		"open",
	);
}

function waitClose(ws: WebSocket): Promise<void> {
	return withTimeout(
		new Promise((resolve) => ws.once("close", () => resolve())),
		"close",
	);
}

const openSockets: WebSocket[] = [];

async function connect(url: string): Promise<WebSocket> {
	const ws = new WebSocket(url);
	openSockets.push(ws);
	await waitOpen(ws);
	return ws;
}

function send(ws: WebSocket, msg: unknown): void {
	ws.send(JSON.stringify(msg));
}

interface Ctx {
	url: string;
}

async function withRelay(
	options: RelayOptions,
	run: (ctx: Ctx) => Promise<void>,
): Promise<void> {
	const httpServer = createServer();
	await new Promise<void>((resolve) => httpServer.listen(0, resolve));
	const { port } = httpServer.address() as AddressInfo;
	const relay = attachRelay(httpServer, options);
	try {
		await run({ url: `ws://127.0.0.1:${port}` });
	} finally {
		for (const ws of openSockets.splice(0)) ws.terminate();
		relay.close();
		await new Promise<void>((resolve) => httpServer.close(() => resolve()));
	}
}

describe("relay — controller handshake", () => {
	it("assigns near then far, and rejects a third controller as full", () =>
		withRelay({}, async ({ url }) => {
			const ws1 = await connect(url);
			send(ws1, { t: "hello", v: PROTOCOL_VERSION });
			const [assigned1] = await nextMessages(ws1, 1);
			expect(assigned1).toEqual({
				t: "assigned",
				playerId: expect.any(String),
				side: "near",
			});

			const ws2 = await connect(url);
			send(ws2, { t: "hello", v: PROTOCOL_VERSION });
			const [assigned2] = await nextMessages(ws2, 1);
			expect(assigned2).toMatchObject({ t: "assigned", side: "far" });

			const ws3 = await connect(url);
			send(ws3, { t: "hello", v: PROTOCOL_VERSION });
			const [rejected] = await nextMessages(ws3, 1);
			expect(rejected).toEqual({ t: "rejected", reason: "full" });
			await waitClose(ws3);
		}));

	it("rejects a mismatched protocol version and closes the socket", () =>
		withRelay({}, async ({ url }) => {
			const ws = await connect(url);
			send(ws, { t: "hello", v: PROTOCOL_VERSION + 1 });

			const [rejected] = await nextMessages(ws, 1);
			expect(rejected).toEqual({ t: "rejected", reason: "bad-version" });
			await waitClose(ws);
		}));

	it("terminates a connection whose first message is not a hello", () =>
		withRelay({}, async ({ url }) => {
			const ws = await connect(url);
			send(ws, { t: "aim", yaw: 0, pitch: 0 });

			await waitClose(ws);
		}));
});

describe("relay — resume", () => {
	it("reattaches a resumed player to its original side and identity", () =>
		withRelay({}, async ({ url }) => {
			const host = await connect(url);
			send(host, { t: "host-hello", v: PROTOCOL_VERSION });

			const ws1 = await connect(url);
			send(ws1, { t: "hello", v: PROTOCOL_VERSION });
			const [assigned] = (await nextMessages(ws1, 1)) as [
				{ playerId: string; side: string },
			];
			const playerId = assigned.playerId;
			expect(assigned.side).toBe("near");
			await nextMessages(host, 1); // player-joined

			ws1.close();
			await waitClose(ws1);
			await nextMessages(host, 1); // player-left

			const ws1b = await connect(url);
			send(ws1b, { t: "hello", v: PROTOCOL_VERSION, resume: playerId });
			const [resumed] = await nextMessages(ws1b, 1);
			expect(resumed).toEqual({ t: "assigned", playerId, side: "near" });
			await nextMessages(host, 1); // player-joined (again)

			send(ws1b, {
				t: "swing",
				kind: "forehand",
				power: 0.8,
				at: 123,
			});
			const [swing] = await nextMessages(host, 1);
			expect(swing).toEqual({
				t: "swing",
				playerId,
				swing: { kind: "forehand", power: 0.8, at: 123 },
			});
		}));
});

describe("relay — identity and routing", () => {
	it("attaches playerId server-side and never trusts a client-claimed one", () =>
		withRelay({}, async ({ url }) => {
			const host = await connect(url);
			send(host, { t: "host-hello", v: PROTOCOL_VERSION });

			const ws1 = await connect(url);
			send(ws1, { t: "hello", v: PROTOCOL_VERSION });
			const [assigned] = (await nextMessages(ws1, 1)) as [{ playerId: string }];
			await nextMessages(host, 1); // player-joined

			// A controller message carries no playerId at all — the guard in
			// protocol.ts would reject one that tried to add one.
			send(ws1, { t: "aim", yaw: 0.5, pitch: -0.1 });
			const [aim] = await nextMessages(host, 1);
			expect(aim).toEqual({
				t: "aim",
				playerId: assigned.playerId,
				aim: { yaw: 0.5, pitch: -0.1 },
			});
		}));

	it("routes ready state and host feedback to the right sockets", () =>
		withRelay({}, async ({ url }) => {
			const host = await connect(url);
			send(host, { t: "host-hello", v: PROTOCOL_VERSION });

			const ws1 = await connect(url);
			send(ws1, { t: "hello", v: PROTOCOL_VERSION });
			const [assigned] = (await nextMessages(ws1, 1)) as [{ playerId: string }];
			await nextMessages(host, 1); // player-joined

			send(ws1, { t: "ready", ready: true });
			const [lobbyUpdate] = await nextMessages(ws1, 1);
			expect(lobbyUpdate).toEqual({
				t: "lobby",
				players: [
					{
						playerId: assigned.playerId,
						side: "near",
						ready: true,
						connected: true,
					},
				],
			});
			const [playerReady] = await nextMessages(host, 1);
			expect(playerReady).toEqual({
				t: "player-ready",
				playerId: assigned.playerId,
				ready: true,
			});

			send(host, { t: "feedback", playerId: assigned.playerId, kind: "hit" });
			const [feedback] = await nextMessages(ws1, 1);
			expect(feedback).toEqual({ t: "feedback", kind: "hit" });
		}));
});

describe("relay — liveness", () => {
	it("terminates a socket that goes silent and tells the host it left", () =>
		withRelay({ pingIntervalMs: 30 }, async ({ url }) => {
			const host = await connect(url);
			send(host, { t: "host-hello", v: PROTOCOL_VERSION });

			const ws1 = await connect(url);
			send(ws1, { t: "hello", v: PROTOCOL_VERSION });
			const [assigned] = (await nextMessages(ws1, 1)) as [{ playerId: string }];
			await nextMessages(host, 1); // player-joined

			// Simulate iOS suspending the tab: the socket goes dark with no close
			// frame, so it can't answer the server's pings either. Pausing the
			// underlying TCP socket for reading stops it processing anything the
			// server sends, including ping frames — the only way to fake "gone
			// dark" with a real socket rather than a mock.
			// biome-ignore lint/suspicious/noExplicitAny: `_socket` is not part of ws's public types
			(ws1 as any)._socket.pause();

			const [left] = await nextMessages(host, 1);
			expect(left).toEqual({ t: "player-left", playerId: assigned.playerId });
		}));
});
