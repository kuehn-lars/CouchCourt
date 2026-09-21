import { describe, expect, it } from "vitest";
import type { BallEnv } from "./ball.ts";
import { BASELINE_Z, SINGLES_HALF_WIDTH } from "./court.ts";
import {
	MAX_LOOKAHEAD,
	movePlayer,
	PLAYER_SPEED,
	predictCrossingTime,
	predictCrossingX,
	predictStrike,
	STRIKE_HEIGHT_MAX,
	STRIKE_HEIGHT_MIN,
} from "./players.ts";
import type { Ball, Player } from "./state.ts";

const VACUUM: BallEnv = { gravityScale: 1, drag: 0 };

const ball = (
	p: [number, number, number],
	v: [number, number, number],
): Ball => ({
	p: { x: p[0], y: p[1], z: p[2] },
	v: { x: v[0], y: v[1], z: v[2] },
});

describe("predictCrossingX", () => {
	it("targets inside the court for a ball headed to the far corner", () => {
		// Clears the net and crosses the far baseline plane well wide of the
		// sideline (raw x ≈ 10.5m against a 4.115m half-width) — the clamp has
		// to actually do something here, not just pass an already-in-bounds x.
		const start = ball([2, 1.5, 8], [6, 3, -14]);
		const x = predictCrossingX(start, VACUUM, -BASELINE_Z);

		expect(Math.abs(x)).toBeLessThanOrEqual(SINGLES_HALF_WIDTH);
	});

	it("clamps rather than running away for a ball headed well out", () => {
		// Moving mostly sideways: crosses the target plane, if ever, miles wide.
		const start = ball([2, 1, 5], [40, 0, -1]);
		const x = predictCrossingX(start, VACUUM, -BASELINE_Z);

		expect(Math.abs(x)).toBeLessThanOrEqual(SINGLES_HALF_WIDTH);
	});

	it("agrees with stepBall's own trajectory at the crossing", async () => {
		const { stepBall } = await import("./ball.ts");
		const start = ball([2, 1.5, 8], [6, 3, -14]);
		const dt = 1 / 120;

		// Same loop `predictCrossingX` runs internally, done here independently
		// so the test is not just calling the code under test twice.
		let current = start;
		let expected: number | undefined;
		for (let i = 0; i < MAX_LOOKAHEAD / dt; i++) {
			const before = current.p.z;
			const step = stepBall(current, dt, VACUUM);
			const after = step.ball.p.z;
			if (before > -BASELINE_Z !== after > -BASELINE_Z) {
				const f = (before - -BASELINE_Z) / (before - after);
				const raw = current.p.x + (step.ball.p.x - current.p.x) * f;
				expected = Math.max(
					-SINGLES_HALF_WIDTH,
					Math.min(SINGLES_HALF_WIDTH, raw),
				);
				break;
			}
			current = step.ball;
		}

		expect(expected).toBeDefined();
		expect(predictCrossingX(start, VACUUM, -BASELINE_Z)).toBeCloseTo(
			expected as number,
			10,
		);
	});
});

describe("predictCrossingTime", () => {
	it("agrees with stepBall's own trajectory at the crossing", async () => {
		const { stepBall } = await import("./ball.ts");
		const start = ball([2, 1.5, 8], [6, 3, -14]);
		const dt = 1 / 120;

		let current = start;
		let expected: number | undefined;
		for (let i = 0; i < MAX_LOOKAHEAD / dt; i++) {
			const before = current.p.z;
			const step = stepBall(current, dt, VACUUM);
			const after = step.ball.p.z;
			if (before > -BASELINE_Z !== after > -BASELINE_Z) {
				const f = (before - -BASELINE_Z) / (before - after);
				expected = (i + f) * dt;
				break;
			}
			current = step.ball;
		}

		expect(expected).toBeDefined();
		expect(predictCrossingTime(start, VACUUM, -BASELINE_Z)).toBeCloseTo(
			expected as number,
			10,
		);
	});

	it("is undefined for a ball that never reaches the plane", () => {
		// Headed straight up: z never moves, so it never crosses z = -BASELINE_Z.
		const start = ball([0, 1, 5], [0, 10, 0]);
		expect(predictCrossingTime(start, VACUUM, -BASELINE_Z)).toBeUndefined();
	});
});

