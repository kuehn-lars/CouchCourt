import { describe, expect, it } from "vitest";
import {
	type BallEnv,
	type BallStep,
	COURT_RESTITUTION,
	DRAG_K,
	GRAVITY,
	stepBall,
} from "./ball.ts";
import { BALL_RADIUS, NET_POST_X, netHeightAt } from "./court.ts";
import type { Ball } from "./state.ts";

const DT = 1 / 120;
const VACUUM: BallEnv = { gravityScale: 1, drag: 0 };

const ball = (
	p: [number, number, number],
	v: [number, number, number],
): Ball => ({
	p: { x: p[0], y: p[1], z: p[2] },
	v: { x: v[0], y: v[1], z: v[2] },
});

/** Steps until `stop` says so, or `limit` ticks pass, collecting every step. */
function fly(
	start: Ball,
	env: BallEnv,
	stop: (step: BallStep) => boolean,
	limit = 2000,
): BallStep[] {
	const steps: BallStep[] = [];
	let current = start;
	for (let i = 0; i < limit; i++) {
		const step = stepBall(current, DT, env);
		steps.push(step);
		if (stop(step)) return steps;
		current = step.ball;
	}
	return steps;
}

describe("free flight", () => {
	/**
	 * A flat drive from the near baseline. In a vacuum the whole trajectory is
	 * a parabola with a closed form, so the integrator has an exact answer to
	 * be wrong about — this is the test that catches an Euler-shaped mistake,
	 * which lands metres short, not centimetres.
	 */
	it("lands where the closed-form parabola says, in a vacuum", () => {
		const start = ball([0, 1.2, 11], [2, 3, -24]);
		const steps = fly(start, VACUUM, (s) => s.bounce !== undefined);
		const bounce = steps.at(-1)?.bounce;

		// y(t) = y0 + vy·t - ½g·t² = BALL_RADIUS
		const a = GRAVITY / 2;
		const b = -start.v.y;
		const c = BALL_RADIUS - start.p.y;
		const t = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);

		expect(bounce).toBeDefined();
		expect(bounce?.z).toBeCloseTo(start.p.z + start.v.z * t, 2);
		expect(bounce?.x).toBeCloseTo(start.p.x + start.v.x * t, 2);
	});

	it("carries less far the more drag there is", () => {
		const start = ball([0, 1.2, 11], [0, 3, -24]);
		const carry = [0, DRAG_K / 2, DRAG_K, DRAG_K * 2].map((drag) => {
			const steps = fly(
				start,
				{ gravityScale: 1, drag },
				(s) => s.bounce !== undefined,
			);
			return start.p.z - (steps.at(-1)?.bounce?.z ?? Number.NaN);
		});

		for (let i = 1; i < carry.length; i++) {
			expect(carry[i]).toBeLessThan(carry[i - 1] as number);
		}
		// Drag is not a rounding correction here: the plan's k costs metres.
		expect((carry[0] as number) - (carry[2] as number)).toBeGreaterThan(1);
	});

	it("is the same run twice", () => {
		const start = ball([0.3, 1.2, 11], [1, 3, -24]);
		const run = () =>
			JSON.stringify(
				fly(start, { gravityScale: 1.4, drag: DRAG_K }, () => false, 1000).at(
					-1,
				),
			);
		expect(run()).toBe(run());
	});

	it("falls faster with a higher gravity scale", () => {
		const start = ball([0, 1.2, 11], [0, 3, -24]);
		const carry = [1, 2].map((gravityScale) => {
			const steps = fly(
				start,
				{ gravityScale, drag: DRAG_K },
				(s) => s.bounce !== undefined,
			);
			return start.p.z - (steps.at(-1)?.bounce?.z ?? Number.NaN);
		});
		expect(carry[1]).toBeLessThan(carry[0] as number);
	});
});

/**
 * The guard the plan names as the one most likely to be silently wrong: at
 * 120Hz a fast ball jumps 25-33cm per tick and passes clean through a plane
 * of zero thickness. Both of these cross their plane entirely within one step.
 */
