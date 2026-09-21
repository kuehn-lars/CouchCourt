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

/** Largest `Swing.lag` the host will accept, milliseconds. A swing cannot
 * have taken longer than the detector's whole episode window to announce, and
 * anything larger is a broken or hostile controller. */
export const MAX_SWING_LAG_MS = 1000;

/**
 * What to assume when a `Swing` carries no `lag` — a controller built before
 * the field existed. The measured median delay of the current detector across
 * all 26 committed traces, so an older phone is judged as if it behaved like
 * a current one, which is very nearly true. Assuming 0 instead would punish
 * it for a delay it is still incurring.
 */
export const DEFAULT_SWING_LAG_MS = 200;

export type PlayerId = string;

/** Which end of the court a player is on. Assigned by the server, never chosen. */
export type Side = "near" | "far";

/**
 * `serve` is assigned by the **simulation**, from `phase === "waiting-serve"`,
 * and is never claimed by a phone. The phone used to guess it from a wrist
 * pronation spike; six 30s captures showed hard forehands producing the same
 * spike, so the guess was deleted rather than retuned — see
 * `src/shared/swing/detector.ts` and
 * `llm-knowledge/decisions/0012-swing-kind-is-the-shot-direction.md`. A
 * controller that sends one anyway is not rejected; the sim overrides it.
 */
export type SwingKind = "forehand" | "backhand" | "serve";

/** What the host tells a phone happened, so it can buzz. */
export type FeedbackKind = "hit" | "miss" | "point";

/**
 * Where the match is. Owned by the host — the server relays it and stores
 * none of it, exactly like every other piece of game state
 * (`llm-knowledge/decisions/0002-host-authoritative-simulation.md`).
 */
export type MatchPhase = "lobby" | "countdown" | "playing" | "over";

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
	/**
	 * Wrist roll at the peak, -1 (slice) to +1 (topspin). Optional: absent
	 * means flat, so a phone running an older build is still a playable
	 * phone and the protocol version does not move. The sim turns it into a
	 * gravity multiplier — see `sim/rally.ts`.
	 */
	spin?: number;
	/**
	 * Milliseconds the phone's detector spent between the swing's peak and
	 * announcing it — both read from the phone's own clock, so this is a
	 * *duration* and carries none of the cross-device clock skew that
	 * `llm-knowledge/decisions/0007-host-arrival-time-for-swing-timing.md`
	 * refuses to trust. The host subtracts it from arrival time to recover
	 * when the swing actually happened.
	 *
	 * Optional for the same reason `spin` is: an older controller is still a
	 * playable controller. Absent means "no idea", and the host falls back to
	 * a measured typical value rather than to zero — see
	 * `llm-knowledge/decisions/0013-detector-latency-is-compensated.md`.
	 */
	lag?: number;
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

/** What the host says about the match, and what every phone is told. */
export interface MatchInfo {
	phase: MatchPhase;
	/** Who serves this match. */
	server: Side;
	/** Set only in phase `over`. */
	winner?: Side;
}

/** server -> controller */
export type ControllerBoundMessage =
	| { t: "assigned"; playerId: PlayerId; side: Side }
	| { t: "rejected"; reason: "full" | "bad-version" | "unknown-session" }
	| { t: "lobby"; players: LobbyPlayer[] }
	| ({ t: "match" } & MatchInfo)
	/** Drives haptics and on-phone feedback. Not authoritative for anything. */
	| { t: "feedback"; kind: FeedbackKind };

/** host -> server */
export type HostMessage =
	| { t: "host-hello"; v: number }
	| ({ t: "match" } & MatchInfo)
	| { t: "feedback"; playerId: PlayerId; kind: FeedbackKind };

/**
 * server -> host.
 *
 * The lobby is sent as a **snapshot**, not as joined/left/ready deltas. A
 * host that reloads or reconnects mid-lobby cannot rebuild the roster from
 * deltas it was not connected for, and two places deriving "who is here"
 * from different event streams is exactly the drift this protocol exists to
 * avoid. One message, one truth.
 */
export type HostBoundMessage =
	| { t: "lobby"; players: LobbyPlayer[] }
	| { t: "aim"; playerId: PlayerId; aim: Aim }
	| { t: "swing"; playerId: PlayerId; swing: Swing };

const FEEDBACK_KINDS: readonly FeedbackKind[] = ["hit", "miss", "point"];

const isFeedbackKind = (x: unknown): x is FeedbackKind =>
	FEEDBACK_KINDS.includes(x as FeedbackKind);

const MATCH_PHASES: readonly MatchPhase[] = [
	"lobby",
	"countdown",
	"playing",
	"over",
];

const isSide = (x: unknown): x is Side => x === "near" || x === "far";

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
				isFiniteNumber(x.at) &&
				(x.spin === undefined ||
					(isFiniteNumber(x.spin) && x.spin >= -1 && x.spin <= 1)) &&
				// Bounded, not just finite: a swing claiming a 30-second lag
				// would back-date itself out of the rally entirely.
				(x.lag === undefined ||
					(isFiniteNumber(x.lag) && x.lag >= 0 && x.lag <= MAX_SWING_LAG_MS))
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
		case "match":
			return (
				MATCH_PHASES.includes(x.phase as MatchPhase) &&
				isSide(x.server) &&
				(x.winner === undefined || isSide(x.winner))
			);
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
