/**
 * Automatic player movement. v1 has no manual movement, so the sim positions
 * each player itself: predict where the ball crosses the receiver's strike
 * plane, then ease toward that `x` at a capped speed.
 *
 * The predictor reuses `stepBall` rather than a closed-form solve — one
 * physics implementation, so this can never drift out of sync with what the
 * ball actually does (`llm-knowledge/modules/shared-sim.md`, "Invariants").
 * Positioning is generous by construction: whether the shot is good is
 * decided by timing in `shot.ts`, not by whether the avatar got there.
 *
 * `src/shared/**` is compiled under both a DOM-only and a Node-only tsconfig,
 * so this file names no DOM type and no Node global — see
 * `llm-knowledge/decisions/0002-host-authoritative-simulation.md`.
 */

import type { Side } from "../protocol.ts";
import { type BallEnv, stepBall } from "./ball.ts";
import { BASELINE_Z, SINGLES_HALF_WIDTH } from "./court.ts";
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

/**
 * How far behind the bounce a player stands to take the ball off it, metres.
 * You do not stand on the spot the ball lands; you stand back and let it come
 * up to you. Small enough that a drop shot still drags the player in.
 */
export const STRIKE_BACK_OFF = 1.4;

/** The band of heights a standing player can put a racket on, metres. Below
 * the bottom of it the ball is at their ankles; above the top they would be
 * jumping, which no avatar here does. */
export const STRIKE_HEIGHT_MIN = 0.3;
export const STRIKE_HEIGHT_MAX = 2.1;

/** How far behind their own baseline a player may run back to. Real players
 * do; the court lines are not a wall. */
export const RUN_BACK = 2;

/** How far outside the singles sideline a player may chase. */
export const RUN_WIDE = 1.5;

/** How close to the net a player may come. Not zero — nobody stands on the
 * net cord — and it keeps a drop shot from pulling them through it. */
export const NET_KEEP_OUT = 0.9;

/**
 * How far from where a player stands they can still put a racket on the ball,
 * metres. A racket plus a lean, not a dive.
 *
 * Without it a strike point only counts as reachable when the player's feet
 * are exactly on it, and a ball moving at 20 m/s away from a player running
 * at 8 can never satisfy that — so a receiver standing right next to a ball
 * would be judged unable to touch it, and go on rejecting it until it was
 * clamped against the back fence. Watched happening: the perfect bot let
 * every serve go by from 1.2m away.
 */
export const STRIKE_REACH = 1.2;

/** Where a player will meet the ball, and when. */
export interface Strike {
	readonly x: number;
	readonly z: number;
	/** Height of the ball at that moment, metres. Read for the contact point,
	 * which decides how much launch angle the shot needs. */
	readonly y: number;
	/** Seconds from now until the ball is there. */
	readonly t: number;
	/** True when the ball is being taken before it bounces. */
	readonly air: boolean;
}

const halfSign = (side: Side): number => (side === "near" ? 1 : -1);

/** `p` clamped to the half of the court `side` is allowed to stand in. */
function keepOnCourt(
	side: Side,
	x: number,
	z: number,
): { x: number; z: number } {
	const sign = halfSign(side);
	const near = sign * NET_KEEP_OUT;
	const deep = sign * (BASELINE_Z + RUN_BACK);
	return {
		x: clamp(
			x,
			-(SINGLES_HALF_WIDTH + RUN_WIDE),
			SINGLES_HALF_WIDTH + RUN_WIDE,
		),
		z: sign > 0 ? clamp(z, near, deep) : clamp(z, deep, near),
	};
}

/** Seconds for `from` to get a racket to `(x, z)` — the ground they must
 * cover beyond their own reach, at `PLAYER_SPEED`. */
function timeToReach(from: Player, x: number, z: number): number {
	const gap = Math.hypot(x - from.x, z - from.z) - STRIKE_REACH;
	return gap <= 0 ? 0 : gap / PLAYER_SPEED;
}

