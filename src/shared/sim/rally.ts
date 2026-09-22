/**
 * The rally machine: phases `waiting-serve → serve-flight → rally →
 * point-over`, and `tick`, the sim's single entry point.
 *
 * ## The contact model
 *
 * Every incoming ball has a **contact**: where and when the player to hit it
 * will meet it, from `predictStrike`. It is re-planned every tick while the
 * ball is on its way — a net clip changes the answer — and **frozen** once
 * the ball bounces on the receiver's side or the moment arrives. Every swing
 * is judged against that one frozen contact, at the time the swing actually
 * happened (arrival minus the phone's reported `lag`):
 *
 * - **early, in the window** — held (`armed`) and struck at the contact
 *   point the instant the ball gets there. The avatar meets the ball; the
 *   timing still decides how well it is hit.
 * - **late, in the window** — the ball has already flown past, so it is
 *   rewound: struck from the contact point at the contact time and flown
 *   forward to now. This is what makes a phone's detection delay and the
 *   network hop invisible to the result.
 * - **outside it** — a whiff. Nothing happens to the ball.
 *
 * One real swing arrives as several peaks (backswing, swing, follow-through),
 * so the hardest swing in the window wins: a harder one replaces an armed
 * one, and a harder one arriving just after a weaker one struck re-strikes
 * it (`revise`). Before 2026-09-22 the contact was re-predicted at *arrival*;
 * a well-timed swing arriving after the ball had passed was judged against a
 * new strike the predictor invented further on and read as 650ms early,
 * which is why only the serve ever connected
 * (`llm-knowledge/decisions/0015-contact-model.md`).
 *
 * Nothing else enters `tick`: no clock read, no RNG
 * (`llm-knowledge/decisions/0002-host-authoritative-simulation.md`).
 *
 * `src/shared/**` is compiled under both a DOM-only and a Node-only tsconfig,
 * so this file names no DOM type and no Node global.
 */

import {
	DEFAULT_SWING_LAG_MS,
	MAX_SWING_LAG_MS,
	type Side,
	type Swing,
	type SwingKind,
} from "../protocol.ts";
import { type BallEnv, DRAG_K, stepBall } from "./ball.ts";
import { isInBounds, isInServiceBox } from "./court.ts";
import {
	HIT_REACH,
	homeFor,
	movePlayer,
	PLAYER_SPEED,
	PREDICTION_DT,
	predictStrike,
	RECOVERY,
	standFor,
	strokeFor,
} from "./players.ts";
import { awardPoint, initialScore, other, type Score } from "./scoring.ts";
import {
	HAND_HEIGHT,
	handOf,
	heldBall,
	serveSetup,
	serveTargetX,
	serveTiming,
	TOSS_MIN_HIT,
	tossBall,
} from "./serve.ts";
import {
	groundstroke,
	serveShot,
	smash,
	TIMING_IDEAL,
	TIMING_LATE,
	timingOf,
} from "./shot.ts";
import type { Ball, Player, Vec3 } from "./state.ts";

export type RallyPhase =
	| "waiting-serve"
	| "serve-flight"
	| "rally"
	| "point-over";

/** Where and when `side` will meet the incoming ball. */
export interface Contact {
	readonly side: Side;
	/** The ball's own position at that moment. */
	readonly ball: Vec3;
	/** Sim time, seconds. */
	readonly at: number;
	/** Taken before it bounces. */
	readonly air: boolean;
	/** The stance: decided from where the ball is, the first time the
	 * contact is planned, and kept — the player is already turning for it.
	 * What they actually play is the swing's `kind` (`strokeOf`). */
	readonly stroke: "forehand" | "backhand";
}

/** The shot in flight. Here because the swing is gone by the time anything
 * downstream wants to know about it: the renderer animates it, and `revise`
 * re-strikes it from `from` at `at`. */
export interface Stroke {
	readonly side: Side;
	readonly kind: SwingKind;
	readonly power: number;
	readonly air: boolean;
	readonly at: number;
	readonly from: Vec3;
	/** -1 early … +1 late. For a serve, against the top of the toss. */
	readonly timing: number;
}

