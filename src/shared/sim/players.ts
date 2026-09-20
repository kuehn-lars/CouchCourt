/**
 * Automatic player movement. v1 has no manual movement, so the sim positions
 * each player itself: predict where the ball crosses the receiver's strike
 * plane, then ease toward that `x` at a capped speed.
 *
 * The predictor reuses `stepBall` rather than a closed-form solve — one
 * physics implementation, so this can never drift out of sync with what the
 * ball actually does (`llm-knowledge/plans/2026-09-19-simulation.md`, phase
 * 4). Positioning is generous by construction: whether the shot is good is
 * decided by timing in phase 5, not by whether the avatar got there.
 *
 * `src/shared/**` is compiled under both a DOM-only and a Node-only tsconfig,
 * so this file names no DOM type and no Node global — see
 * `llm-knowledge/decisions/0002-host-authoritative-simulation.md`.
 */

import { type BallEnv, stepBall } from "./ball.ts";
import { SINGLES_HALF_WIDTH } from "./court.ts";
import type { Ball, Player } from "./state.ts";

/** Ease-toward-target speed cap, m/s. Generous on purpose — see file header. */
export const PLAYER_SPEED = 8;

/** Step used to run the prediction forward. Matches the sim's own tick rate. */
export const PREDICTION_DT = 1 / 120;

/** Cap on how far ahead the predictor looks, seconds, so a ball that never
 * reaches the target plane (e.g. moving away from it) can't loop forever. */
export const MAX_LOOKAHEAD = 3;

const clamp = (x: number, lo: number, hi: number) =>
	Math.max(lo, Math.min(hi, x));

/**
 * Where `ball`'s centre crosses the plane `z = targetZ`, clamped to the
 * singles court. Steps `stepBall` forward on a copy of `ball` and linearly
 * interpolates `x` across whichever tick's segment crosses the plane — at
 * 120Hz that segment is a few centimetres, so the interpolation error is
 * negligible next to how generous the positioning already is.
 *
 * Falls back to the last predicted `x`, still clamped, if the ball never
 * reaches the plane within `MAX_LOOKAHEAD` — a ball headed the wrong way
 * must not send the player running toward `Infinity`.
 */
export function predictCrossingX(
	ball: Ball,
	env: BallEnv,
	targetZ: number,
): number {
	let current = ball;
	for (let t = 0; t < MAX_LOOKAHEAD; t += PREDICTION_DT) {
		const before = current.p.z;
		const step = stepBall(current, PREDICTION_DT, env);
		const after = step.ball.p.z;

		if (before > targetZ !== after > targetZ) {
			const f = (before - targetZ) / (before - after);
			const x = current.p.x + (step.ball.p.x - current.p.x) * f;
			return clamp(x, -SINGLES_HALF_WIDTH, SINGLES_HALF_WIDTH);
		}
		current = step.ball;
	}
	return clamp(current.p.x, -SINGLES_HALF_WIDTH, SINGLES_HALF_WIDTH);
}

/**
 * Seconds until `ball`'s centre crosses the plane `z = targetZ`, or
 * `undefined` if it never does within `MAX_LOOKAHEAD`. Used by `rally.ts` to
 * find how early or late an actual swing arrived against this prediction —
 * unlike `predictCrossingX` there is no sane clamp for "never crosses", so
 * the caller decides what a missing prediction means for timing.
 *
 * Same loop as `predictCrossingX`, kept separate rather than sharing it: the
 * two return different things on the not-found path (a clamped fallback `x`
 * versus no time at all), so unifying them would just move the fallback
 * decision into a shared function that has to know about both callers.
 */
export function predictCrossingTime(
	ball: Ball,
	env: BallEnv,
	targetZ: number,
): number | undefined {
	let current = ball;
	for (let i = 0; i < MAX_LOOKAHEAD / PREDICTION_DT; i++) {
		const before = current.p.z;
		const step = stepBall(current, PREDICTION_DT, env);
		const after = step.ball.p.z;

		if (before > targetZ !== after > targetZ) {
			const f = (before - targetZ) / (before - after);
			return (i + f) * PREDICTION_DT;
		}
		current = step.ball;
	}
	return undefined;
}

/** Ease `player` toward `targetX`, moving at most `PLAYER_SPEED * dt`. */
export function movePlayer(
	player: Player,
	targetX: number,
	dt: number,
): Player {
	const maxStep = PLAYER_SPEED * dt;
	const move = clamp(targetX - player.x, -maxStep, maxStep);
	return { ...player, x: player.x + move };
}
