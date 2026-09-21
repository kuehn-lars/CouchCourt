import { describe, expect, it } from "vitest";
import type { Swing } from "../protocol.ts";
import { type BallEnv, stepBall } from "./ball.ts";
import { BASELINE_Z, SINGLES_HALF_WIDTH } from "./court.ts";
import { CLEAN_WINDOW, MISS_WINDOW, resolveShot } from "./shot.ts";
import type { Vec3 } from "./state.ts";

const ENV: BallEnv = { gravityScale: 1.3, drag: 0.0206 };

const swing = (kind: Swing["kind"], power: number): Swing => ({
	kind,
	power,
	at: 0,
});

const contact = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** Runs a shot forward to its first bounce, or gives up after a generous cap
 * of ticks — used to ask "where would this actually land" rather than
 * inspecting the raw outgoing vector. */
function land(p: Vec3, v: Vec3) {
	let ball = { p, v };
	for (let i = 0; i < 1000; i++) {
		const step = stepBall(ball, 1 / 120, ENV);
		if (step.bounce) return step.bounce;
		ball = step.ball;
	}
	return undefined;
}

describe("resolveShot", () => {
	it("a perfect max-power forehand from the baseline lands in", () => {
		const start = contact(0, 1, BASELINE_Z);
		const v = resolveShot(swing("forehand", 1), 0, start, "near");

		expect(v).toBeDefined();
		const bounce = land(start, v as Vec3);
		expect(bounce).toBeDefined();
		expect(Math.abs(bounce?.x ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(
			SINGLES_HALF_WIDTH,
		);
		expect(bounce?.z ?? 1).toBeLessThan(0);
		expect(bounce?.z ?? Number.NEGATIVE_INFINITY).toBeGreaterThanOrEqual(
			-BASELINE_Z,
		);
	});

	it("250ms of timing error lands short but does not whiff", () => {
		const start = contact(0, 1, BASELINE_Z);
		const clean = resolveShot(swing("forehand", 1), 0, start, "near") as Vec3;
		const late = resolveShot(swing("forehand", 1), 0.25, start, "near");

		expect(late).toBeDefined();
		const cleanBounce = land(start, clean);
		const lateBounce = land(start, late as Vec3);
		expect(cleanBounce).toBeDefined();
		expect(lateBounce).toBeDefined();
		expect(Math.abs(lateBounce?.z ?? 0)).toBeLessThan(
			Math.abs(cleanBounce?.z ?? 0),
		);
	});

	it("returns no shot at all past the miss window", () => {
		const start = contact(0, 1, BASELINE_Z);
		const v = resolveShot(
			swing("forehand", 1),
			MISS_WINDOW + 0.01,
			start,
			"near",
		);

		expect(v).toBeUndefined();
	});

	// The direction mechanic, replacing timing's sign on 2026-09-21 — see
	// llm-knowledge/decisions/0012-swing-kind-is-the-shot-direction.md.
	describe("direction comes from the swing, not from the timing", () => {
		const start = contact(0, 1, BASELINE_Z);

		it("sends a forehand and a backhand opposite ways from identical timing", () => {
			const fore = resolveShot(
				swing("forehand", 0.8),
				0,
				start,
				"near",
			) as Vec3;
			const back = resolveShot(
				swing("backhand", 0.8),
				0,
				start,
				"near",
			) as Vec3;

			expect(fore.x).not.toBe(0);
			expect(Math.sign(fore.x)).toBe(-Math.sign(back.x));
		});

		// A right-hander pulls the ball across their body. The near player
		// faces -z so their right side is +x, and a forehand there sweeps
		// toward -x; the far player faces the other way, so it mirrors. This
		// is the same convention bot.ts already uses to pick which stroke it
		// is playing, and the two must not drift apart.
		it("mirrors the same stroke for the far player", () => {
			const near = resolveShot(
				swing("forehand", 0.8),
				0,
				start,
				"near",
			) as Vec3;
			const far = resolveShot(
				swing("forehand", 0.8),
				0,
				contact(0, 1, -BASELINE_Z),
				"far",
			) as Vec3;

			expect(Math.sign(near.x)).toBe(-Math.sign(far.x));
		});

		it("pulls a forehand toward -x for the near player", () => {
			const fore = resolveShot(
				swing("forehand", 0.8),
				0,
				start,
				"near",
			) as Vec3;
			expect(fore.x).toBeLessThan(0);
		});

		it("does not let timing steer a cleanly struck ball: early and late go the same way", () => {
			const early = resolveShot(
				swing("forehand", 0.8),
				-0.1,
				start,
				"near",
			) as Vec3;
			const late = resolveShot(
				swing("forehand", 0.8),
				0.1,
				start,
				"near",
			) as Vec3;

			expect(early.x).toBe(late.x);
		});

		// The property a fixed sideways speed could not hold. A player who has
		// run to the corner must still be able to hit the court.
		it("aims at the same place wherever it is struck from", () => {
			for (const x of [-3.5, -2, 0, 2, 3.5]) {
				const from = contact(x, 1, BASELINE_Z);
				const v = resolveShot(swing("forehand", 0.8), 0, from, "near");
				expect(v, `no shot from x=${x}`).toBeDefined();
				const bounce = land(from, v as Vec3);
				expect(bounce, `never landed from x=${x}`).toBeDefined();
				expect(
					Math.abs(bounce?.x ?? Number.POSITIVE_INFINITY),
					`from x=${x} landed at x=${bounce?.x}`,
				).toBeLessThanOrEqual(SINGLES_HALF_WIDTH);
				// A near forehand belongs on the -x half, from anywhere.
				expect(bounce?.x ?? 1, `from x=${x}`).toBeLessThan(0);
			}
		});

		// Timing keeps doing what it is good at: it decides how well the ball
		// was struck, and a bad enough contact sprays it away from where the
		// stroke was aimed. This is what keeps mishits out of the court now
		// that timing no longer steers a clean ball.
		it("sprays a badly mistimed stroke the way the timing erred, not the way the stroke went", () => {
			const clean = resolveShot(
				swing("forehand", 0.8),
				0,
				start,
				"near",
			) as Vec3;
			const late = resolveShot(
				swing("forehand", 0.8),
				0.26,
				start,
				"near",
			) as Vec3;

			expect(clean.x).toBeLessThan(0); // aimed across, toward -x
			expect(late.x).toBeGreaterThan(0); // sprayed the other way entirely
		});

		it("does not spray a stroke timed inside the clean window", () => {
			const middle = resolveShot(
				swing("forehand", 0.8),
				0,
				start,
				"near",
			) as Vec3;
			const edge = resolveShot(
				swing("forehand", 0.8),
				CLEAN_WINDOW,
				start,
				"near",
			) as Vec3;

			expect(edge.x).toBe(middle.x);
		});

		it("hits a serve straight, because there is no stroke side to read", () => {
			const serve = resolveShot(
				swing("serve", 0.7),
				0,
				contact(0, 2.6, BASELINE_Z),
				"near",
			) as Vec3;

			expect(serve.x).toBe(0);
		});
	});

	it("a mishit arcs higher than a clean hit, not just shorter", () => {
		// "lands short" alone is satisfied by speed loss alone; this isolates the
		// quality-driven launch angle by checking the apex, not the landing spot.
		const start = contact(0, 1, BASELINE_Z);
		const clean = resolveShot(swing("forehand", 1), 0, start, "near") as Vec3;
		const late = resolveShot(swing("forehand", 1), 0.25, start, "near") as Vec3;
		const apex = (v: Vec3) => {
			let ball = { p: start, v };
			let peak = start.y;
			for (let i = 0; i < 1000; i++) {
				const step = stepBall(ball, 1 / 120, ENV);
				peak = Math.max(peak, step.ball.p.y);
				if (step.bounce) break;
				ball = step.ball;
			}
			return peak;
		};

		expect(apex(late)).toBeGreaterThan(apex(clean));
	});

	it("a low contact needs more elevation than a high one to clear the net", () => {
		const low = resolveShot(
			swing("forehand", 1),
			0,
			contact(0, 0.2, BASELINE_Z),
			"near",
		) as Vec3;
		const high = resolveShot(
			swing("forehand", 1),
			0,
			contact(0, 1.8, BASELINE_Z),
			"near",
		) as Vec3;
		const elevation = (v: Vec3) => Math.atan2(v.y, -v.z);

		expect(elevation(low)).toBeGreaterThan(elevation(high));
	});

	it("power is monotonic in outgoing speed", () => {
		const start = contact(0, 1, BASELINE_Z);
		const weak = resolveShot(swing("forehand", 0.2), 0, start, "near") as Vec3;
		const strong = resolveShot(
			swing("forehand", 0.9),
			0,
			start,
			"near",
		) as Vec3;
		const speed = (v: Vec3) => Math.hypot(v.x, v.y, v.z);

		expect(speed(strong)).toBeGreaterThan(speed(weak));
	});
});