export interface MatchState {
	readonly phase: RallyPhase;
	readonly ball: Ball;
	readonly players: Readonly<Record<Side, Player>>;
	readonly score: Score;
	/** Who must hit the ball next. */
	readonly toHit: Side;
	/** Bounces since the last hit. Two loses the point for whoever is `toHit`. */
	readonly bounces: number;
	readonly serveNumber: 1 | 2;
	/** Spin of the shot in flight, -1 (slice) to +1 (topspin). */
	readonly spin: number;
	readonly stroke: Stroke | null;
	/** `toHit`'s planned meeting with the ball; `null` when nothing is coming. */
	readonly contact: Contact | null;
	/** An early swing waiting for the ball to arrive, with the sim time it
	 * was actually swung at. */
	readonly armed: { readonly swing: Swing; readonly at: number } | null;
	/** Sim time the serve was tossed, or `null` while the ball is in hand. */
	readonly toss: number | null;
	/** Who won the most recent point, for the phones' feedback. */
	readonly lastPoint: Side | null;
	/** Swings that met nothing, per side — the renderer swings the avatar
	 * at air when this goes up. */
	readonly whiffs: Readonly<Record<Side, number>>;
	/** Elapsed sim time, seconds — the clock `RallyInput.time` is stamped in. */
	readonly time: number;
}

/** One swing, already resolved to a side and stamped with the host's arrival
 * time in the same clock as `MatchState.time`. */
export interface RallyInput {
	readonly side: Side;
	readonly swing: Swing;
	readonly time: number;
}

/**
 * How far spin bends gravity — the whole "no spin vector, no Magnus force"
 * simplification `ball.ts` documents. Asymmetric because slice floats and
 * topspin dips. Since every shot is now solved to land on its target, spin
 * changes the *shape* of the flight — a topspin ball arcs higher and kicks
 * down — rather than whether it lands in.
 */
export const SPIN_GRAVITY_TOP = 0.35;
export const SPIN_GRAVITY_SLICE = 0.15;

/**
 * Seconds after the opponent strikes before the player to hit it starts
 * running. Anticipation is what makes auto-movement unbeatable: with none,
 * every ball aimed inside the lines is reached and two decent players rally
 * forever. A human reads the shot off the racket in about this long.
 */
export const REACTION = 0.3;

/** Swing power a later peak must beat an earlier strike by to replace it. */
export const REVISE_MARGIN = 0.05;

export function envForSpin(spin: number): BallEnv {
	const scale = spin >= 0 ? SPIN_GRAVITY_TOP : SPIN_GRAVITY_SLICE;
	return { gravityScale: 1 + spin * scale, drag: DRAG_K };
}

/** The flight environment for `state`'s in-flight ball. Everything that
 * looks at the ball's future has to use the SAME env as the step itself. */
export function envFor(state: MatchState): BallEnv {
	return envForSpin(state.spin);
}

const halfSign = (side: Side): number => (side === "near" ? 1 : -1);

/** Everyone in place for the next serve, ball in the server's hand. */
function setUpServe(state: MatchState, serveNumber: 1 | 2): MatchState {
	const server = state.score.server;
	const setup = serveSetup(state.score);
	const players: Record<Side, Player> = {
		near: { side: "near", x: 0, z: 0 },
		far: { side: "far", x: 0, z: 0 },
	};
	players[server] = { side: server, ...setup.server };
	players[other(server)] = { side: other(server), ...setup.receiver };
	return {
		...state,
		phase: "waiting-serve",
		toHit: server,
		bounces: 0,
		serveNumber,
		spin: 0,
		stroke: null,
		contact: null,
		armed: null,
		toss: null,
		players,
		ball: heldBall(handOf(server, players[server])),
	};
}

export function createMatch(server: Side): MatchState {
	const blank: MatchState = {
		phase: "waiting-serve",
		ball: heldBall({ x: 0, y: HAND_HEIGHT, z: 0 }),
		players: {
			near: { side: "near", x: 0, z: 0 },
			far: { side: "far", x: 0, z: 0 },
		},
		score: initialScore(server),
		toHit: server,
		bounces: 0,
		serveNumber: 1,
		spin: 0,
		stroke: null,
		contact: null,
		armed: null,
		toss: null,
		lastPoint: null,
		whiffs: { near: 0, far: 0 },
		time: 0,
	};
	return setUpServe(blank, 1);
}

