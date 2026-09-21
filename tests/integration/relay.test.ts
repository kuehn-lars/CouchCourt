/**
 * Real sockets, real server. Per
 * llm-knowledge/decisions/0005-raw-websockets-over-socket-io.md: "resume-by-
 * playerId is our code and must be tested. It is the first thing in
 * tests/integration/." This file is that.
 */

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { attachRelay, type RelayOptions } from "../../src/server/relay.ts";
import { PROTOCOL_VERSION, RELAY_PATH } from "../../src/shared/protocol.ts";

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
	/** The live relay, so a test can reach a real server-side socket. */
	relay: ReturnType<typeof attachRelay>;
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
		await run({ url: `ws://127.0.0.1:${port}${RELAY_PATH}`, relay });
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
			await nextMessages(host, 1); // the empty lobby, sent on connect

			const ws1 = await connect(url);
			send(ws1, { t: "hello", v: PROTOCOL_VERSION });
			const [assigned] = (await nextMessages(ws1, 1)) as [
				{ playerId: string; side: string },
			];
			const playerId = assigned.playerId;
			expect(assigned.side).toBe("near");
			await nextMessages(host, 1); // lobby, with the player in it

			ws1.close();
			await waitClose(ws1);
			await nextMessages(host, 1); // lobby, now empty again

			const ws1b = await connect(url);
			send(ws1b, { t: "hello", v: PROTOCOL_VERSION, resume: playerId });
			const [resumed] = await nextMessages(ws1b, 1);
			expect(resumed).toEqual({ t: "assigned", playerId, side: "near" });
			await nextMessages(host, 1); // lobby, with the resumed player

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
			await nextMessages(host, 1); // the empty lobby, sent on connect

			const ws1 = await connect(url);
			send(ws1, { t: "hello", v: PROTOCOL_VERSION });
			const [assigned] = (await nextMessages(ws1, 1)) as [{ playerId: string }];
			await nextMessages(host, 1); // lobby, with the player in it

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
			await nextMessages(host, 1); // the empty lobby, sent on connect

			const ws1 = await connect(url);
			send(ws1, { t: "hello", v: PROTOCOL_VERSION });
			const [assigned] = (await nextMessages(ws1, 1)) as [{ playerId: string }];
			await nextMessages(host, 1); // lobby, with the player in it

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
			const [hostLobby] = await nextMessages(host, 1);
			expect(hostLobby).toEqual(lobbyUpdate);

			send(host, { t: "feedback", playerId: assigned.playerId, kind: "hit" });
			const [feedback] = await nextMessages(ws1, 1);
			expect(feedback).toEqual({ t: "feedback", kind: "hit" });
		}));
});

describe("relay — liveness", () => {
	it("terminates a socket that goes silent and tells the host it disconnected", () =>
		withRelay({ pingIntervalMs: 30 }, async ({ url }) => {
			const host = await connect(url);
			send(host, { t: "host-hello", v: PROTOCOL_VERSION });
			await nextMessages(host, 1); // the empty lobby, sent on connect

			const ws1 = await connect(url);
			send(ws1, { t: "hello", v: PROTOCOL_VERSION });
			const [assigned] = (await nextMessages(ws1, 1)) as [{ playerId: string }];
			await nextMessages(host, 1); // lobby, with the player in it

			// Simulate iOS suspending the tab: the socket goes dark with no close
			// frame, so it can't answer the server's pings either. Pausing the
			// underlying TCP socket for reading stops it processing anything the
			// server sends, including ping frames — the only way to fake "gone
			// dark" with a real socket rather than a mock.
			// biome-ignore lint/suspicious/noExplicitAny: `_socket` is not part of ws's public types
			(ws1 as any)._socket.pause();

			const [left] = await nextMessages(host, 1);
			expect(left).toEqual({
				t: "lobby",
				players: [
					{
						playerId: assigned.playerId,
						side: "near",
						ready: false,
						connected: false,
					},
				],
			});
		}));
});

