import { describe, expect, it } from "vitest";
import type { BallEnv } from "./ball.ts";
import { BASELINE_Z, SINGLES_HALF_WIDTH } from "./court.ts";
import {
	MAX_LOOKAHEAD,
	movePlayer,
	PLAYER_SPEED,
	predictCrossingTime,
	predictCrossingX,
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

describe("movePlayer", () => {
	const player = (side: "near" | "far", x: number): Player => ({ side, x });

	it("never moves more than the speed cap in one tick", () => {
		const dt = 1 / 120;
		const start = player("near", 0);
		const moved = movePlayer(start, 100, dt);

		expect(Math.abs(moved.x - start.x)).toBeLessThanOrEqual(
			PLAYER_SPEED * dt + 1e-9,
		);
	});

	it("reaches the target without overshoot once inside the cap", () => {
		const dt = 1 / 120;
		const start = player("near", 0);
		const target = (PLAYER_SPEED * dt) / 2;
		const moved = movePlayer(start, target, dt);

		expect(moved.x).toBeCloseTo(target, 10);
	});
});
