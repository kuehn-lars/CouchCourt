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
 * **Direction is timing, as in Wii Tennis.** An early swing pulls the ball
 * across the body, a late one pushes it the other way; the stroke side comes
 * from where the ball is, not from the phone. Power is depth and pace. Only a
 * swing at the ragged edge of the timing window is sent out wide — the risk
 * of going for the line.
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

/** `|u|` beyond which a shot is aimed past the sideline. */
export const SAFE_TIMING = 0.5;

/** Hitter's-right offset, metres, of the aim at `|u| = SAFE_TIMING`, and at
 * the very edge of the window. The first is ~0.8m inside the singles line;
 * the second is ~0.9m outside it. */
export const AIM_WIDE = 3.3;
export const AIM_OUT = 5.5;

/** Landing depth past the net, metres, for the softest and hardest swing.
 * The baseline is at 11.89. */
export const DEPTH_SOFT = 7;
export const DEPTH_HARD = 10;

/** Launch angle a groundstroke starts its search from, radians: a soft swing
 * is a loopy rally ball, a hard one is flat. Raised only if the net needs it. */
export const ANGLE_SOFT = 0.2;
export const ANGLE_HARD = 0.03;

/** Height a groundstroke must clear the band by, metres. */
export const NET_MARGIN = 0.12;

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

/** Hitter's-right offset, metres, of a shot timed `u`. */
function aimOffset(u: number): number {
	const a = Math.abs(u);
	const wide =
		a <= SAFE_TIMING
			? (a / SAFE_TIMING) * AIM_WIDE
			: lerp(AIM_WIDE, AIM_OUT, (a - SAFE_TIMING) / (1 - SAFE_TIMING));
	return Math.sign(u) * wide;
}

/**
 * A groundstroke or volley struck at `from` by `side`, timed `u` (see
 * `timingOf`), at `power` 0..1, flying in `env` (the spin of this shot).
 */
export function groundstroke(
	from: Vec3,
	side: Side,
	stroke: "forehand" | "backhand",
	u: number,
	power: number,
	env: BallEnv,
): Vec3 {
	const p = clamp(power, 0, 1);
	// Early pulls across the body: a forehand to the hitter's left, a
	// backhand to their right. Late does the opposite.
	const lateral = (stroke === "forehand" ? 1 : -1) * aimOffset(u);
	const target = {
		x: rightOf(side) * lateral,
		z: forwardOf(side) * lerp(DEPTH_SOFT, DEPTH_HARD, p),
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

	const start = lerp(ANGLE_SOFT, ANGLE_HARD, p);
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
	const { dir, distance } = toward(from, target);

	let speed =
		lerp(SERVE_SPEED_MIN, SERVE_SPEED_MAX, p) *
		lerp(SERVE_MISTIMED, 1, clamp(quality, 0, 1));
	let v = velocity(dir, speed, 0);
	for (let i = 0; i < 16; i++) {
		const angle = solve(
			-0.5,
			0.5,
			distance,
			(a) => fly(from, velocity(dir, speed, a), env).distance,
		);
		v = velocity(dir, speed, angle);
		// Hit down from overhead, a fast serve can only land short by skimming
		// the band. Take pace off until it clears.
		if (fly(from, v, env).clearance >= 0.05) return v;
		speed *= 0.93;
	}
	return v;
}
