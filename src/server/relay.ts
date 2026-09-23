/**
 * Wires real `ws` sockets to `Lobby`. `Lobby` owns all state; this file only
 * translates socket events into `Lobby` calls, and `Lobby` outcomes into
 * wire messages. See llm-knowledge/reference/wire-protocol.md and
 * llm-knowledge/decisions/0005-raw-websockets-over-socket-io.md.
 */

import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Server as HttpsServer } from "node:https";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import {
	type ControllerBoundMessage,
	type HostBoundMessage,
	type PlayerId,
	parseControllerMessage,
	parseHostMessage,
	RELAY_PATH,
} from "../shared/protocol.ts";
import { Lobby } from "./lobby.ts";

export interface RelayOptions {
	lobby?: Lobby;
	/**
	 * How often the server pings each socket; a peer that misses one full
	 * interval is terminated (the canonical `ws` heartbeat pattern — one
	 * interval is both the ping cadence and the timeout). 15s is an
	 * unmeasured policy default, not a platform constant — revisit once
	 * llm-knowledge/platform/ios-safari-tab-suspension.md's "Untested"
	 * question has real numbers behind it.
	 */
	pingIntervalMs?: number;
}

export interface Relay {
	wss: WebSocketServer;
	close(): void;
}

const DEFAULT_PING_INTERVAL_MS = 15_000;

