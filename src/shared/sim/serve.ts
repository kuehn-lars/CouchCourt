/**
 * The serve, Wii style: one swing tosses the ball, the next one hits it, and
 * hitting it at the top of the toss is what makes it fast. A toss nobody hits
 * is caught and costs nothing.
 *
 * Also where each player stands for it: the server alternates deuce and ad
 * court by point, and the serve is aimed at the box diagonally opposite.
 *
 * `src/shared/**` is compiled under both a DOM-only and a Node-only tsconfig,
 * so this file names no DOM type and no Node global — see
 * `llm-knowledge/decisions/0002-host-authoritative-simulation.md`.
 */

import type { Side } from "../protocol.ts";
import { type BallEnv, DRAG_K, stepBall } from "./ball.ts";
import { BASELINE_Z } from "./court.ts";
import type { PointValue, Score } from "./scoring.ts";
import { forwardOf, rightOf } from "./shot.ts";
import type { Ball, Vec3 } from "./state.ts";

/** Height the ball is held at and caught back at, metres. */
export const HAND_HEIGHT = 1.2;

/** Upward speed of the toss, m/s. Peaks about 1.3m above the hand after
 * ~0.5s — long enough to see and to swing at, short enough not to wait on. */
export const TOSS_SPEED = 5.2;

/** Seconds after the toss before a swing can hit it. The swing that tossed
 * the ball has a follow-through, and the phone may report it as a second
 * peak; that must not serve. */
export const TOSS_MIN_HIT = 0.2;

/** Seconds either side of the top of the toss over which serve quality runs
 * from 1 down to 0, and serve direction from the T to wide. */
export const SERVE_TIMING_WIDTH = 0.35;

/** How far off the centre mark the server stands, metres. */
export const SERVE_STAND_X = 0.8;

/** `|x|` of the middle of a service box, and how far timing moves the aim. */
export const SERVE_BOX_X = 2;
export const SERVE_AIM_SPREAD = 1;

const FLAT: BallEnv = { gravityScale: 1, drag: DRAG_K };
const STEP = 1 / 120;

/** The ball in the server's hand, before or after a toss. */
export function heldBall(hand: Vec3): Ball {
	return { p: hand, v: { x: 0, y: 0, z: 0 } };
}

/** Where the toss starts: the server's free hand, in front of them. */
export function handOf(side: Side, player: { x: number; z: number }): Vec3 {
	return {
		x: player.x - rightOf(side) * 0.15,
		y: HAND_HEIGHT,
		z: player.z + forwardOf(side) * 0.35,
	};
}

/** The tossed ball `elapsed` seconds after leaving `hand`, stepped exactly
 * as the live ball is, so a swing back-dated into the toss finds the ball
 * where it was drawn. */
export function tossBall(hand: Vec3, elapsed: number): Ball {
	let ball: Ball = { p: hand, v: { x: 0, y: TOSS_SPEED, z: 0 } };
	let left = elapsed;
	while (left > 1e-9) {
		const dt = Math.min(STEP, left);
		ball = stepBall(ball, dt, FLAT).ball;
		left -= dt;
	}
	return ball;
}

/** Seconds from the toss to its top. */
export const TOSS_APEX: number = (() => {
	let ball: Ball = {
		p: { x: 0, y: HAND_HEIGHT, z: 0 },
		v: { x: 0, y: TOSS_SPEED, z: 0 },
	};
	let t = 0;
	while (ball.v.y > 0) {
		ball = stepBall(ball, STEP, FLAT).ball;
		t += STEP;
	}
	return t;
})();

const RUNG: Readonly<Record<string, number>> = {
	0: 0,
	15: 1,
	30: 2,
	40: 3,
	AD: 4,
};
const rung = (p: PointValue): number => RUNG[String(p)] ?? 0;

/** An even number of points played in the game (or tiebreak) is the deuce
 * court: the server's right. */
export function deuceCourt(score: Score): boolean {
	const played = score.tiebreak
		? score.tiebreak.points.near + score.tiebreak.points.far
		: rung(score.points.near) + rung(score.points.far);
	return played % 2 === 0;
}

export interface ServeSetup {
	readonly server: { x: number; z: number };
	readonly receiver: { x: number; z: number };
	/** World `x` the serve aims at when struck dead on the top of the toss. */
	readonly targetX: number;
}

export function serveSetup(score: Score): ServeSetup {
	const side = score.server;
	const lean = rightOf(side) * (deuceCourt(score) ? 1 : -1);
	const back = (s: Side) => (s === "near" ? 1 : -1) * (BASELINE_Z + 0.3);
	return {
		server: { x: lean * SERVE_STAND_X, z: back(side) },
		receiver: {
			x: -lean * SERVE_BOX_X,
			z: side === "near" ? -(BASELINE_Z + 0.5) : BASELINE_Z + 0.5,
		},
		targetX: -lean * SERVE_BOX_X,
	};
}

/** Serve timing against the top of the toss: -1 (early) to +1 (late). */
export function serveTiming(sinceToss: number): number {
	const u = (sinceToss - TOSS_APEX) / SERVE_TIMING_WIDTH;
	return Math.max(-1, Math.min(1, u));
}

/** Where a serve timed `u` from `side` is aimed: a little wider or a little
 * more down the T, never out. */
export function serveTargetX(setup: ServeSetup, side: Side, u: number): number {
	return setup.targetX + rightOf(side) * u * SERVE_AIM_SPREAD;
}
