/**
 * Automatic player movement. v1 has no manual movement, so the sim positions
 * each player itself: `predictStrike` says where and when they will meet the
 * ball, `rally.ts` freezes that as the contact, and the player runs to stand
 * beside it at a capped speed.
 *
 * The predictor reuses `stepBall` rather than a closed-form solve — one
 * physics implementation, so this can never drift out of sync with what the
 * ball actually does (`llm-knowledge/modules/shared-sim.md`, "Invariants").
 *
 * `src/shared/**` is compiled under both a DOM-only and a Node-only tsconfig,
 * so this file names no DOM type and no Node global — see
 * `llm-knowledge/decisions/0002-host-authoritative-simulation.md`.
 */

import type { Side } from "../protocol.ts";
import { type BallEnv, stepBall } from "./ball.ts";
import { BASELINE_Z, SINGLES_HALF_WIDTH } from "./court.ts";
import type { Ball, Player, Vec3 } from "./state.ts";

/** Running speed, m/s. A sprinting pro manages ~7. Fast enough that a player
 * reaches a ball hit at them, slow enough that a sharp angle can beat them —
 * which is the only way a point is won against auto-movement, exactly as in
 * Wii Tennis. */
export const PLAYER_SPEED = 4.5;

/** How fast a player walks back to the middle after their own shot, as a
 * fraction of `PLAYER_SPEED`. Sprinting back as fast as they chase meant
 * every player was always centred, nothing was ever out of reach, and a
 * point could only end on a mistake. Off balance after a wide ball, they
 * are not. */
export const RECOVERY = 0.45;

/** Step used to run the prediction forward. Matches the sim's own tick rate. */
export const PREDICTION_DT = 1 / 120;

/** Cap on how far ahead the predictor looks, seconds, so a ball that never
 * reaches the target plane (e.g. moving away from it) can't loop forever. */
export const MAX_LOOKAHEAD = 3;

const clamp = (x: number, lo: number, hi: number) =>
	Math.max(lo, Math.min(hi, x));

/** The band of heights a standing player can put a racket on, metres. Below
 * the bottom of it the ball is at their ankles; above the top they would be
 * jumping, which no avatar here does. */
export const STRIKE_HEIGHT_MIN = 0.3;
export const STRIKE_HEIGHT_MAX = 2.1;

/** How far behind their own baseline a player may run back to. Real players
 * do; the court lines are not a wall. */
export const RUN_BACK = 1;

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

/** Slack is for getting there: a player already in reach needs none, and
 * without that the plan would flip to a groundstroke while they stand under
 * the ball waiting for it. */
const canSmash = (run: number, t: number): boolean =>
	run === 0 || run + SMASH_SLACK <= t;

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
	/** Where the ball itself is at that moment — the contact point. `x`/`z`
	 * above are where the player wants their feet, which is not the same. */
	readonly ball: Vec3;
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

/** Height a groundstroke is taken at, metres: the ball has bounced, risen,
 * and dropped back to about the waist. */
export const STRIKE_COMFORT = 1.5;

/** Height, metres, a high ball is taken out of the air at, overhead: an arm
 * and a racket above a standing player. Coming down through it before the
 * bounce, within reach, is a chance to smash
 * (`llm-knowledge/decisions/0016-stroke-decides-direction.md`). */
export const SMASH_HEIGHT = 2.3;

/** Seconds of slack a smash chance needs over the bare running time: the
 * player reacts before running (`REACTION` in `rally.ts`) and has to be set
 * under the ball, not arriving as it falls past. */
export const SMASH_SLACK = 0.4;

