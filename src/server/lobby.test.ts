import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "../shared/protocol.ts";
import { Lobby } from "./lobby.ts";

/** A fresh ids() call per test keeps assigned playerIds predictable without touching crypto. */
function ids(): () => string {
	let n = 0;
	return () => `p${++n}`;
}

describe("Lobby — controller slot assignment", () => {
	it("assigns the first controller to the near side", () => {
		const lobby = new Lobby(ids());
		const conn = {};

		const outcome = lobby.connectController(conn, { v: PROTOCOL_VERSION });

		expect(outcome).toEqual({
			ok: true,
			playerId: "p1",
			side: "near",
			players: [
				{ playerId: "p1", side: "near", ready: false, connected: true },
			],
		});
	});

	it("assigns the second controller to the far side", () => {
		const lobby = new Lobby(ids());
		lobby.connectController({}, { v: PROTOCOL_VERSION });

		const outcome = lobby.connectController({}, { v: PROTOCOL_VERSION });

		expect(outcome.ok).toBe(true);
		expect(outcome.ok && outcome.side).toBe("far");
	});

	it("rejects a third controller as full", () => {
		const lobby = new Lobby(ids());
		lobby.connectController({}, { v: PROTOCOL_VERSION });
		lobby.connectController({}, { v: PROTOCOL_VERSION });

		const outcome = lobby.connectController({}, { v: PROTOCOL_VERSION });

		expect(outcome).toEqual({ ok: false, reason: "full" });
	});

	it("rejects a mismatched protocol version before checking slots", () => {
		const lobby = new Lobby(ids());

		const outcome = lobby.connectController({}, { v: PROTOCOL_VERSION + 1 });

		expect(outcome).toEqual({ ok: false, reason: "bad-version" });
	});

	it("rejects resume of a playerId nobody has been assigned", () => {
		const lobby = new Lobby(ids());

		const outcome = lobby.connectController(
			{},
			{ v: PROTOCOL_VERSION, resume: "ghost" },
		);

		expect(outcome).toEqual({ ok: false, reason: "unknown-session" });
	});

	it("reattaches a known playerId to its original side, from a new connection", () => {
		const lobby = new Lobby(ids());
		const firstConn = {};
		lobby.connectController(firstConn, { v: PROTOCOL_VERSION });
		lobby.disconnectController(firstConn);

		const outcome = lobby.connectController(
			{},
			{ v: PROTOCOL_VERSION, resume: "p1" },
		);

		expect(outcome).toEqual({
			ok: true,
			playerId: "p1",
			side: "near",
			players: [
				{ playerId: "p1", side: "near", ready: false, connected: true },
			],
		});
	});

	// The test that used to live here asserted the opposite — that a
	// disconnected player's slot stays theirs forever. That was
	// `llm-knowledge/decisions/0006-relay-session-policy.md`'s policy, and it
	// was written before there was a lobby anyone could get stuck in. See
	// "reclaiming a slot from a player who is gone", below.
});

describe("Lobby — ready state", () => {
	it("updates a connected controller's ready flag", () => {
		const lobby = new Lobby(ids());
		const conn = {};
		lobby.connectController(conn, { v: PROTOCOL_VERSION });

		const players = lobby.setReady(conn, true);

		expect(players).toEqual([
			{ playerId: "p1", side: "near", ready: true, connected: true },
		]);
	});

	it("returns null for a connection that never said hello", () => {
		const lobby = new Lobby(ids());

		expect(lobby.setReady({}, true)).toBeNull();
	});
});

describe("Lobby — disconnect", () => {
	it("marks the player disconnected and returns its playerId", () => {
		const lobby = new Lobby(ids());
		const conn = {};
		lobby.connectController(conn, { v: PROTOCOL_VERSION });

		const playerId = lobby.disconnectController(conn);

		expect(playerId).toBe("p1");
		expect(lobby.players()).toEqual([
			{ playerId: "p1", side: "near", ready: false, connected: false },
		]);
	});

	it("returns null for a connection that was never a controller", () => {
		const lobby = new Lobby(ids());

		expect(lobby.disconnectController({})).toBeNull();
	});

	it("a stale connection's late close does not affect a player who already resumed elsewhere", () => {
		const lobby = new Lobby(ids());
		const staleConn = {};
		lobby.connectController(staleConn, { v: PROTOCOL_VERSION });
		// The client reconnects and resumes before the old socket's close event
		// arrives — exactly what iOS backgrounding does, per
		// llm-knowledge/platform/ios-safari-tab-suspension.md.
		lobby.connectController({}, { v: PROTOCOL_VERSION, resume: "p1" });

		const result = lobby.disconnectController(staleConn);

		expect(result).toBeNull();
		expect(lobby.players()).toEqual([
			{ playerId: "p1", side: "near", ready: false, connected: true },
		]);
	});
});