export function attachRelay(
	server: HttpServer | HttpsServer,
	options: RelayOptions = {},
): Relay {
	const lobby = options.lobby ?? new Lobby();
	const pingIntervalMs = options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
	// `noServer` plus our own upgrade listener, and NOT `{ server }` — with
	// or without `path`.
	//
	// Given `{ server }`, `ws` installs an upgrade listener that answers
	// EVERY upgrade on that server. Adding `path` does not make it decline
	// the others: `ws` calls `abortHandshake(socket, 400)` on them
	// (`websocket-server.js`, `shouldHandle`), which destroys a socket that
	// was never its business. This server is shared with Vite, whose HMR
	// socket lives on `/`, so that 400 killed HMR and left the host page
	// reload-looping — watched happening on 2026-09-21 AFTER `path` had been
	// added, which is how the difference was found. See
	// `llm-knowledge/platform/one-port-one-websocket-path.md`.
	//
	// Returning from the listener instead leaves the socket untouched for
	// whoever else is listening.
	const wss = new WebSocketServer({ noServer: true });

	const onUpgrade = (
		req: IncomingMessage,
		socket: Duplex,
		head: Buffer,
	): void => {
		// `req.url` is a path with an optional query, never absolute, so the
		// base here is only to satisfy `URL` and is never used.
		const { pathname } = new URL(req.url ?? "/", "http://relay.invalid");
		if (pathname !== RELAY_PATH) return;
		wss.handleUpgrade(req, socket, head, (ws) => {
			wss.emit("connection", ws, req);
		});
	};
	server.on("upgrade", onUpgrade);

	// The host is a single connection, tracked here rather than in Lobby, so
	// Lobby stays socket-free. connsByPlayer is the equivalent for controllers,
	// needed to route host-originated `feedback` to the right phone.
	let hostSocket: WebSocket | null = null;
	const connsByPlayer = new Map<PlayerId, WebSocket>();
	const alive = new WeakMap<WebSocket, boolean>();

	const sendTo = (
		ws: WebSocket,
		msg: ControllerBoundMessage | HostBoundMessage,
	) => {
		if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
	};

	/** One snapshot, sent to everyone who cares — the phones and the host.
	 * See `HostBoundMessage`'s note on why the host gets a snapshot and not
	 * a stream of joined/left/ready deltas. */
	const broadcastLobby = () => {
		const msg: ControllerBoundMessage & HostBoundMessage = {
			t: "lobby",
			players: lobby.players(),
		};
		for (const ws of connsByPlayer.values()) sendTo(ws, msg);
		if (hostSocket) sendTo(hostSocket, msg);
	};

	function handleHandshake(ws: WebSocket, raw: string) {
		const controllerMsg = parseControllerMessage(raw);
		if (controllerMsg?.t === "hello") {
			const outcome = lobby.connectController(ws, {
				v: controllerMsg.v,
				// Spread, not assign: exactOptionalPropertyTypes forbids an explicit
				// `resume: undefined` on an optional property.
				...(controllerMsg.resume !== undefined
					? { resume: controllerMsg.resume }
					: {}),
			});
			if (!outcome.ok) {
				sendTo(ws, { t: "rejected", reason: outcome.reason });
				ws.close();
				return;
			}
			connsByPlayer.set(outcome.playerId, ws);
			sendTo(ws, {
				t: "assigned",
				playerId: outcome.playerId,
				side: outcome.side,
			});
			broadcastLobby();
			return;
		}

		const hostMsg = parseHostMessage(raw);
		if (hostMsg?.t === "host-hello") {
			if (!lobby.connectHost(ws, { v: hostMsg.v })) {
				ws.close();
				return;
			}
			hostSocket = ws;
			// A host that just connected knows nothing about who is already
			// in the lobby. Tell it before it has to ask.
			broadcastLobby();
			return;
		}

		// Neither a controller hello nor a host hello: this connection never
		// identified itself, so it never entered Lobby state and there is
		// nothing to unwind.
		ws.terminate();
	}

	function handleControllerMessage(
		playerId: PlayerId,
		ws: WebSocket,
		raw: string,
	) {
		const msg = parseControllerMessage(raw);
		if (!msg || msg.t === "hello") return; // duplicate hello after handshake: ignore

		switch (msg.t) {
			case "ready": {
				if (!lobby.setReady(ws, msg.ready)) return;
				broadcastLobby();
				return;
			}
			case "aim":
				if (hostSocket) {
					sendTo(hostSocket, {
						t: "aim",
						playerId,
						aim: { yaw: msg.yaw, pitch: msg.pitch },
					});
				}
				return;
			case "swing":
				if (hostSocket) {
					sendTo(hostSocket, {
						t: "swing",
						playerId,
						// Field by field, not a spread of `msg`, so the `t`
						// discriminator never leaks into the swing. Every new
						// `Swing` field has to be added here — see
						// `tests/integration/relay.test.ts`, which is the thing
						// that notices when one is not. Spread, not assign, for
						// exactOptionalPropertyTypes.
						swing: {
							kind: msg.kind,
							power: msg.power,
							at: msg.at,
							...(msg.spin !== undefined ? { spin: msg.spin } : {}),
							...(msg.lag !== undefined ? { lag: msg.lag } : {}),
						},
					});
				}
				return;
		}
	}

	function handleHostMessage(raw: string) {
		const msg = parseHostMessage(raw);
		if (!msg) return;
		if (msg.t === "feedback") {
			const target = connsByPlayer.get(msg.playerId);
			if (target) sendTo(target, { t: "feedback", kind: msg.kind });
			return;
		}
		if (msg.t === "match") {
			// Spread, not assign: `winner` is optional and
			// exactOptionalPropertyTypes forbids an explicit undefined.
			const out: ControllerBoundMessage = {
				t: "match",
				phase: msg.phase,
				server: msg.server,
				...(msg.winner !== undefined ? { winner: msg.winner } : {}),
				...(msg.score !== undefined ? { score: msg.score } : {}),
			};
			for (const ws of connsByPlayer.values()) sendTo(ws, out);
		}
		// A duplicate host-hello falls through: nothing to do.
	}

	wss.on("connection", (ws: WebSocket) => {
		alive.set(ws, true);
		ws.on("pong", () => alive.set(ws, true));

		// Not optional, and not merely tidy. `ws` raises `error` on this
		// socket for a malformed FRAME — a half-written close frame from a
		// client that died mid-send is enough — and Node's rule for an
		// unhandled 'error' event is to throw it, which ends the process.
		// That is the whole server: the host page, every controller, the
		// relay. Watched happening on 2026-09-21 with
		// `Invalid WebSocket frame: invalid status code 51066`.
		//
		// `protocol.ts` insists everything off a socket is untrusted and
		// guards the JSON. This is the layer underneath, where a guest on
		// bad Wi-Fi could otherwise end the party. Drop the socket, keep
		// the game: `close` follows and does the lobby bookkeeping.
		ws.on("error", () => ws.terminate());

		ws.on("message", (data: WebSocket.RawData) => {
			const raw = data.toString();
			const playerId = lobby.playerIdFor(ws);
			if (playerId !== null) {
				handleControllerMessage(playerId, ws, raw);
			} else if (lobby.isHost(ws)) {
				handleHostMessage(raw);
			} else {
				handleHandshake(ws, raw);
			}
		});

		ws.on("close", () => {
			const playerId = lobby.disconnectController(ws);
			if (playerId !== null) {
				if (connsByPlayer.get(playerId) === ws) connsByPlayer.delete(playerId);
				broadcastLobby();
				return;
			}
			if (lobby.disconnectHost(ws)) hostSocket = null;
		});
	});

	// Same rule one level up: an error on the server (a failed upgrade, a
	// socket that dies during the handshake) is just as fatal unhandled.
	wss.on("error", () => {});

	const heartbeat = setInterval(() => {
		for (const ws of wss.clients) {
			if (alive.get(ws) === false) {
				ws.terminate();
				continue;
			}
			alive.set(ws, false);
			ws.ping();
		}
	}, pingIntervalMs);

	return {
		wss,
		close() {
			clearInterval(heartbeat);
			// Ours to remove: we added it, and a preview server outliving a
			// relay would otherwise keep a dead handler on its upgrade path.
			server.off("upgrade", onUpgrade);
			for (const ws of wss.clients) ws.terminate();
			wss.close();
		},
	};
}