describe("relay — swing forwarding", () => {
	it("forwards a swing's spin to the host", () =>
		withRelay({}, async ({ url }) => {
			const host = await connect(url);
			send(host, { t: "host-hello", v: PROTOCOL_VERSION });
			await nextMessages(host, 1); // the empty lobby, sent on connect

			const phone = await connect(url);
			send(phone, { t: "hello", v: PROTOCOL_VERSION });
			const [assigned] = (await nextMessages(phone, 1)) as [
				{ playerId: string },
			];
			await nextMessages(host, 1); // lobby, with the player in it

			send(phone, {
				t: "swing",
				kind: "forehand",
				power: 0.5,
				at: 42,
				spin: -0.6,
			});
			const [forwarded] = await nextMessages(host, 1);

			// The relay rebuilds the swing field by field rather than passing
			// the message through, so every new field has to be added here too
			// — this test is the thing that notices when one is not.
			expect(forwarded).toEqual({
				t: "swing",
				playerId: assigned.playerId,
				swing: { kind: "forehand", power: 0.5, at: 42, spin: -0.6 },
			});
		}));

	// And the warning above came true the day `lag` was added: the host
	// back-dates a swing by it, so a relay that drops it silently undoes the
	// whole of 0013 and every swing reads late again.
	it("forwards a swing's lag to the host", () =>
		withRelay({}, async ({ url }) => {
			const host = await connect(url);
			send(host, { t: "host-hello", v: PROTOCOL_VERSION });
			await nextMessages(host, 1);

			const phone = await connect(url);
			send(phone, { t: "hello", v: PROTOCOL_VERSION });
			const [assigned] = (await nextMessages(phone, 1)) as [
				{ playerId: string },
			];
			await nextMessages(host, 1);

			send(phone, {
				t: "swing",
				kind: "backhand",
				power: 0.5,
				at: 42,
				lag: 180,
			});
			const [forwarded] = await nextMessages(host, 1);

			expect(forwarded).toEqual({
				t: "swing",
				playerId: assigned.playerId,
				swing: { kind: "backhand", power: 0.5, at: 42, lag: 180 },
			});
		}));
});

// Found by watching the game run, not by reading the code: an abruptly
// killed client left a half-written frame, `ws` raised `Invalid WebSocket
// frame: invalid status code 51066` on that socket, and because nothing was
// listening for `error` Node's unhandled-'error' rule threw and took the
// WHOLE server down — host page, every controller, the relay, the lot.
//
// `protocol.ts` makes a point of treating everything off a socket as
// untrusted, and it does, at the JSON layer. The FRAME layer underneath it
// was not guarded at all, and one guest on flaky Wi-Fi could end the party.
// The relay shares a port and an origin with Vite, and Vite runs its own
// WebSocket server there for HMR. A `WebSocketServer` with no `path` answers
// EVERY upgrade on the server it is attached to, so both answered the HMR
// handshake, the browser got two overlapping responses — `Invalid frame
// header` — and the host page sat in a reload loop on "server connection
// lost". Found by watching the game run; no test could see it, because every
// test connected to the relay's own URL and got the relay.
describe("relay — the port is shared, so the path is not", () => {
	// The property that matters is not "a client on another path fails". `ws`
	// will happily give you that by answering 400 and destroying the socket,
	// which is precisely the bug: it kills Vite's HMR socket on its way past.
	// The property is that somebody ELSE'S upgrade handler still gets called.
	it("leaves another upgrade handler on the same server its own upgrades", async () => {
		const httpServer = createServer();
		await new Promise<void>((resolve) => httpServer.listen(0, resolve));
		const { port } = httpServer.address() as AddressInfo;
		const relay = attachRelay(httpServer, {});

		// Stands in for Vite's HMR server: a second listener on the same
		// server, on its own path. It closes with a code nothing else uses,
		// which is the only way to tell who actually completed the handshake
		// — BOTH listeners are called either way, because that is what an
		// EventEmitter does, so "was my listener called" proves nothing.
		const OTHERS_CLOSE_CODE = 4001;
		const other = new WebSocketServer({ noServer: true });
		httpServer.on("upgrade", (req, socket, head) => {
			if (!req.url?.startsWith("/hmr")) return;
			other.handleUpgrade(req, socket, head, (ws) =>
				ws.close(OTHERS_CLOSE_CODE),
			);
		});

		try {
			const ws = new WebSocket(`ws://127.0.0.1:${port}/hmr?token=abc`);
			openSockets.push(ws);
			const outcome = await new Promise<string>((resolve) => {
				ws.once("close", (code) => resolve(`closed ${code}`));
				ws.once("error", (e) => resolve(`killed: ${e.message}`));
				setTimeout(() => resolve("never answered"), 2000);
			});

			expect(outcome).toBe(`closed ${OTHERS_CLOSE_CODE}`);
		} finally {
			for (const ws of openSockets.splice(0)) ws.terminate();
			other.close();
			relay.close();
			await new Promise<void>((resolve) => httpServer.close(() => resolve()));
		}
	});

	it("still answers its own path", () =>
		withRelay({}, async ({ url }) => {
			const ws = await connect(url);
			send(ws, { t: "hello", v: PROTOCOL_VERSION });
			expect((await nextMessages(ws, 1))[0]).toMatchObject({ t: "assigned" });
		}));
});

