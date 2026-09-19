/**
 * The wire contract between controller (iPhone), server (relay) and host (Mac).
 *
 * Three rules this file exists to keep honest:
 *
 * 1. Swing detection happens ON THE PHONE. The wire carries semantic events —
 *    a handful of swings per rally plus a low-rate aim stream — never a 60Hz
 *    raw `devicemotion` firehose.
 * 2. The server is a relay. It owns player slots and nothing else. The
 *    simulation lives in the host browser.
 * 3. Everything arriving over a socket is untrusted. Parse it with the guards
 *    below before it reaches any game code.
 */

/** Bumped on any breaking change. A controller with a different version is rejected. */
export const PROTOCOL_VERSION = 1;

export type PlayerId = string;

/** Which end of the court a player is on. Assigned by the server, never chosen. */
export type Side = "near" | "far";

export type SwingKind = "forehand" | "backhand" | "serve";

/** What the host tells a phone happened, so it can buzz. */
export type FeedbackKind = "hit" | "miss" | "point";

/** ~20Hz. Where the racket is pointing, used for shot direction. Radians. */
export interface Aim {
	yaw: number;
	pitch: number;
}

/** Emitted by the on-phone detector, not by the raw sensor. */
export interface Swing {
	kind: SwingKind;
	/** Normalised 0..1. Derived from peak angular velocity, not raw acceleration. */
	power: number;
	/** `performance.now()` on the phone at the detected peak of the swing. */
	at: number;
}

export interface LobbyPlayer {
	playerId: PlayerId;
	side: Side;
	ready: boolean;
	connected: boolean;
}

/** controller -> server */
export type ControllerMessage =
	| { t: "hello"; v: number; resume?: PlayerId }
	| { t: "ready"; ready: boolean }
	| ({ t: "aim" } & Aim)
	| ({ t: "swing" } & Swing);

/** server -> controller */
export type ControllerBoundMessage =
	| { t: "assigned"; playerId: PlayerId; side: Side }
	| { t: "rejected"; reason: "full" | "bad-version" | "unknown-session" }
	| { t: "lobby"; players: LobbyPlayer[] }
	/** Drives haptics and on-phone feedback. Not authoritative for anything. */
	| { t: "feedback"; kind: FeedbackKind };

/** host -> server */
export type HostMessage =
	| { t: "host-hello"; v: number }
	| { t: "feedback"; playerId: PlayerId; kind: FeedbackKind };

/** server -> host */
export type HostBoundMessage =
	| { t: "player-joined"; playerId: PlayerId; side: Side }
	| { t: "player-left"; playerId: PlayerId }
	| { t: "player-ready"; playerId: PlayerId; ready: boolean }
	| { t: "aim"; playerId: PlayerId; aim: Aim }
	| { t: "swing"; playerId: PlayerId; swing: Swing };

const FEEDBACK_KINDS: readonly FeedbackKind[] = ["hit", "miss", "point"];

const isFeedbackKind = (x: unknown): x is FeedbackKind =>
	FEEDBACK_KINDS.includes(x as FeedbackKind);

const isRecord = (x: unknown): x is Record<string, unknown> =>
	typeof x === "object" && x !== null;

const isFiniteNumber = (x: unknown): x is number =>
	typeof x === "number" && Number.isFinite(x);

/**
 * Trust boundary. Rejects anything that is not a well-formed controller
 * message, including NaN and Infinity, which would otherwise poison the
 * simulation silently.
 */
export function isControllerMessage(x: unknown): x is ControllerMessage {
	if (!isRecord(x)) return false;
	switch (x.t) {
		case "hello":
			return (
				isFiniteNumber(x.v) &&
				(x.resume === undefined || typeof x.resume === "string")
			);
		case "ready":
			return typeof x.ready === "boolean";
		case "aim":
			return isFiniteNumber(x.yaw) && isFiniteNumber(x.pitch);
		case "swing":
			return (
				(x.kind === "forehand" ||
					x.kind === "backhand" ||
					x.kind === "serve") &&
				isFiniteNumber(x.power) &&
				x.power >= 0 &&
				x.power <= 1 &&
				isFiniteNumber(x.at)
			);
		default:
			return false;
	}
}

/**
 * The host page is served by us, but it still reaches the server over a socket
 * anyone on the LAN can open. It is exactly as untrusted as a controller, so it
 * gets exactly the same treatment.
 *
 * Both inbound directions are guarded on purpose. Shipping a validator for one
 * and not the other is how an unvalidated boundary quietly becomes permanent:
 * whoever writes the server copies the pattern they find.
 */
export function isHostMessage(x: unknown): x is HostMessage {
	if (!isRecord(x)) return false;
	switch (x.t) {
		case "host-hello":
			return isFiniteNumber(x.v);
		case "feedback":
			return typeof x.playerId === "string" && isFeedbackKind(x.kind);
		default:
			return false;
	}
}

/** Parse a raw socket payload against a guard, or get `null`. */
function parse<T>(raw: string, guard: (x: unknown) => x is T): T | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	return guard(parsed) ? parsed : null;
}

export const parseControllerMessage = (raw: string): ControllerMessage | null =>
	parse(raw, isControllerMessage);

export const parseHostMessage = (raw: string): HostMessage | null =>
	parse(raw, isHostMessage);
