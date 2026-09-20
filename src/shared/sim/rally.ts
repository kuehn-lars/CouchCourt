/**
 * The rally machine: phases `waiting-serve → serve-flight → rally →
 * point-over`, and `tick`, the sim's single entry point.
 *
 * `tick(state, inputs, dt)` takes only the swings that arrived since the
 * last call, each already stamped with **host arrival time** by the caller
 * (`llm-knowledge/decisions/0007-host-arrival-time-for-swing-timing.md` —
 * the phone's `swing.at` is a different clock and is not read here). Nothing
 * else enters: no clock read, no RNG, matching
 * `llm-knowledge/decisions/0002-host-authoritative-simulation.md`.
 *
 * Design decisions the plan leaves open, resolved here (see the session log
 * for the reasoning): a swing's timing error is measured against when the
 * ball is predicted to reach the receiver's own baseline, recomputed fresh
 * every tick from the ball's *current* trajectory rather than cached from
 * the last hit — a net clip's timing is then correct for free, and no
 * "ideal contact time" needs to live in state at all. A serve has no
 * incoming ball to time against, so its error is always zero: full quality,
 * dead straight. Deuce/ad service boxes are not modelled — `Player` has no
 * server `x` position to select one, and nothing asks for it.
 *
 * Point resolution — out of bounds, second bounce, into the net, double
 * fault — lives in one place, `resolveStep`, below. `stepBall` only ever
 * reports one of `net` or `bounce` per step, never both, so these are
 * separate branches, not a priority ordering.
 *
 * `src/shared/**` is compiled under both a DOM-only and a Node-only tsconfig,
 * so this file names no DOM type and no Node global — see
 * `llm-knowledge/decisions/0002-host-authoritative-simulation.md`.
 */

import type { Side, Swing } from "../protocol.ts";
import { type BallEnv, DRAG_K, stepBall } from "./ball.ts";
import { BASELINE_Z, isInBounds, isInServiceBox } from "./court.ts";
import {
	movePlayer,
	predictCrossingTime,
	predictCrossingX,
} from "./players.ts";
import { awardPoint, initialScore, other, type Score } from "./scoring.ts";
import { resolveShot, SERVE_CONTACT_HEIGHT } from "./shot.ts";
import type { Ball, Player } from "./state.ts";

export type RallyPhase =
	| "waiting-serve"
	| "serve-flight"
	| "rally"
	| "point-over";