/**
 * Where the player on `side` will meet `ball`, and when — the one answer both
 * their feet and their timing are judged against.
 *
 * `alreadyBounced` is the caller's `bounces > 0`: the bounce the walk would
 * look for is behind it, so the walk starts on the far side of it.
 *
 * Walks the real trajectory once through `stepBall`: one physics
 * implementation, so the place the player runs to can never be somewhere the
 * ball does not go.
 *
 * Two candidates come out of that walk. The **ground strike** is where the
 * ball, having bounced, comes back down to waist height — or the deepest a
 * player may run back to, if it is still up when it gets there. That is the
 * ordinary groundstroke. Until 2026-09-22 it was a fixed 1.4m behind the
 * bounce, which sent every receiver sprinting *at* a fast ball they would
 * naturally have let come to them, and made most serves unreturnable. The
 * **air strike** is the first moment the ball is over their half at a height
 * a racket reaches: a volley, taken when the bounce is out of reach.
 *
 * Choosing between them on *reachability* rather than on a volley flag is the
 * decision a real player makes, and it needs no rule about when a volley is
 * allowed.
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
	const deepest = sign * (BASELINE_Z + RUN_BACK);
	const tooDeep = (z: number): boolean =>
		sign > 0 ? z >= deepest : z <= deepest;

	let current = ball;
	let bounced = alreadyBounced;
	let ground: Strike | undefined;
	let air: Strike | undefined;
	let overhead: Strike | undefined;
	let last: Strike | undefined;

	for (let i = 0; i * PREDICTION_DT < MAX_LOOKAHEAD; i++) {
		const step = stepBall(current, PREDICTION_DT, env);
		const t = (i + 1) * PREDICTION_DT;
		const p = step.ball.p;
		current = step.ball;

		if (!ours(p.z)) continue;
		const here = keepOnCourt(side, p.x, p.z);
		last = { ...here, y: p.y, t, air: !bounced, ball: p };

		if (step.bounce) {
			// The second bounce: whatever was going to be played is gone.
			if (bounced) break;
			if (ours(step.bounce.z)) bounced = true;
			continue;
		}

		if (bounced) {
			const falling = step.ball.v.y <= 0;
			if ((falling && p.y <= STRIKE_COMFORT) || tooDeep(p.z)) {
				ground = { ...here, y: p.y, t, air: false, ball: p };
				break;
			}
			continue;
		}

		if (
			overhead === undefined &&
			step.ball.v.y <= 0 &&
			p.y <= SMASH_HEIGHT &&
			p.y - step.ball.v.y * PREDICTION_DT > SMASH_HEIGHT &&
			canSmash(timeToReach(from, here.x, here.z), t)
		) {
			overhead = { ...here, y: p.y, t, air: true, ball: p };
		}

		if (
			air === undefined &&
			p.y >= STRIKE_HEIGHT_MIN &&
			p.y <= STRIKE_HEIGHT_MAX &&
			timeToReach(from, here.x, here.z) <= t
		) {
			air = { ...here, y: p.y, t, air: true, ball: p };
		}
	}

	// A high ball they can get under is the best chance in the game.
	if (overhead) return overhead;
	// Off the bounce whenever the player can get there. That is the shot
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
	return {
		...home,
		y: STRIKE_HEIGHT_MIN,
		t: MAX_LOOKAHEAD,
		air: false,
		ball: { x: home.x, y: STRIKE_HEIGHT_MIN, z: home.z },
	};
}

/** How far to the side of the ball a player stands to swing at it, metres:
 * an arm and a racket. Standing on the ball reads as being hit by it. */
export const STANCE = 0.55;

/** Horizontal distance from the player at which a swing still finds the
 * ball, metres. Past this the ball has beaten them, whatever the timing. */
export const HIT_REACH = 1.4;

/** Where `side` stands to play a `stroke` at a ball met at `ball`: beside it,
 * on the racket side. The near player's right is +x. */
export function standFor(
	side: Side,
	ball: { x: number; z: number },
	stroke: "forehand" | "backhand",
): { x: number; z: number } {
	const right = side === "near" ? 1 : -1;
	const offset = right * STANCE * (stroke === "forehand" ? 1 : -1);
	return keepOnCourt(side, ball.x - offset, ball.z);
}

/** Where a player recovers to between shots: the middle, just behind the
 * baseline. */
export function homeFor(side: Side): { x: number; z: number } {
	return { x: 0, z: halfSign(side) * (BASELINE_Z + 0.4) };
}

/** The stroke a ball at `ballX` calls for from a player at `playerX`: the
 * racket side if it is on it or near the middle, the other side otherwise. */
export function strokeFor(
	side: Side,
	playerX: number,
	ballX: number,
): "forehand" | "backhand" {
	const right = side === "near" ? 1 : -1;
	return (ballX - playerX) * right >= -0.3 ? "forehand" : "backhand";
}

/** Ease `player` toward `target`, covering at most `PLAYER_SPEED * dt` of
 * ground. Capped on the distance, not per axis — capping each axis on its own
 * would let a diagonal run be 1.41x faster than a straight one. */
export function movePlayer(
	player: Player,
	target: { x: number; z: number },
	dt: number,
	speed = PLAYER_SPEED,
): Player {
	const maxStep = speed * dt;
	const dx = target.x - player.x;
	const dz = target.z - player.z;
	const distance = Math.hypot(dx, dz);
	if (distance <= maxStep) return { ...player, x: target.x, z: target.z };
	const f = maxStep / distance;
	return { ...player, x: player.x + dx * f, z: player.z + dz * f };
}
