import { describe, expect, it } from "vitest";
import { type BallEnv, DRAG_K } from "./ball.ts";
import { BASELINE_Z, SINGLES_HALF_WIDTH } from "./court.ts";
import {
	MAX_LOOKAHEAD,
	movePlayer,
	PLAYER_SPEED,
	predictStrike,
	STRIKE_COMFORT,
	STRIKE_HEIGHT_MAX,
	STRIKE_HEIGHT_MIN,
} from "./players.ts";
import { groundstroke } from "./shot.ts";
import type { Ball, Player } from "./state.ts";

const VACUUM: BallEnv = { gravityScale: 1, drag: 0 };

const ball = (
	p: [number, number, number],
	v: [number, number, number],
): Ball => ({
	p: { x: p[0], y: p[1], z: p[2] },
	v: { x: v[0], y: v[1], z: v[2] },
});

describe("predictStrike's groundstroke", () => {
	it("lets a fast ball come up and drop to the waist, instead of charging the bounce", () => {
		// A hard, well-struck drive from the far baseline.
		const env = { gravityScale: 1, drag: DRAG_K };
		const from = { x: 0, y: 0.9, z: -BASELINE_Z };
		const incoming = {
			p: from,
			v: groundstroke(from, "far", "forehand", 0, 0.9, env),
		};
		const strike = predictStrike(incoming, env, "near", {
			side: "near",
			x: 0,
			z: BASELINE_Z,
		});
		expect(strike.air).toBe(false);
		expect(strike.ball.y).toBeLessThanOrEqual(STRIKE_COMFORT + 0.1);
		// Above the ankles: a flat drive skids, but it is taken off the
		// bounce, not off the floor.
		expect(strike.ball.y).toBeGreaterThan(0.3);
		// Taken around the baseline, not rushed in towards the service line.
		expect(strike.z).toBeGreaterThan(BASELINE_Z - 1.5);
	});
});

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