function pointTo(state: MatchState, winner: Side): MatchState {
	return {
		...state,
		score: awardPoint(state.score, winner),
		lastPoint: winner,
		phase: "point-over",
		contact: null,
		armed: null,
	};
}

/** A fault during `serve-flight`: first serve tries again, second serve loses
 * the point. `toHit` is the receiver here, so `other(toHit)` is the server. */
function fault(state: MatchState): MatchState {
	if (state.serveNumber >= 2) return pointTo(state, state.toHit);
	return setUpServe(state, 2);
}

/**
 * When the swing actually happened, in sim time: arrival minus the delay the
 * phone's detector reports having taken
 * (`llm-knowledge/decisions/0013-detector-latency-is-compensated.md`). Both
 * ends of that delay are the phone's own clock, so it is a duration and
 * carries none of the skew
 * `llm-knowledge/decisions/0007-host-arrival-time-for-swing-timing.md`
 * refuses to trust. Clamped as well as defaulted: the bot's inputs never
 * passed the wire guard.
 */
function swingTime(input: RallyInput): number {
	const reported = input.swing.lag ?? DEFAULT_SWING_LAG_MS;
	const lag = Math.min(Math.max(reported, 0), MAX_SWING_LAG_MS);
	return input.time - lag / 1000;
}

function whiff(state: MatchState, side: Side): MatchState {
	return {
		...state,
		armed: null,
		whiffs: { ...state.whiffs, [side]: state.whiffs[side] + 1 },
	};
}

// ------------------------------------------------------------- ball flight

function resolveStep(
	state: MatchState,
	net: { hit: boolean } | undefined,
	bounce: { x: number; z: number } | undefined,
): MatchState {
	if (net?.hit) {
		return state.phase === "serve-flight"
			? fault(state)
			: pointTo(state, state.toHit);
	}
	if (!bounce) return state;

	const bounces = state.bounces + 1;
	if (bounces >= 2) return pointTo({ ...state, bounces }, other(state.toHit));

	const inPlay =
		state.phase === "serve-flight"
			? isInServiceBox(bounce.x, bounce.z, state.toHit)
			: isInBounds(bounce.x, bounce.z);
	if (!inPlay) {
		return state.phase === "serve-flight"
			? fault(state)
			: pointTo({ ...state, bounces }, state.toHit);
	}
	return { ...state, phase: "rally", bounces };
}

function advanceBall(state: MatchState, dt: number): MatchState {
	const step = stepBall(state.ball, dt, envFor(state));
	return resolveStep({ ...state, ball: step.ball }, step.net, step.bounce);
}

/** Flies a ball struck `elapsed` seconds ago forward to now, resolving
 * anything it did on the way. `elapsed` is the rewind. */
function fastForward(state: MatchState, elapsed: number): MatchState {
	let s = state;
	let left = elapsed;
	while (left > 1e-9 && (s.phase === "rally" || s.phase === "serve-flight")) {
		const dt = Math.min(PREDICTION_DT, left);
		s = advanceBall(s, dt);
		left -= dt;
	}
	return s;
}

/** The toss rises and falls; a toss nobody hit is caught. */
function stepToss(state: MatchState, dt: number): MatchState {
	if (state.toss === null) return state;
	const ball = stepBall(state.ball, dt, envForSpin(0)).ball;
	if (ball.v.y < 0 && ball.p.y < HAND_HEIGHT) {
		const server = state.toHit;
		return {
			...state,
			toss: null,
			ball: heldBall(handOf(server, state.players[server])),
		};
	}
	return { ...state, ball };
}

// ------------------------------------------------------------- swings

/** The stroke a swing plays at a contact: what the phone read, except that a
 * `serve` claim mid-rally — an old controller, or the bot — is played as the
 * stroke the player set up for. `null` when it cannot be played at all: an
 * overhead needs a ball out of the air. */
function strokeOf(
	swing: Swing,
	c: { air: boolean; stroke: "forehand" | "backhand" },
): Exclude<SwingKind, "serve"> | null {
	if (swing.kind === "serve") return c.stroke;
	if (swing.kind === "overhead" && !c.air) return null;
	return swing.kind;
}