/**
 * Where the player on `side` will meet `ball`, and when — the one answer both
 * their feet and their timing are judged against.
 *
 * `alreadyBounced` is the caller's `bounces > 0`: once the ball has bounced,
 * a second bounce loses the point, so there is no ground option left and the
 * only question is where it can be volleyed.
 *
 * Walks the real trajectory once, exactly as `predictCrossingX` does and for
 * the same reason: one physics implementation, so the place the player runs
 * to can never be somewhere the ball does not go.
 *
 * Two candidates come out of that walk. The **ground strike** is a step
 * behind the first bounce on this side of the net — the ordinary groundstroke,
 * and what the player takes whenever they can get there. The **air strike** is
 * the first moment the ball is over their half at a height a racket reaches,
 * and it is what they fall back on when the bounce is out of reach: a ball
 * driven deep past a player caught at the net, or one that will bounce behind
 * their baseline and is gone if they let it.
 *
 * Choosing between them on *reachability* rather than on a volley flag is what
 * makes it behave: it is the decision a real player makes, and it needs no
 * rule about when a volley is allowed.
 */
export function predictStrike(
	ball: Ball,
	env: BallEnv,
	side: Side,
	from: Player,
	alreadyBounced = false,
): Strike {
	const sign = halfSign(side);
	const ours = (z: number): boolean => z * sign > 0;
	/** Has the ball reached `z`, coming toward this player's end? */
	const reached = (z: number, mark: number): boolean =>
		sign > 0 ? z >= mark : z <= mark;

	let current = ball;
	/** Set once the bounce is seen; the walk then continues to find WHEN the
	 * ball gets back to the spot behind it, from the physics rather than from
	 * a guess. An earlier version added `STRIKE_BACK_OFF / PLAYER_SPEED` —
	 * the time for the PLAYER to cover that gap, not the ball, which is four
	 * times too long and put every contact 100ms late. */
	let spot: { x: number; z: number } | undefined;
	let ground: Strike | undefined;
	let air: Strike | undefined;
	let last: Strike | undefined;

	for (let i = 0; i * PREDICTION_DT < MAX_LOOKAHEAD; i++) {
		const step = stepBall(current, PREDICTION_DT, env);
		const t = (i + 1) * PREDICTION_DT;
		const p = step.ball.p;
		current = step.ball;

		if (!ours(p.z)) continue;
		last = { x: p.x, z: p.z, y: p.y, t, air: !alreadyBounced };

		if (spot !== undefined) {
			// Past the bounce, walking on to the spot the player waits at.
			// A second bounce on the way means it died short: meet it there.
			if (reached(p.z, spot.z) || step.bounce) {
				ground = {
					...spot,
					y: clamp(p.y, STRIKE_HEIGHT_MIN, STRIKE_HEIGHT_MAX),
					t,
					air: false,
				};
				break;
			}
			continue;
		}

		// A ball that has already bounced once has to be taken out of the
		// air — letting it bounce again loses the point — so the ground
		// option does not exist and the walk looks only for a volley.
		if (!alreadyBounced && step.bounce && ours(step.bounce.z)) {
			spot = keepOnCourt(
				side,
				step.bounce.x,
				step.bounce.z + sign * STRIKE_BACK_OFF,
			);
			continue;
		}

		if (
			air === undefined &&
			p.y >= STRIKE_HEIGHT_MIN &&
			p.y <= STRIKE_HEIGHT_MAX
		) {
			const at = keepOnCourt(side, p.x, p.z);
			if (timeToReach(from, at.x, at.z) <= t) {
				air = { ...at, y: p.y, t, air: true };
			}
		}
	}

	// Off the bounce whenever the player can get behind it. That is the shot
	// they want, and it is the one with weight behind it.
	if (ground && timeToReach(from, ground.x, ground.z) <= ground.t)
		return ground;
	if (air) return air;
	if (ground) return ground; // out of reach either way: chase it anyway
	if (last) return last;

	// The ball never enters this half at all — it is going away, or it is
	// being held for a serve. Hold station rather than running toward a
	// prediction that does not exist.
	const home = keepOnCourt(side, from.x, sign * BASELINE_Z);
	return { ...home, y: STRIKE_HEIGHT_MIN, t: MAX_LOOKAHEAD, air: false };
}

/** Ease `player` toward `target`, covering at most `PLAYER_SPEED * dt` of
 * ground. Capped on the distance, not per axis — capping each axis on its own
 * would let a diagonal run be 1.41x faster than a straight one. */
export function movePlayer(
	player: Player,
	target: { x: number; z: number },
	dt: number,
): Player {
	const maxStep = PLAYER_SPEED * dt;
	const dx = target.x - player.x;
	const dz = target.z - player.z;
	const distance = Math.hypot(dx, dz);
	if (distance <= maxStep) return { ...player, x: target.x, z: target.z };
	const f = maxStep / distance;
	return { ...player, x: player.x + dx * f, z: player.z + dz * f };
}
