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
	smash,
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
	const safe = [-SAFE_TIMING, -0.25, 0, 0.25, SAFE_TIMING];

	it("lands in, over the net, from anywhere on the baseline at any power and height", () => {
		for (const side of ["near", "far"] as const) {
			for (const power of powers) {
				for (const y of heights) {
					for (const x of xs) {
						for (const u of safe) {
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

	// The stroke is the direction, wherever the player is standing and
	// however the swing was timed. Both players face the same screen, so it
	// is the screen's left and right: a forehand sweeps the racket to the
	// left and the ball goes left, from either end of the court. (The camera
	// sits behind the near baseline, so screen-left is -x.)
	it("sends a forehand to screen-left and a backhand to screen-right, from either end", () => {
		for (const side of ["near", "far"] as const) {
			for (const x of xs) {
				for (const u of safe) {
					for (const power of [0.15, 0.6, 1]) {
						const from = baseline(side, x);
						const fore = land(
							from,
							groundstroke(from, side, "forehand", u, power, FLAT),
						);
						const back = land(
							from,
							groundstroke(from, side, "backhand", u, power, FLAT),
						);
						if (typeof fore === "string" || typeof back === "string") {
							throw new Error("did not land");
						}
						expect(fore.x).toBeLessThan(-0.5);
						expect(back.x).toBeGreaterThan(0.5);
					}
				}
			}
		}
	});

	// Timing is a trade, not only a grade: early takes the ball wider, into
	// the open court and toward the line; late holds it in the middle and
	// pushes it deeper.
	it("angles an early ball wider and holds a late one in the middle", () => {
		const from = baseline("near");
		const x = (u: number) => {
			const at = land(
				from,
				groundstroke(from, "near", "backhand", u, 0.6, FLAT),
			);
			if (typeof at === "string") throw new Error("did not land");
			return at.x;
		};
		expect(x(-SAFE_TIMING)).toBeGreaterThan(x(0) + 0.7);
		expect(x(SAFE_TIMING)).toBeLessThan(x(0) - 0.8);
		// On time is a good ball with room to spare, not a line call.
		expect(x(0)).toBeLessThan(SINGLES_HALF_WIDTH - 0.8);
		expect(x(0)).toBeGreaterThan(2);
	});

	it("comes off the racket faster when it is timed well", () => {
		const from = baseline("near");
		const speed = (u: number) => {
			const v = groundstroke(from, "near", "forehand", u, 0.7, FLAT);
			return Math.hypot(v.x, v.y, v.z);
		};
		expect(speed(0)).toBeGreaterThan(speed(SAFE_TIMING) * 1.05);
	});

	// Landing near the baseline every time made depth meaningless. A clean
	// ball now lands in the court, and only power pushes it back.
	it("lands a clean shot in the court, not on the baseline", () => {
		for (const power of powers) {
			const from = baseline("near");
			const at = land(
				from,
				groundstroke(from, "near", "forehand", 0, power, FLAT),
			);
			if (typeof at === "string") throw new Error("did not land");
			expect(-at.z).toBeLessThan(BASELINE_Z - 2.5);
			expect(-at.z).toBeGreaterThan(4.5);
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

	it("sprays a swing at the early edge of the window out wide", () => {
		const from = baseline("near");
		for (const stroke of ["forehand", "backhand"] as const) {
			const at = land(from, groundstroke(from, "near", stroke, -1, 0.6, FLAT));
			if (typeof at === "string") throw new Error("did not land");
			expect(Math.abs(at.x)).toBeGreaterThan(SINGLES_HALF_WIDTH);
		}
	});

	// Power is a risk as well as a reward: a hard swing that is late sails
	// long, a soft one that is late pops up and sits there to be punished.
	it("sails a hard, late swing long, and pops a soft one up short", () => {
		const from = baseline("near");
		const hard = land(from, groundstroke(from, "near", "forehand", 1, 1, FLAT));
		const soft = land(
			from,
			groundstroke(from, "near", "forehand", 1, 0.15, FLAT),
		);
		if (typeof hard === "string" || typeof soft === "string") {
			throw new Error("did not land");
		}
		expect(-hard.z).toBeGreaterThan(BASELINE_Z);
		expect(isInBounds(soft.x, soft.z)).toBe(true);
	});

	it("lands where it was aimed, with topspin and slice as well as flat", () => {
		for (const gravityScale of [0.85, 1, 1.35]) {
			const env = { gravityScale, drag: DRAG_K };
			const from = baseline("near");
			const spun = land(
				from,
				groundstroke(from, "near", "forehand", 0, 0.6, env),
				env,
			);
			const flat = land(
				from,
				groundstroke(from, "near", "forehand", 0, 0.6, FLAT),
				FLAT,
			);
			if (typeof spun === "string" || typeof flat === "string") {
				throw new Error("did not land");
			}
			expect(Math.abs(spun.z - flat.z)).toBeLessThan(0.5);
		}
	});
});

describe("smash", () => {
	const from = (side: Side, z: number, y: number): Vec3 => ({
		x: 0.5,
		y,
		z: side === "near" ? z : -z,
	});

	it("lands in from anywhere a high ball is taken, at any power, timed inside the safe band", () => {
		for (const side of ["near", "far"] as const) {
			for (const z of [3, 6, 9, 12.5]) {
				for (const y of [1.6, 2.1, 2.6]) {
					for (const power of [0.15, 0.6, 1]) {
						for (const u of [-SAFE_TIMING, 0, SAFE_TIMING]) {
							const p = from(side, z, y);
							const at = land(p, smash(p, side, u, power, FLAT));
							if (typeof at === "string") {
								throw new Error(`${side} z${z} y${y} p${power} u${u}: ${at}`);
							}
							expect(isInBounds(at.x, at.z)).toBe(true);
							expect(Math.sign(at.z)).toBe(side === "near" ? -1 : 1);
						}
					}
				}
			}
		}
	});

	it("is the fastest shot in the game", () => {
		const p = from("near", 8, 2.2);
		const s = smash(p, "near", 0, 0.6, FLAT);
		const g = groundstroke(p, "near", "forehand", 0, 1, FLAT);
		expect(Math.hypot(s.x, s.y, s.z)).toBeGreaterThan(
			Math.hypot(g.x, g.y, g.z),
		);
	});

	it("sprays at the edge of the window, like any other stroke", () => {
		const p = from("near", 8, 2.2);
		const at = land(p, smash(p, "near", -1, 0.6, FLAT));
		if (typeof at === "string") throw new Error("did not land");
		expect(isInBounds(at.x, at.z)).toBe(false);
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
