import { describe, expect, it } from "vitest";
import type { Side } from "../protocol.ts";
import { type BallEnv, DRAG_K, stepBall } from "./ball.ts";
import {
	BASELINE_Z,
	isInBounds,
	isInServiceBox,
	SINGLES_HALF_WIDTH,
} from "./court.ts";
import {
	groundstroke,
	SAFE_TIMING,
	serveShot,
	TIMING_EARLY,
	TIMING_IDEAL,
	TIMING_LATE,
	timingOf,
} from "./shot.ts";
import type { Ball, Vec3 } from "./state.ts";

const FLAT: BallEnv = { gravityScale: 1, drag: DRAG_K };
const DT = 1 / 120;

/** Flies a shot to its first bounce, or reports the net stopping it. */
function land(
	from: Vec3,
	v: Vec3,
	env: BallEnv = FLAT,
): { x: number; z: number } | "net" | "never" {
	let ball: Ball = { p: from, v };
	for (let i = 0; i < 1200; i++) {
		const step = stepBall(ball, DT, env);
		ball = step.ball;
		if (step.net?.hit) return "net";
		if (step.bounce) return step.bounce;
	}
	return "never";
}

const baseline = (side: Side, x = 0, y = 0.9): Vec3 => ({
	x,
	y,
	z: side === "near" ? BASELINE_Z : -BASELINE_Z,
});

describe("timingOf", () => {
	it("is 0 for a swing on the ideal moment", () => {
		expect(timingOf(TIMING_IDEAL)).toBe(0);
	});

	it("runs to -1 at the early edge and +1 at the late edge", () => {
		expect(timingOf(TIMING_IDEAL - TIMING_EARLY)).toBeCloseTo(-1);
		expect(timingOf(TIMING_IDEAL + TIMING_LATE)).toBeCloseTo(1);
	});

	it("is undefined outside the window — the racket meets nothing", () => {
		expect(timingOf(TIMING_IDEAL - TIMING_EARLY - 0.01)).toBeUndefined();
		expect(timingOf(TIMING_IDEAL + TIMING_LATE + 0.01)).toBeUndefined();
	});
});

describe("groundstroke", () => {
	const powers = [0.15, 0.3, 0.5, 0.7, 0.85, 1];
	const heights = [0.25, 0.6, 1, 1.6];
	const xs = [-3.5, 0, 3.5];

	it("lands in, over the net, from anywhere on the baseline at any power and height", () => {
		for (const side of ["near", "far"] as const) {
			for (const power of powers) {
				for (const y of heights) {
					for (const x of xs) {
						for (const u of [-SAFE_TIMING, -0.4, 0, 0.4, SAFE_TIMING]) {
							for (const stroke of ["forehand", "backhand"] as const) {
								const from = baseline(side, x, y);
								const at = land(
									from,
									groundstroke(from, side, stroke, u, power, FLAT),
								);
								if (at === "net" || at === "never") {
									throw new Error(
										`${side} ${stroke} p${power} y${y} x${x} u${u}: ${at}`,
									);
								}
								expect(isInBounds(at.x, at.z)).toBe(true);
								// And on the opponent's side of the net.
								expect(Math.sign(at.z)).toBe(side === "near" ? -1 : 1);
							}
						}
					}
				}
			}
		}
	});

	it("lands where it was aimed, with topspin and slice as well as flat", () => {
		for (const gravityScale of [0.85, 1, 1.35]) {
			const env = { gravityScale, drag: DRAG_K };
			const from = baseline("near");
			const flat = land(
				from,
				groundstroke(from, "near", "forehand", 0, 0.6, env),
				env,
			);
			const loaded = land(
				from,
				groundstroke(from, "near", "forehand", 0, 0.6, FLAT),
				FLAT,
			);
			if (typeof flat === "string" || typeof loaded === "string") {
				throw new Error("did not land");
			}
			expect(Math.abs(flat.z - loaded.z)).toBeLessThan(0.5);
		}
	});

	it("goes deeper and faster the harder the swing", () => {
		const from = baseline("near");
		let lastSpeed = 0;
		let lastDepth = 0;
		for (const power of powers) {
			const v = groundstroke(from, "near", "forehand", 0, power, FLAT);
			const speed = Math.hypot(v.x, v.y, v.z);
			const at = land(from, v);
			if (typeof at === "string") throw new Error("did not land");
			expect(speed).toBeGreaterThan(lastSpeed);
			expect(-at.z).toBeGreaterThanOrEqual(lastDepth - 0.05);
			lastSpeed = speed;
			lastDepth = -at.z;
		}
	});

	// The Wii rule: an early swing pulls the ball across the body, a late one
	// pushes it the other way. The near player faces -z, so their right is +x.
	it("pulls an early forehand to the hitter's left and pushes a late one right", () => {
		const from = baseline("near");
		const early = land(
			from,
			groundstroke(from, "near", "forehand", -0.7, 0.6, FLAT),
		);
		const late = land(
			from,
			groundstroke(from, "near", "forehand", 0.7, 0.6, FLAT),
		);
		if (typeof early === "string" || typeof late === "string") {
			throw new Error("did not land");
		}
		expect(early.x).toBeLessThan(-1.5);
		expect(late.x).toBeGreaterThan(1.5);
	});

	it("mirrors that for a backhand", () => {
		const from = baseline("near");
		const early = land(
			from,
			groundstroke(from, "near", "backhand", -0.7, 0.6, FLAT),
		);
		if (typeof early === "string") throw new Error("did not land");
		expect(early.x).toBeGreaterThan(1.5);
	});

	it("mirrors it for the far player, whose right is -x", () => {
		const from = baseline("far");
		const early = land(
			from,
			groundstroke(from, "far", "forehand", -0.7, 0.6, FLAT),
		);
		if (typeof early === "string") throw new Error("did not land");
		expect(early.x).toBeGreaterThan(1.5);
	});

	it("sends a swing at the very edge of the window wide", () => {
		const from = baseline("near");
		for (const u of [-1, 1]) {
			const at = land(
				from,
				groundstroke(from, "near", "forehand", u, 0.6, FLAT),
			);
			if (typeof at === "string") throw new Error("did not land");
			expect(Math.abs(at.x)).toBeGreaterThan(SINGLES_HALF_WIDTH);
		}
	});
});

describe("serveShot", () => {
	it("lands in the service box at every power and quality, from both ends, both courts", () => {
		for (const side of ["near", "far"] as const) {
			for (const targetX of [-2.4, -1, 1, 2.4]) {
				for (const power of [0.15, 0.4, 0.7, 1]) {
					for (const quality of [0.4, 1]) {
						for (const y of [2.1, 2.5, 2.8]) {
							const from = baseline(side, targetX > 0 ? -0.8 : 0.8, y);
							const v = serveShot(from, side, targetX, power, quality, FLAT);
							const at = land(from, v);
							if (typeof at === "string") {
								throw new Error(
									`${side} x${targetX} p${power} q${quality}: ${at}`,
								);
							}
							const receiver = side === "near" ? "far" : "near";
							expect(isInServiceBox(at.x, at.z, receiver)).toBe(true);
						}
					}
				}
			}
		}
	});

	it("is faster the harder and the cleaner it is struck", () => {
		const from = baseline("near", 0.8, 2.6);
		const speed = (p: number, q: number) => {
			const v = serveShot(from, "near", -2, p, q, FLAT);
			return Math.hypot(v.x, v.y, v.z);
		};
		expect(speed(1, 1)).toBeGreaterThan(speed(0.4, 1));
		expect(speed(1, 1)).toBeGreaterThan(speed(1, 0.4));
	});
});
