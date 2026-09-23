/**
 * Shot resolution: the feel core. Turns "who hit it, how hard, and how early
 * or late" into an outgoing ball velocity.
 *
 * **Every shot is aimed at a place and solved to land there.** The launch is
 * found by flying candidate trajectories through `stepBall` — the same
 * integrator the live ball uses — so a cleanly struck ball lands where it was
 * aimed at every power, from every contact height, with every spin. The
 * previous design picked a launch angle from a table and hoped; its mishits
 * landed 3-17m long, which is why rallies barely existed
 * (`llm-knowledge/decisions/0015-contact-model.md`).
 *
 * **The stroke is the direction.** A forehand sweeps the racket to the
 * left and the ball goes with it — screen-left, from either end, because both
 * players face the screen; a backhand goes right; an
 * overhead (`smash`) goes straight and hard. Timing is how it is hit, and it
 * is a trade: dead on time is a paced ball with room inside the line; early
 * takes it wider — more angle, until it is out; late holds it in the middle
 * and pushes it deeper — long, if it was hit hard. A mistimed ball also
 * floats, and a late one pops up
 * (`llm-knowledge/decisions/0016-stroke-decides-direction.md`).
 *
 * Power is depth and pace: a clean ball lands in the court rather than on
 * the baseline, and a harder one goes deeper and faster.
 *
 * `src/shared/**` is compiled under both a DOM-only and a Node-only tsconfig,
 * so this file names no DOM type and no Node global — see
 * `llm-knowledge/decisions/0002-host-authoritative-simulation.md`.
 */

import type { Side } from "../protocol.ts";
import { type BallEnv, stepBall } from "./ball.ts";
import { BALL_RADIUS, netHeightAt } from "./court.ts";
import type { Ball, Vec3 } from "./state.ts";

/**
 * The timing window, seconds around the ideal contact. A swing up to
 * `TIMING_EARLY` before it or `TIMING_LATE` after it meets the ball; anything
 * outside is a whiff. Early is wider than late because an early swing can be
 * held until the ball arrives, while a late one has to be rewound.
 */
export const TIMING_EARLY = 0.3;
export const TIMING_LATE = 0.2;

/**
 * Where "on time" sits relative to the sim's contact moment, seconds. The
 * phone's detector latency is subtracted exactly (`Swing.lag`), but the
 * network hop and the display's own latency are not, and both make a player
 * who swings exactly as the ball reaches their avatar arrive a little late.
 * **A calibration knob, not a measurement** — the first session with a phone
 * and a real screen should tune it by whether "on time" hits go down the
 * middle.
 */
export const TIMING_IDEAL = 0.04;

/** `|u|` inside which every clean groundstroke lands in — the band a player
 * can swing in without losing the point to their own timing. */
export const SAFE_TIMING = 0.38;

/** Hitter's-side offset of the aim, metres: dead on time, at the early edge
 * of the window, and at the late edge. The singles line is at 4.115: on time
 * is ~1.3m inside it, early crosses it past `SAFE_TIMING`. */
export const AIM_GOOD = 3.2;
export const AIM_OUT = 5.5;
export const AIM_CENTER = 0.6;

/** Landing depth past the net, metres, for the softest and hardest clean
 * swing. The service line is at 6.4 and the baseline at 11.89: a clean ball
 * lands in the court, not on the baseline. */
export const DEPTH_SOFT = 5.5;
export const DEPTH_HARD = 8.8;

/** Extra depth, metres, at the late edge of the window, for the softest and
 * the hardest swing: a soft late ball stays in, a hard one sails long. */
export const LONG_SOFT = 1.5;
export const LONG_HARD = 8;

/** Launch angle a groundstroke starts its search from, radians: a soft swing
 * is a loopy rally ball, a hard one is a drive. Raised only if the net needs
 * it. The shorter the landing, the more arc a ball needs to get there at a
 * sane pace — flat and short is a 33 m/s ball nobody can reach. */
export const ANGLE_SOFT = 0.45;
export const ANGLE_HARD = 0.04;

/** Extra launch angle, radians, per unit of timing error, and extra again
 * for lateness. A mistimed ball floats; a late one pops up. */
export const MISTIME_LIFT = 0.2;
export const LATE_POP = 0.25;

/** Height a groundstroke must clear the band by, metres. */
export const NET_MARGIN = 0.12;

/** Smash pace range, m/s, and how deep it lands past the net, metres. */
export const SMASH_SPEED_MIN = 22;
export const SMASH_SPEED_MAX = 34;
export const SMASH_DEPTH = 6.5;

