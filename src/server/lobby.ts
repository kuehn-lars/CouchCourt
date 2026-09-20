/**
 * Slot and session state for one match. No sockets, no timers — a pure state
 * machine over opaque connection tokens, so it is unit-testable without a
 * real `ws` server. `relay.ts` is the only caller and owns the sockets.
 *
 * See llm-knowledge/reference/wire-protocol.md and
 * llm-knowledge/decisions/0005-raw-websockets-over-socket-io.md.
 */

import { randomUUID } from "node:crypto";
import {
	type LobbyPlayer,
	type PlayerId,
	PROTOCOL_VERSION,
	type Side,
} from "../shared/protocol.ts";

/** Any object reference works — `relay.ts` passes the `WebSocket` instance itself. */
export type Conn = object;

export type HelloOutcome =
	| { ok: true; playerId: PlayerId; side: Side; players: LobbyPlayer[] }
	| { ok: false; reason: "full" | "bad-version" | "unknown-session" };

const SIDES: readonly Side[] = ["near", "far"];

export class Lobby {
	#players = new Map<PlayerId, LobbyPlayer>();
	#connToPlayer = new Map<Conn, PlayerId>();
	#hostConn: Conn | null = null;
	#newId: () => PlayerId;

	constructor(newId: () => PlayerId = randomUUID) {
		this.#newId = newId;
	}

	players(): LobbyPlayer[] {
		return [...this.#players.values()];
	}

	connectController(
		conn: Conn,
		hello: { v: number; resume?: PlayerId },
	): HelloOutcome {
		if (hello.v !== PROTOCOL_VERSION)
			return { ok: false, reason: "bad-version" };

		if (hello.resume !== undefined) {
			const player = this.#players.get(hello.resume);
			if (!player) return { ok: false, reason: "unknown-session" };
			// Drop any stale mapping for this player from a socket that has not
			// closed yet — iOS may resume on a new socket before the old one's
			// close event arrives, if it ever does.
			for (const [existingConn, playerId] of this.#connToPlayer) {
				if (playerId === player.playerId)
					this.#connToPlayer.delete(existingConn);
			}
			player.connected = true;
			this.#connToPlayer.set(conn, player.playerId);
			return {
				ok: true,
				playerId: player.playerId,
				side: player.side,
				players: this.players(),
			};
		}

		const takenSides = new Set([...this.#players.values()].map((p) => p.side));
		let side = SIDES.find((s) => !takenSides.has(s));

		if (!side) {
			// Both sides are spoken for, but one of those players is gone. A
			// slot held by a phone that is not here is how a living-room game
			// gets stuck: the battery dies, and nobody can play until someone
			// restarts the server.
			//
			// Reclaiming is safe against the case
			// `llm-knowledge/decisions/0006-relay-session-policy.md` was
			// protecting, because `resume` is handled above this and wins: a
			// player who comes back with their own `playerId` gets their own
			// side, and only a genuinely NEW phone can take an absent one.
			// The reclaimed session is deleted rather than left dangling, so
			// its owner is told `unknown-session` and rejoins as a newcomer
			// instead of being shadowed by whoever took their place.
			const absent = [...this.#players.values()].find((p) => !p.connected);
			if (!absent) return { ok: false, reason: "full" };
			this.#players.delete(absent.playerId);
			for (const [conn, playerId] of this.#connToPlayer) {
				if (playerId === absent.playerId) this.#connToPlayer.delete(conn);
			}
			side = absent.side;
		}

		const playerId = this.#newId();
		const player: LobbyPlayer = {
			playerId,
			side,
			ready: false,
			connected: true,
		};
		this.#players.set(playerId, player);
		this.#connToPlayer.set(conn, playerId);
		return { ok: true, playerId, side, players: this.players() };
	}

	setReady(conn: Conn, ready: boolean): LobbyPlayer[] | null {
		const playerId = this.#connToPlayer.get(conn);
		if (playerId === undefined) return null;
		const player = this.#players.get(playerId);
		if (!player) return null;
		player.ready = ready;
		return this.players();
	}

	disconnectController(conn: Conn): PlayerId | null {
		const playerId = this.#connToPlayer.get(conn);
		if (playerId === undefined) return null;
		this.#connToPlayer.delete(conn);
		const player = this.#players.get(playerId);
		if (player) player.connected = false;
		return playerId;
	}

	playerIdFor(conn: Conn): PlayerId | null {
		return this.#connToPlayer.get(conn) ?? null;
	}

	connectHost(conn: Conn, hello: { v: number }): boolean {
		if (hello.v !== PROTOCOL_VERSION) return false;
		this.#hostConn = conn;
		return true;
	}

	disconnectHost(conn: Conn): boolean {
		if (this.#hostConn !== conn) return false;
		this.#hostConn = null;
		return true;
	}

	isHost(conn: Conn): boolean {
		return this.#hostConn === conn;
	}
}