/** The ball off the racket for a rally stroke. */
function shoot(
	from: Vec3,
	side: Side,
	kind: Exclude<SwingKind, "serve">,
	timing: number,
	power: number,
	env: BallEnv,
): Vec3 {
	return kind === "overhead"
		? smash(from, side, timing, power, env)
		: groundstroke(from, side, kind, timing, power, env);
}

function strike(
	state: MatchState,
	c: Contact,
	swing: Swing,
	at: number,
): MatchState {
	const player = state.players[c.side];
	const kind = strokeOf(swing, c);
	if (
		kind === null ||
		Math.hypot(player.x - c.ball.x, player.z - c.ball.z) > HIT_REACH
	) {
		return whiff(state, c.side);
	}
	const timing = timingOf(at - c.at) ?? 0;
	const spin = swing.spin ?? 0;
	const v = shoot(c.ball, c.side, kind, timing, swing.power, envForSpin(spin));
	const struck: MatchState = {
		...state,
		phase: "rally",
		ball: { p: c.ball, v },
		toHit: other(c.side),
		bounces: 0,
		spin,
		stroke: {
			side: c.side,
			kind,
			power: swing.power,
			air: c.air,
			at: c.at,
			from: c.ball,
			timing,
		},
		contact: null,
		armed: null,
	};
	return fastForward(struck, state.time - c.at);
}

function serveSwing(state: MatchState, swing: Swing, at: number): MatchState {
	const server = state.toHit;
	if (state.toss === null) {
		const hand = handOf(server, state.players[server]);
		return { ...state, toss: state.time, ball: tossBall(hand, 0) };
	}
	const since = Math.min(at, state.time) - state.toss;
	if (since < TOSS_MIN_HIT) return state;

	const hand = handOf(server, state.players[server]);
	const from = tossBall(hand, since).p;
	const timing = serveTiming(since);
	const spin = swing.spin ?? 0;
	const v = serveShot(
		from,
		server,
		serveTargetX(serveSetup(state.score), server, timing),
		swing.power,
		1 - Math.abs(timing),
		envForSpin(spin),
	);
	const served: MatchState = {
		...state,
		phase: "serve-flight",
		ball: { p: from, v },
		toHit: other(server),
		bounces: 0,
		spin,
		toss: null,
		stroke: {
			side: server,
			kind: "serve",
			power: swing.power,
			air: false,
			at: state.toss + since,
			from,
			timing,
		},
	};
	return fastForward(served, state.time - (state.toss + since));
}

/**
 * A harder swing from the player who just hit, arriving within the late
 * window of that hit: it was the real swing, and the weaker peak before it
 * was the backswing. Re-strike from the same contact. Only while the ball is
 * still on the hitter's side and has not bounced — past that, rewinding
 * would undo something the other player has already seen.
 */
function revise(
	state: MatchState,
	side: Side,
	swing: Swing,
	at: number,
): MatchState {
	const st = state.stroke;
	if (!st || st.side !== side || state.toHit !== other(side)) return state;
	if (state.phase !== "rally" && state.phase !== "serve-flight") return state;
	// Judged on when the swing happened, not when it arrived: a late swing
	// announced 50ms after its peak and carried 30ms over the network still
	// happened inside the window.
	if (state.bounces > 0 || at - st.at > TIMING_LATE + TIMING_IDEAL)
		return state;
	if (state.ball.p.z * halfSign(side) <= 0) return state;
	if (swing.power < st.power + REVISE_MARGIN) return state;

	const spin = swing.spin ?? 0;
	const env = envForSpin(spin);
	let v: Vec3;
	let timing = st.timing;
	let kind = st.kind;
	if (st.kind === "serve") {
		v = serveShot(
			st.from,
			side,
			serveTargetX(serveSetup(state.score), side, timing),
			swing.power,
			1 - Math.abs(timing),
			env,
		);
	} else {
		const t = timingOf(at - st.at);
		// Outside the window it cannot be the swing that met the ball: it is
		// a follow-through, however hard.
		if (t === undefined) return state;
		// The harder peak is the real swing, so its stroke is the one played.
		const played = strokeOf(swing, {
			air: st.air,
			stroke: st.kind === "backhand" ? "backhand" : "forehand",
		});
		if (played === null) return state;
		kind = played;
		timing = t;
		v = shoot(st.from, side, kind, timing, swing.power, env);
	}
	const redone: MatchState = {
		...state,
		ball: { p: st.from, v },
		spin,
		stroke: { ...st, kind, power: swing.power, timing },
	};
	return fastForward(redone, state.time - st.at);
}