/** Serve pace range, m/s, and how much of it a badly timed toss keeps. */
export const SERVE_SPEED_MIN = 17;
export const SERVE_SPEED_MAX = 36;
export const SERVE_MISTIMED = 0.8;

/** Serve landing depth past the net, metres. The service line is at 6.4. */
export const SERVE_DEPTH_SOFT = 4.4;
export const SERVE_DEPTH_HARD = 5.5;

const SOLVE_DT = 1 / 120;
const SOLVE_LIMIT = 600;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (x: number, lo: number, hi: number) =>
	Math.max(lo, Math.min(hi, x));

/**
 * `error` is swing time minus contact time, seconds. Returns -1 (as early as
 * still connects) through 0 (on time) to +1 (as late as still connects), or
 * `undefined` for a swing that meets nothing.
 */
export function timingOf(error: number): number | undefined {
	const x = error - TIMING_IDEAL;
	if (x < -TIMING_EARLY || x > TIMING_LATE) return undefined;
	return x < 0 ? x / TIMING_EARLY : x / TIMING_LATE;
}

/**
 * World `x` sign of the left of the screen. The camera sits behind the near
 * baseline, and **both players stand facing the same screen**, so a forehand
 * — the racket sweeping to the player's left — goes to screen-left from
 * either end. Reading it as the far avatar's own left would send a far
 * player's ball the opposite way to their swing.
 */
export const SCREEN_LEFT = -1;

/** World `x` sign of the left of `side`'s screen. On one shared screen that
 * is `SCREEN_LEFT` for both. On a split screen each player watches from
 * behind their own baseline, so the far player's screen-left is their own
 * left, +x — and a forehand still goes left on the screen they are looking
 * at. */
export const screenLeftOf = (side: Side, split: boolean): number =>
	split && side === "far" ? -SCREEN_LEFT : SCREEN_LEFT;

/** Which way `side` hits: -1 toward -z (the near player), +1 toward +z. */
export const forwardOf = (side: Side): number => (side === "near" ? -1 : 1);

/** World `x` of the hitter's right hand: the near player faces -z, so their
 * right is +x; the far player faces the other way. */
export const rightOf = (side: Side): number => (side === "near" ? 1 : -1);

interface Flight {
	/** Horizontal distance from the launch point to the first bounce, or 0
	 * when the net stopped it. */
	readonly distance: number;
	/** How far the ball cleared the band by, metres. Negative is a clip. */
	readonly clearance: number;
}

function fly(from: Vec3, v: Vec3, env: BallEnv): Flight {
	let ball: Ball = { p: from, v };
	let clearance = Number.POSITIVE_INFINITY;
	for (let i = 0; i < SOLVE_LIMIT; i++) {
		const step = stepBall(ball, SOLVE_DT, env);
		ball = step.ball;
		if (step.net) {
			if (step.net.hit) return { distance: 0, clearance: -1 };
			clearance = step.net.y - BALL_RADIUS - netHeightAt(step.net.x);
		}
		if (step.bounce) {
			return {
				distance: Math.hypot(step.bounce.x - from.x, step.bounce.z - from.z),
				clearance,
			};
		}
	}
	return { distance: Number.POSITIVE_INFINITY, clearance };
}

const velocity = (
	dir: { x: number; z: number },
	speed: number,
	angle: number,
): Vec3 => ({
	x: dir.x * speed * Math.cos(angle),
	y: speed * Math.sin(angle),
	z: dir.z * speed * Math.cos(angle),
});

/** Bisection on a quantity `distance` increases with. */
function solve(
	lo: number,
	hi: number,
	want: number,
	distance: (k: number) => number,
): number {
	for (let i = 0; i < 28; i++) {
		const mid = (lo + hi) / 2;
		if (distance(mid) < want) lo = mid;
		else hi = mid;
	}
	return (lo + hi) / 2;
}

function toward(from: Vec3, target: { x: number; z: number }) {
	const dx = target.x - from.x;
	const dz = target.z - from.z;
	const d = Math.hypot(dx, dz);
	return { dir: { x: dx / d, z: dz / d }, distance: d };
}

/** How far `u` is past the safe band on each side, 0..1. */
function overshoot(u: number): { early: number; late: number } {
	const past = (x: number) =>
		clamp((x - SAFE_TIMING) / (1 - SAFE_TIMING), 0, 1);
	return { early: past(-u), late: past(u) };
}

/** 1 dead on time, falling to 0 at the edge of the safe band. */
const quality = (u: number): number =>
	clamp(1 - Math.abs(u) / SAFE_TIMING, 0, 1);