describe("relay — a broken client must not take the server with it", () => {
	it("survives a socket error and keeps serving everyone else", () =>
		withRelay({}, async ({ url, relay }) => {
			const host = await connect(url);
			send(host, { t: "host-hello", v: PROTOCOL_VERSION });
			await nextMessages(host, 1);

			const phone = await connect(url);
			send(phone, { t: "hello", v: PROTOCOL_VERSION });
			await nextMessages(phone, 1);
			await nextMessages(host, 1);

			// Exactly what Node does to an unhandled 'error': raise it on a
			// live server socket and see whether the process is still here.
			const victim = [...relay.wss.clients][0];
			expect(victim).toBeDefined();
			victim?.emit("error", new RangeError("Invalid WebSocket frame"));

			// The other socket is untouched and the relay still relays.
			const second = await connect(url);
			send(second, { t: "hello", v: PROTOCOL_VERSION });
			const [assigned] = await nextMessages(second, 1);
			expect(assigned).toMatchObject({ t: "assigned" });
		}));
});

describe("relay — lobby snapshots and match state", () => {
	it("gives the host the whole lobby, on connect and on every change", () =>
		withRelay({}, async ({ url }) => {
			const host = await connect(url);
			send(host, { t: "host-hello", v: PROTOCOL_VERSION });

			// A host that reloads mid-lobby has to learn who is already here.
			// Incremental joined/left events cannot tell it that.
			const [empty] = await nextMessages(host, 1);
			expect(empty).toEqual({ t: "lobby", players: [] });

			const phone = await connect(url);
			send(phone, { t: "hello", v: PROTOCOL_VERSION });
			const [joined] = await nextMessages(host, 1);
			expect(joined).toMatchObject({
				t: "lobby",
				players: [{ side: "near", ready: false, connected: true }],
			});

			send(phone, { t: "ready", ready: true });
			const [readied] = await nextMessages(host, 1);
			expect(readied).toMatchObject({
				t: "lobby",
				players: [{ side: "near", ready: true }],
			});
		}));

	it("broadcasts the host's match state to every phone", () =>
		withRelay({}, async ({ url }) => {
			const host = await connect(url);
			send(host, { t: "host-hello", v: PROTOCOL_VERSION });
			await nextMessages(host, 1); // the empty lobby

			const phone = await connect(url);
			send(phone, { t: "hello", v: PROTOCOL_VERSION });
			await nextMessages(phone, 2); // assigned, lobby
			await nextMessages(host, 1); // lobby

			send(host, { t: "match", phase: "playing", server: "far" });
			const [match] = await nextMessages(phone, 1);
			expect(match).toEqual({ t: "match", phase: "playing", server: "far" });
		}));
});