function applySwing(state: MatchState, input: RallyInput): MatchState {
	const at = swingTime(input);
	if (input.side !== state.toHit) {
		return revise(state, input.side, input.swing, at);
	}
	if (state.phase === "waiting-serve") {
		return serveSwing(state, input.swing, at);
	}
	const c = state.contact;
	if (!c || c.side !== input.side) return state;

	if (timingOf(at - c.at) === undefined) {
		// Late, and not by a whisker: the avatar swings at air. An early
		// miss is ignored silently — it is usually the backswing of the
		// swing that is about to connect.
		return at > c.at && at - c.at < 0.6 ? whiff(state, input.side) : state;
	}
	if (strokeOf(input.swing, c) === null) {
		// An overhead at a ball that has bounced: the racket goes over the
		// top of it. Shown as a swing at air unless a real stroke is already
		// waiting — then it is that stroke's backswing or follow-through.
		return state.armed ? state : whiff(state, input.side);
	}
	if (state.time < c.at) {
		const armed = state.armed;
		if (armed && armed.swing.power >= input.swing.power) return state;
		return { ...state, armed: { swing: input.swing, at } };
	}
	return strike(state, c, input.swing, at);
}

/** The ball has reached a contact an early swing was waiting for. */
function fireArmed(state: MatchState): MatchState {
	const a = state.armed;
	if (!a) return state;
	const c = state.contact;
	if (!c || c.side !== state.toHit) return { ...state, armed: null };
	if (state.time < c.at) return state;
	// Re-planned since it was armed and no longer in the window.
	if (timingOf(a.at - c.at) === undefined) return whiff(state, c.side);
	return strike(state, c, a.swing, a.at);
}

// ------------------------------------------------------------- planning

function planContact(state: MatchState): MatchState {
	if (state.phase !== "rally" && state.phase !== "serve-flight") {
		return state.contact === null ? state : { ...state, contact: null };
	}
	const side = state.toHit;
	const c = state.contact;
	const mine = c !== null && c.side === side;
	if (mine && (state.time >= c.at || (state.bounces > 0 && !c.air))) {
		return state;
	}
	const player = state.players[side];
	const strike = predictStrike(
		state.ball,
		envFor(state),
		side,
		player,
		state.bounces > 0,
	);
	return {
		...state,
		contact: {
			side,
			ball: strike.ball,
			at: state.time + strike.t,
			air: strike.air,
			stroke: mine ? c.stroke : strokeFor(side, player.x, strike.ball.x),
		},
	};
}

/** The player to hit runs to stand beside the contact; the other recovers
 * to the middle. Nobody moves while a serve is being set up. */
function movePlayers(state: MatchState, dt: number): MatchState {
	if (state.phase === "waiting-serve" || state.phase === "point-over") {
		return state;
	}
	const toward = (side: Side): Player => {
		const c = state.contact;
		const player = state.players[side];
		if (c === null || c.side !== side) {
			return movePlayer(player, homeFor(side), dt, PLAYER_SPEED * RECOVERY);
		}
		const hitAt = state.stroke?.at ?? Number.NEGATIVE_INFINITY;
		if (state.time - hitAt < REACTION) return player;
		return movePlayer(player, standFor(side, c.ball, c.stroke), dt);
	};
	return { ...state, players: { near: toward("near"), far: toward("far") } };
}

export function tick(
	state: MatchState,
	inputs: readonly RallyInput[],
	dt: number,
): MatchState {
	if (state.score.setWinner) return state;

	let next = state.phase === "point-over" ? setUpServe(state, 1) : state;
	for (const input of inputs) next = applySwing(next, input);
	next = fireArmed(next);
	next =
		next.phase === "waiting-serve"
			? stepToss(next, dt)
			: next.phase === "point-over"
				? next
				: advanceBall(next, dt);
	next = planContact(next);
	next = movePlayers(next, dt);
	return { ...next, time: next.time + dt };
}