// One predictor answers both "where does this player stand" and "when do
// they hit it", so the movement and the timing can never disagree about the
// same ball — see llm-knowledge/modules/shared-sim.md.
describe("predictStrike", () => {
	const at = (side: "near" | "far", x: number, z: number): Player => ({
		side,
		x,
		z,
	});

	it("stands behind where the ball will bounce, not on top of it", () => {
		// Lobbed into the near half, bouncing around z = +6.
		const incoming = ball([1, 3, -2], [0.4, 0.5, 9]);
		const strike = predictStrike(incoming, VACUUM, "near", at("near", 0, 11));

		expect(strike.air).toBe(false);
		// Behind the bounce means further from the net: larger z for near.
		expect(strike.z).toBeGreaterThan(2);
		expect(strike.x).toBeGreaterThan(0.5);
	});

	it("says when the ball gets there, not only where", () => {
		const incoming = ball([0, 2, -4], [0, 0.5, 9]);
		const strike = predictStrike(incoming, VACUUM, "near", at("near", 0, 11));

		expect(strike.t).toBeGreaterThan(0);
		expect(strike.t).toBeLessThanOrEqual(MAX_LOOKAHEAD);
	});

	it("never sends a player over the net onto the other half", () => {
		// A drop shot dying right at the net.
		const incoming = ball([0, 1.2, -0.5], [0, -0.2, 3]);
		const strike = predictStrike(incoming, VACUUM, "near", at("near", 0, 11));

		expect(strike.z).toBeGreaterThan(0);
	});

	it("keeps the player on the court, not chasing a ball miles wide", () => {
		const incoming = ball([0, 1.5, -2], [40, 0, 6]);
		const strike = predictStrike(incoming, VACUUM, "near", at("near", 0, 11));

		expect(Math.abs(strike.x)).toBeLessThanOrEqual(SINGLES_HALF_WIDTH + 2);
	});

	// The user's ask: a ball taken out of the air has to be predicted too.
	// The trigger is not "is it a volley" but "can I get behind the bounce in
	// time" — which is the decision a real player makes.
	it("takes a ball out of the air when the bounce cannot be reached in time", () => {
		// Struck hard and flat: it will bounce deep, near the baseline, while
		// the player is caught up at the net after a drop shot.
		const incoming = ball([0, 1.4, -6], [0, -0.1, 24]);
		const strike = predictStrike(incoming, VACUUM, "near", at("near", 0, 1.5));

		expect(strike.air).toBe(true);
		expect(strike.z).toBeLessThan(10);
	});

	it("plays the same ball off the bounce when there is time to get back", () => {
		const incoming = ball([0, 1.4, -6], [0, -0.1, 24]);
		const strike = predictStrike(incoming, VACUUM, "near", at("near", 0, 11));

		expect(strike.air).toBe(false);
	});

	it("only ever volleys a ball it could actually reach with a racket", () => {
		const incoming = ball([0, 1.4, -6], [0, -0.1, 24]);
		const strike = predictStrike(incoming, VACUUM, "near", at("near", 0, 1.5));

		expect(strike.y).toBeGreaterThanOrEqual(STRIKE_HEIGHT_MIN);
		expect(strike.y).toBeLessThanOrEqual(STRIKE_HEIGHT_MAX);
	});

	it("still answers for a ball that never comes, instead of leaving the player nowhere", () => {
		// Headed away, into the far court: nothing to intercept at all.
		const leaving = ball([0, 1.5, -2], [0, 1, -12]);
		const strike = predictStrike(leaving, VACUUM, "near", at("near", 2, 11));

		expect(Number.isFinite(strike.x)).toBe(true);
		expect(Number.isFinite(strike.z)).toBe(true);
		expect(strike.z).toBeGreaterThan(0);
	});
});

describe("movePlayer", () => {
	const player = (side: "near" | "far", x: number, z = BASELINE_Z): Player => ({
		side,
		x,
		z,
	});

	it("never moves more than the speed cap in one tick", () => {
		const dt = 1 / 120;
		const start = player("near", 0);
		const moved = movePlayer(start, { x: 100, z: 100 }, dt);

		expect(
			Math.hypot(moved.x - start.x, moved.z - start.z),
		).toBeLessThanOrEqual(PLAYER_SPEED * dt + 1e-9);
	});

	it("reaches the target without overshoot once inside the cap", () => {
		const dt = 1 / 120;
		const start = player("near", 0);
		const target = { x: (PLAYER_SPEED * dt) / 4, z: BASELINE_Z };
		const moved = movePlayer(start, target, dt);

		expect(moved.x).toBeCloseTo(target.x, 10);
		expect(moved.z).toBeCloseTo(target.z, 10);
	});

	// Running diagonally must not be faster than running straight, which is
	// exactly what capping each axis on its own would allow.
	it("does not move faster on the diagonal than along one axis", () => {
		const dt = 1 / 120;
		const start = player("near", 0, 11);
		const straight = movePlayer(start, { x: 100, z: 11 }, dt);
		const diagonal = movePlayer(start, { x: 100, z: -100 }, dt);

		const straightStep = Math.hypot(straight.x - start.x, straight.z - start.z);
		const diagonalStep = Math.hypot(diagonal.x - start.x, diagonal.z - start.z);
		expect(diagonalStep).toBeCloseTo(straightStep, 10);
	});
});