export interface MatchState {
	readonly phase: RallyPhase;
	readonly ball: Ball;
	readonly players: Readonly<Record<Side, Player>>;
	readonly score: Score;
	/** Who must hit the ball next: the server before contact, the receiver
	 * after, and so on every time a shot is returned. */
	readonly toHit: Side;
	/** Bounces since the last hit. Two loses the point for whoever was `toHit`. */
	readonly bounces: number;
	readonly serveNumber: 1 | 2;
	/** Spin of the shot currently in flight, -1 (slice) to +1 (topspin), as
	 * the hitter's phone read it. Nothing but `envFor` reads it; it lives in
	 * state because ball flight is stateless between ticks and the ball has
	 * to keep curving after the swing that gave it the spin is long gone. */
	readonly spin: number;
	/** Elapsed sim time, seconds — the same clock `RallyInput.time` is stamped in. */
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
 * simplification `ball.ts` documents, now actually driven by something the
 * player did with their wrist.
 *
 * **Asymmetric, and measured.** Topspin adds gravity, which is forgiving: a
 * ball that dips lands in. Slice removes it, which is not: with the tuned
 * serve angle, a serve still lands across every power at gravity ×1.35, but
 * by ×0.85 only 8 powers in 21 stay in the box and by ×0.7 essentially none
 * do. A symmetric ±0.6 made a hard slicer unable to land any serve at any
 * power — watched happening, see
 * `llm-knowledge/experiments/2026-09-20-serve-that-lands.md`. So slice is
 * worth less gravity than topspin is worth, and remains the risky shot
 * rather than the impossible one.
 */
export const SPIN_GRAVITY_TOP = 0.35;
export const SPIN_GRAVITY_SLICE = 0.15;

/** The flight environment for `state`'s in-flight ball. Everything that
 * looks at the ball's future — the timing predictor, the player predictor,
 * the step itself, and `bot.ts` — has to use the SAME env, or something
 * predicts a trajectory the ball does not fly. */
export function envFor(state: MatchState): BallEnv {
	const scale = state.spin >= 0 ? SPIN_GRAVITY_TOP : SPIN_GRAVITY_SLICE;
	return { gravityScale: 1 + state.spin * scale, drag: DRAG_K };
}

const baselineZ = (side: Side): number =>
	side === "near" ? BASELINE_Z : -BASELINE_Z;

function heldServeBall(server: Side): Ball {
	return {
		p: { x: 0, y: SERVE_CONTACT_HEIGHT, z: baselineZ(server) },
		v: { x: 0, y: 0, z: 0 },
	};
}

export function createMatch(server: Side): MatchState {
	return {
		phase: "waiting-serve",
		ball: heldServeBall(server),
		players: { near: { side: "near", x: 0 }, far: { side: "far", x: 0 } },
		score: initialScore(server),
		toHit: server,
		bounces: 0,
		serveNumber: 1,
		spin: 0,
		time: 0,
	};
}

function startPoint(state: MatchState): MatchState {
	if (state.score.setWinner) return state;
	const server = state.score.server;
	return {
		...state,
		phase: "waiting-serve",
		toHit: server,
		bounces: 0,
		serveNumber: 1,
		spin: 0,
		ball: heldServeBall(server),
		players: { near: { side: "near", x: 0 }, far: { side: "far", x: 0 } },
	};
}

function pointTo(state: MatchState, winner: Side): MatchState {
	return {
		...state,
		score: awardPoint(state.score, winner),
		phase: "point-over",
	};
}

/** A fault during `serve-flight`: first serve tries again, second serve loses
 * the point outright. `state.toHit` is still the receiver here (nobody has
 * hit since the serve), so `other(state.toHit)` is the server. */
function fault(state: MatchState): MatchState {
	if (state.serveNumber >= 2) return pointTo(state, state.toHit);
	const server = other(state.toHit);
	return {
		...state,
		phase: "waiting-serve",
		toHit: server,
		serveNumber: 2,
		bounces: 0,
		spin: 0,
		ball: heldServeBall(server),
	};
}

/** `timingError` for a swing arriving now from `toHit`, against the ball's
 * *current* trajectory — recomputed every call, never cached, so a shot that
 * clips the net mid-flight is judged on where it actually ends up. Falls
 * back to "perfectly timed" if no crossing is predicted at all: punishing a
 * case the sim can't reason about would cut against the product's own
 * "generous input" principle. */
function timingErrorFor(state: MatchState, input: RallyInput): number {
	const predicted = predictCrossingTime(
		state.ball,
		envFor(state),
		baselineZ(state.toHit),
	);
	if (predicted === undefined) return 0;
	return input.time - (state.time + predicted);
}

function applySwing(state: MatchState, input: RallyInput): MatchState {
	if (state.score.setWinner || input.side !== state.toHit) return state;

	const timingError =
		state.phase === "waiting-serve" ? 0 : timingErrorFor(state, input);
	const outgoing = resolveShot(
		input.swing,
		timingError,
		state.ball.p,
		input.side,
	);
	if (!outgoing) return state; // whiff: the second-bounce rule settles it

	return {
		...state,
		ball: { p: state.ball.p, v: outgoing },
		toHit: other(state.toHit),
		bounces: 0,
		spin: input.swing.spin ?? 0,
		phase: state.phase === "waiting-serve" ? "serve-flight" : "rally",
	};
}

function resolveStep(
	state: MatchState,
	net: { hit: boolean } | undefined,
	bounce: { x: number; z: number } | undefined,
): MatchState {
	if (net?.hit) {
		// Blocked at the band: it rebounds to the hitter's own side, which a
		// bounce-location check would have to special-case. Catching the
		// crossing event directly is simpler and exactly as correct.
		return state.phase === "serve-flight"
			? fault(state)
			: pointTo(state, state.toHit);
	}

	if (bounce) {
		const bounces = state.bounces + 1;
		if (bounces >= 2) {
			// `toHit` never returned it before the second bounce: they lose the
			// point regardless of where this bounce landed.
			return pointTo({ ...state, bounces }, other(state.toHit));
		}

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

	return state;
}

function movePlayers(state: MatchState, dt: number): MatchState {
	const env = envFor(state);
	return {
		...state,
		players: {
			near: movePlayer(
				state.players.near,
				predictCrossingX(state.ball, env, BASELINE_Z),
				dt,
			),
			far: movePlayer(
				state.players.far,
				predictCrossingX(state.ball, env, -BASELINE_Z),
				dt,
			),
		},
	};
}

export function tick(
	state: MatchState,
	inputs: readonly RallyInput[],
	dt: number,
): MatchState {
	if (state.score.setWinner) return state;

	let next = state.phase === "point-over" ? startPoint(state) : state;
	for (const input of inputs) next = applySwing(next, input);

	if (next.phase !== "waiting-serve") {
		const step = stepBall(next.ball, dt, envFor(next));
		next = resolveStep({ ...next, ball: step.ball }, step.net, step.bounce);
	}

	next = movePlayers(next, dt);
	return { ...next, time: next.time + dt };
}
