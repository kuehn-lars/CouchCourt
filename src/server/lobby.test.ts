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

	it("does not free a disconnected player's slot for a fresh join", () => {
		const lobby = new Lobby(ids());
		const firstConn = {};
		lobby.connectController(firstConn, { v: PROTOCOL_VERSION });
		lobby.connectController({}, { v: PROTOCOL_VERSION });
		lobby.disconnectController(firstConn);

		const outcome = lobby.connectController({}, { v: PROTOCOL_VERSION });

		expect(outcome).toEqual({ ok: false, reason: "full" });
	});
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