/**
 * A groundstroke or volley struck at `from` by `side` with `stroke`, timed
 * `u` (see `timingOf`), at `power` 0..1, flying in `env` (the spin of this
 * shot).
 */
export function groundstroke(
	from: Vec3,
	side: Side,
	stroke: "forehand" | "backhand",
	u: number,
	power: number,
	env: BallEnv,
	screenLeft = SCREEN_LEFT,
): Vec3 {
	const p = clamp(power, 0, 1);
	const t = clamp(u, -1, 1);
	const early = Math.max(0, -t);
	const late = Math.max(0, t);
	const wide =
		AIM_GOOD + early * (AIM_OUT - AIM_GOOD) - late * (AIM_GOOD - AIM_CENTER);
	const target = {
		x: (stroke === "forehand" ? screenLeft : -screenLeft) * wide,
		z:
			forwardOf(side) *
			(lerp(DEPTH_SOFT, DEPTH_HARD, p) + late * lerp(LONG_SOFT, LONG_HARD, p)),
	};
	const { dir, distance } = toward(from, target);

	// The speed that lands a launch at `angle` on the target, and whether
	// that trajectory clears the band.
	const launch = (angle: number): { v: Vec3; clears: boolean } => {
		const speed = solve(
			4,
			50,
			distance,
			(s) => fly(from, velocity(dir, s, angle), env).distance,
		);
		const v = velocity(dir, speed, angle);
		return { v, clears: fly(from, v, env).clearance >= NET_MARGIN };
	};

	const start =
		lerp(ANGLE_SOFT, ANGLE_HARD, p) +
		Math.abs(t) * MISTIME_LIFT +
		late * LATE_POP;
	const direct = launch(start);
	if (direct.clears) return direct.v;
	// A low ball struck flat finds the net: lift it by the least that clears,
	// found by bisection so a harder swing is never lifted further than a
	// softer one and never comes off the racket slower.
	let lo = start;
	let hi = 1;
	for (let i = 0; i < 14; i++) {
		const mid = (lo + hi) / 2;
		if (launch(mid).clears) hi = mid;
		else lo = mid;
	}
	return launch(hi).v;
}

/** The angle that lands a ball struck at `speed` on the target, shedding
 * pace until it clears the band by `margin` — a ball hit down from overhead
 * can only land short by skimming it. */
function driven(
	from: Vec3,
	target: { x: number; z: number },
	speed: number,
	margin: number,
	env: BallEnv,
): Vec3 {
	const { dir, distance } = toward(from, target);
	let pace = speed;
	let v = velocity(dir, pace, 0);
	for (let i = 0; i < 16; i++) {
		const angle = solve(
			-0.8,
			0.6,
			distance,
			(a) => fly(from, velocity(dir, pace, a), env).distance,
		);
		v = velocity(dir, pace, angle);
		if (fly(from, v, env).clearance >= margin) return v;
		pace *= 0.93;
	}
	return v;
}

/**
 * An overhead taken out of the air at `from`: straight down the middle,
 * hard. Timing sets the pace, and past `SAFE_TIMING` sprays it sideways —
 * the error, not a direction anyone chooses.
 */
export function smash(
	from: Vec3,
	side: Side,
	u: number,
	power: number,
	env: BallEnv,
): Vec3 {
	const p = clamp(power, 0, 1);
	const over = overshoot(u);
	const spray = (over.late - over.early) * AIM_OUT;
	const target = {
		x: rightOf(side) * spray,
		z: forwardOf(side) * SMASH_DEPTH,
	};
	const speed =
		lerp(SMASH_SPEED_MIN, SMASH_SPEED_MAX, p) * lerp(0.8, 1, quality(u));
	return driven(from, target, speed, NET_MARGIN, env);
}

/**
 * A serve struck at `from` by `side` toward `targetX` in the receiver's box.
 * `quality` 0..1 is how close to the top of the toss it was hit.
 */
export function serveShot(
	from: Vec3,
	side: Side,
	targetX: number,
	power: number,
	quality: number,
	env: BallEnv,
): Vec3 {
	const p = clamp(power, 0, 1);
	const target = {
		x: targetX,
		z: forwardOf(side) * lerp(SERVE_DEPTH_SOFT, SERVE_DEPTH_HARD, p),
	};
	const speed =
		lerp(SERVE_SPEED_MIN, SERVE_SPEED_MAX, p) *
		lerp(SERVE_MISTIMED, 1, clamp(quality, 0, 1));
	return driven(from, target, speed, 0.05, env);
}