describe("segment crossing, not endpoint testing", () => {
	it("catches a 40 m/s ball that passes the net inside a single tick", () => {
		const start = ball([0, 1.5, 0.3], [0, 0, -40]);
		const step = stepBall(start, DT, VACUUM);

		expect(step.ball.p.z).toBeLessThan(0); // it really did jump past
		expect(step.net).toBeDefined();
		expect(step.net?.y).toBeCloseTo(1.5, 1);
	});

	it("catches a 40 m/s ball that passes the surface inside a single tick", () => {
		const start = ball([0, 0.2, 5], [0, -40, -12]);
		const step = stepBall(start, DT, VACUUM);
		const t = (start.p.y - BALL_RADIUS) / -start.v.y;

		expect(step.bounce).toBeDefined();
		expect(step.bounce?.z).toBeCloseTo(start.p.z + start.v.z * t, 2);
		expect(step.ball.p.y).toBeGreaterThan(BALL_RADIUS);
		expect(step.ball.v.y).toBeGreaterThan(0);
	});
});

describe("bouncing", () => {
	/** Apex height goes as v², and the bounce keeps `restitution` of v. */
	it("loses restitution² of its height each bounce", () => {
		const steps = fly(ball([0, 2, 5], [0, 0, 0]), VACUUM, () => false, 600);

		const apexes: number[] = [];
		let current = 0;
		for (const step of steps) {
			if (step.bounce) {
				if (current > 0) apexes.push(current);
				current = 0;
			}
			current = Math.max(current, step.ball.p.y - BALL_RADIUS);
		}

		expect(apexes.length).toBeGreaterThanOrEqual(2);
		expect((apexes[1] as number) / (apexes[0] as number)).toBeCloseTo(
			COURT_RESTITUTION ** 2,
			2,
		);
	});

	/**
	 * The contact almost never falls on a tick boundary, so the bounce has to
	 * reflect the velocity **at the crossing fraction**. Reflecting the
	 * end-of-tick velocity instead looks fine for a single drop and is wrong
	 * across a sweep: the same shot would bounce up to 2.5% higher or lower
	 * depending on where inside the tick it happened to land.
	 */
	it("bounces the same however the contact falls inside a tick", () => {
		for (let i = 0; i < 8; i++) {
			const drop = 2 + i * 0.011;
			const steps = fly(
				ball([0, drop, 5], [0, 0, 0]),
				VACUUM,
				() => false,
				200,
			);

			let apex = 0;
			let bounced = false;
			for (const step of steps) {
				if (step.bounce) bounced = true;
				if (bounced) apex = Math.max(apex, step.ball.p.y - BALL_RADIUS);
			}
			expect(apex / (drop - BALL_RADIUS)).toBeCloseTo(
				COURT_RESTITUTION ** 2,
				3,
			);
		}
	});
});

describe("the net", () => {
	it("stops a ball that meets the band and sends it back", () => {
		const start = ball([0, 0.4, 0.2], [0, 0, -30]);
		const step = stepBall(start, DT, VACUUM);

		expect(step.net?.hit).toBe(true);
		expect(step.ball.p.z).toBeGreaterThanOrEqual(0); // never got through
		expect(step.ball.v.z).toBeGreaterThan(0); // came back
		expect(Math.abs(step.ball.v.z)).toBeLessThan(30);
	});

	it("lets a ball clip the cord and carry on, slower", () => {
		const start = ball([0, netHeightAt(0) + BALL_RADIUS / 2, 0.2], [0, 1, -30]);
		const step = stepBall(start, DT, VACUUM);

		expect(step.net?.hit).toBe(false);
		expect(step.ball.p.z).toBeLessThan(0); // through
		expect(step.ball.v.z).toBeLessThan(0); // still going
		expect(Math.abs(step.ball.v.z)).toBeLessThan(30); // but damped
	});

	it("passes a ball well over the band untouched", () => {
		const start = ball([0, 2, 0.2], [0, 0, -30]);
		const step = stepBall(start, DT, VACUUM);

		expect(step.net?.hit).toBe(false);
		expect(step.ball.v.z).toBeCloseTo(-30, 6);
	});

	/**
	 * The whole reason `netHeightAt` is a function. This ball crosses at 0.98:
	 * over the centre strap (0.914) it is through, out by the post (1.042) it
	 * is not. A flat net makes wide shots easier than they are.
	 */
	it("is higher out by the post than over the strap", () => {
		const high = (x: number) =>
			stepBall(ball([x, 0.98, 0.2], [0, 0, -40]), DT, VACUUM);

		expect(high(0).net?.hit).toBe(false);
		expect(high(NET_POST_X - 0.2).net?.hit).toBe(true);
	});

	/** The net is 5.029 wide; outside the posts there is nothing to hit. */
	it("does not exist past the posts", () => {
		const start = ball([6, 0.4, 0.2], [0, 0, -30]);
		const step = stepBall(start, DT, VACUUM);

		expect(step.net?.hit).toBe(false);
		expect(step.ball.p.z).toBeLessThan(0);
	});
});
