/**
 * Playability envelope: phase 9 of the plan. Not exact numbers — `ball.ts`
 * and `shot.ts`'s constants are the ones phase 9 exists to tune, so this file
 * asserts the four properties the plan names, measured against the real
 * physics rather than guessed:
 *
 * - a well-timed groundstroke from the baseline lands in at least ~60% of
 *   the time across the power range;
 * - a max-power shot deep in the miss window (bad timing, not a total whiff)
 *   essentially never lands in;
 * - no legal power reaches the far fence;
 * - a minimum-power serve still clears the net.
 *
 * The first property is driven through the real `tick()` — it is a claim
 * about a live rally, not just the shot formula. The other three are checked
 * directly against `resolveShot` + `stepBall` (`shot.test.ts`'s own method):
 * they are claims about the shot-resolution physics in isolation, and
 * driving them through `tick()`'s timing-prediction machinery only adds an
 * unrelated variable — an earlier draft found that scheduling a "late" swing
 * by tick offset silently changes contact height by up to a metre (the ball
 * has fallen further by the time a late swing lands), which flipped outcomes
 * for reasons that have nothing to do with the timing-quality curve under
 * test. See `llm-knowledge/experiments/2026-09-20-shot-envelope.md`.
 */
import { describe, expect, it } from "vitest";
import type { Swing } from "../protocol.ts";
import { type BallEnv, DRAG_K, stepBall } from "./ball.ts";
import { BASELINE_Z, isInBounds } from "./court.ts";
import { predictStrike } from "./players.ts";
import {
	createMatch,
	type MatchState,
	type RallyInput,
	tick,
} from "./rally.ts";
import { MISS_WINDOW, resolveShot } from "./shot.ts";
import type { Ball, Vec3 } from "./state.ts";

const ENV: BallEnv = { gravityScale: 1, drag: DRAG_K };
const DT = 1 / 120;

// `lag: 0` throughout: these fixtures name their own timing error directly,
// so the detector-latency compensation in `rally.ts` must not shift it. A
// swing with no `lag` is assumed to have taken DEFAULT_SWING_LAG_MS, which
// would silently turn every "well-timed" case here into a 200ms-early one.
const swing = (kind: Swing["kind"], power: number): Swing => ({
	kind,
	power,
	at: 0,
	lag: 0,
});

/**
 * A `far` return attempt through the real rally machine. Contact height is
 * fixed rather than left to drift with `timingError` (see file header) —
 * `power` and `timingError` are exactly what reach `resolveShot`.
 */
function attemptReturn(
	power: number,
	timingError: number,
	contactY = 0.8,
): "in" | "out" {
	const ball: Ball = {
		p: { x: 0, y: contactY, z: -BASELINE_Z + 0.5 },
		v: { x: 0, y: -1, z: -6 },
	};
	const fresh = createMatch("near");
	// "Well timed" means timed against what the sim itself will judge the
	// swing by — `predictStrike`, the same answer the player's feet follow.
	const predicted = predictStrike(ball, ENV, "far", fresh.players.far).t;
	let s: MatchState = {
		...fresh,
		phase: "rally",
		toHit: "far",
		ball,
		time: 0,
	};
	const before = s;
	const input: RallyInput = {
		side: "far",
		swing: swing("forehand", power),
		time: predicted + timingError,
	};
	s = tick(s, [input], DT);
	if (s.toHit === before.toHit) return "out"; // whiff: no contact at all

	for (let i = 0; i < 1000 && s.phase !== "point-over"; i++) {
		s = tick(s, [], DT);
	}
	return s.score.points.far === 15 ? "in" : "out";
}

/** Runs a shot forward to its first outcome — `shot.test.ts`'s own method. */
function land(contact: Vec3, v: Vec3): "in" | "out" | "net" | "neverlands" {
	let ball: Ball = { p: contact, v };
	for (let i = 0; i < 1500; i++) {
		const step = stepBall(ball, DT, ENV);
		ball = step.ball;
		if (step.net?.hit) return "net";
		if (step.bounce) {
			return isInBounds(step.bounce.x, step.bounce.z) ? "in" : "out";
		}
	}
	return "neverlands";
}

describe("playability envelope", () => {
	it("a well-timed groundstroke from the baseline lands in at least 60% of the power range", () => {
		const powers = Array.from({ length: 20 }, (_, i) => (i + 1) * 0.05);
		const inCount = powers.filter((p) => attemptReturn(p, 0) === "in").length;

		expect(inCount / powers.length).toBeGreaterThanOrEqual(0.6);
	});

	it("a max-power shot deep in the miss window essentially never lands in", () => {
		const contact: Vec3 = { x: 0, y: 1, z: -BASELINE_Z + 0.5 };
		// Deep in the miss window (closer to a whiff than to clean contact) but
		// still connecting — a total whiff past MISS_WINDOW proves nothing here.
		const deepMissFractions = [0.72, 0.8, 0.88, 0.95];
		const badTimings = deepMissFractions.flatMap((f) => [
			f * MISS_WINDOW,
			-f * MISS_WINDOW,
		]);

		const landedIn = badTimings.filter((te) => {
			const v = resolveShot(swing("forehand", 1), te, contact, "far");
			return v !== undefined && land(contact, v) === "in";
		}).length;

		expect(landedIn).toBe(0);
	});

	it("no legal power reaches the far fence", () => {
		const contact: Vec3 = { x: 0, y: 1, z: -BASELINE_Z + 0.5 };
		const FAR_FENCE_Z = BASELINE_Z + 8; // a generous real-world run-back distance

		for (let power = 0; power <= 1; power += 0.1) {
			const v = resolveShot(swing("forehand", power), 0, contact, "far");
			let ball: Ball = { p: contact, v: v as Vec3 };
			for (let i = 0; i < 1500; i++) {
				const step = stepBall(ball, DT, ENV);
				ball = step.ball;
				if (step.bounce) {
					expect(Math.abs(step.bounce.z)).toBeLessThan(FAR_FENCE_Z);
					break;
				}
			}
		}
	});

	it("a minimum-power serve still clears the net", () => {
		const contact: Vec3 = { x: 0, y: 1.1, z: -BASELINE_Z };
		const v = resolveShot(swing("serve", 0), 0, contact, "far") as Vec3;

		expect(land(contact, v)).toBe("in");
	});
});