describe("Lobby — playerIdFor", () => {
	it("looks up the playerId for a live controller connection", () => {
		const lobby = new Lobby(ids());
		const conn = {};
		lobby.connectController(conn, { v: PROTOCOL_VERSION });

		expect(lobby.playerIdFor(conn)).toBe("p1");
	});

	it("returns null for an unknown connection", () => {
		const lobby = new Lobby(ids());

		expect(lobby.playerIdFor({})).toBeNull();
	});
});

describe("Lobby — host", () => {
	it("accepts a host with a matching protocol version", () => {
		const lobby = new Lobby(ids());

		expect(lobby.connectHost({}, { v: PROTOCOL_VERSION })).toBe(true);
	});

	it("rejects a host with a mismatched protocol version", () => {
		const lobby = new Lobby(ids());

		expect(lobby.connectHost({}, { v: PROTOCOL_VERSION + 1 })).toBe(false);
	});

	it("a second host connection replaces the first", () => {
		const lobby = new Lobby(ids());
		const oldHost = {};
		const newHost = {};
		lobby.connectHost(oldHost, { v: PROTOCOL_VERSION });

		lobby.connectHost(newHost, { v: PROTOCOL_VERSION });

		expect(lobby.isHost(oldHost)).toBe(false);
		expect(lobby.isHost(newHost)).toBe(true);
	});

	it("disconnecting a stale (already-replaced) host connection is a no-op", () => {
		const lobby = new Lobby(ids());
		const oldHost = {};
		const newHost = {};
		lobby.connectHost(oldHost, { v: PROTOCOL_VERSION });
		lobby.connectHost(newHost, { v: PROTOCOL_VERSION });

		const wasActive = lobby.disconnectHost(oldHost);

		expect(wasActive).toBe(false);
		expect(lobby.isHost(newHost)).toBe(true);
	});

	it("disconnecting the active host clears it", () => {
		const lobby = new Lobby(ids());
		const host = {};
		lobby.connectHost(host, { v: PROTOCOL_VERSION });

		const wasActive = lobby.disconnectHost(host);

		expect(wasActive).toBe(true);
		expect(lobby.isHost(host)).toBe(false);
	});
});

describe("reclaiming a slot from a player who is gone", () => {
	it("gives a disconnected player's side to a new phone rather than saying full", () => {
		const lobby = new Lobby(ids());
		const a = {};
		const b = {};
		lobby.connectController(a, { v: PROTOCOL_VERSION });
		lobby.connectController(b, { v: PROTOCOL_VERSION });
		lobby.disconnectController(a);

		// Someone picks up a third phone because the first one died. Before
		// this, the answer was "full" and the match could not start again
		// without restarting the server.
		const third = lobby.connectController({}, { v: PROTOCOL_VERSION });
		expect(third).toMatchObject({ ok: true, side: "near" });
		expect(lobby.players()).toHaveLength(2);
	});

	it("still refuses when both sides are connected", () => {
		const lobby = new Lobby(ids());
		lobby.connectController({}, { v: PROTOCOL_VERSION });
		lobby.connectController({}, { v: PROTOCOL_VERSION });
		expect(lobby.connectController({}, { v: PROTOCOL_VERSION })).toEqual({
			ok: false,
			reason: "full",
		});
	});

	it("prefers a free side over reclaiming a disconnected one", () => {
		const lobby = new Lobby(ids());
		const a = {};
		lobby.connectController(a, { v: PROTOCOL_VERSION });
		lobby.disconnectController(a);
		// `far` is untouched, so the newcomer goes there and the absent
		// player keeps their identity and their side to resume into.
		expect(lobby.connectController({}, { v: PROTOCOL_VERSION })).toMatchObject({
			ok: true,
			side: "far",
		});
		expect(lobby.players()).toHaveLength(2);
	});

	it("a reclaimed player cannot resume: their session is gone, not stale", () => {
		const lobby = new Lobby(ids());
		const a = {};
		const b = {};
		const first = lobby.connectController(a, { v: PROTOCOL_VERSION });
		lobby.connectController(b, { v: PROTOCOL_VERSION });
		lobby.disconnectController(a);
		lobby.connectController({}, { v: PROTOCOL_VERSION });

		const playerId = first.ok ? first.playerId : "";
		expect(
			lobby.connectController({}, { v: PROTOCOL_VERSION, resume: playerId }),
		).toEqual({ ok: false, reason: "unknown-session" });
	});
});
