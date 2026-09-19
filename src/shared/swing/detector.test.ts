import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	detectSwings,
	EPISODE_MERGE_GAP_MS,
	MIN_SWING_DURATION_MS,
	POWER_CEIL_DEG_S,
	POWER_FLOOR,
	POWER_FLOOR_DEG_S,
	SERVE_GAMMA_THRESHOLD_DEG_S,
	SWING_ROT_THRESHOLD_DEG_S,
} from "./detector.ts";
import { isTrace, type MotionSample, type MotionTrace } from "./trace.ts";

const STEP_MS = 1000 / 60;

/** `count` samples at `hz` starting at `startT`, one axis set to `value`. */
function run(
	startT: number,
	count: number,
	axis: 0 | 1 | 2,
	value: number,
): MotionSample[] {
	const samples: MotionSample[] = [];
	for (let i = 0; i < count; i++) {
		const rot: [number, number, number] = [0, 0, 0];
		rot[axis] = value;
		samples.push({ t: startT + i * STEP_MS, acc: [0, 9.8, 0], rot });
	}
	return samples;
}

/** Same as `run`, but one sample partway through is bumped to `peak` so the
 * run has a single unambiguous peak sample instead of a flat plateau. */
function runWithPeak(
	startT: number,
	count: number,
	axis: 0 | 1 | 2,
	base: number,
	peakIndex: number,
	peak: number,
): MotionSample[] {
	const samples = run(startT, count, axis, base);
	const sample = samples[peakIndex];
	if (sample === undefined) throw new Error("peakIndex out of range");
	const rot: [number, number, number] = [0, 0, 0];
	rot[axis] = peak;
	samples[peakIndex] = { ...sample, rot };
	return samples;
}

const rest = (startT: number, count: number): MotionSample[] =>
	run(startT, count, 0, 0);

/** Low-rotation filler samples spanning real elapsed time between two runs,
 * so the gap is a rest period a real stream would sample through — not just
 * an unsampled jump in `t` that `findRuns` would never see. */
function restBetween(
	fromExclusive: number,
	toExclusive: number,
): MotionSample[] {
	const samples: MotionSample[] = [];
	for (let t = fromExclusive + STEP_MS; t < toExclusive; t += STEP_MS) {
		samples.push({ t, acc: [0, 9.8, 0], rot: [0, 0, 0] });
	}
	return samples;
}

describe("detectSwings", () => {
	it("returns no swings for an empty stream", () => {
		expect(detectSwings([])).toEqual([]);
	});

	it("returns no swings for a stream that never crosses the threshold", () => {
		expect(detectSwings(rest(0, 60))).toEqual([]);
	});

	it("detects a sustained high-rotation run as a forehand (positive alpha)", () => {
		const samples = [
			...rest(0, 6),
			...runWithPeak(100, 24, 0, 400, 12, 700), // ~383ms, well above the 300ms floor
			...rest(500, 6),
		];
		const swings = detectSwings(samples);
		expect(swings).toHaveLength(1);
		expect(swings[0]?.kind).toBe("forehand");
	});

	it("detects negative alpha as a backhand", () => {
		const samples = runWithPeak(0, 24, 0, -400, 12, -700);
		const swings = detectSwings(samples);
		expect(swings).toHaveLength(1);
		expect(swings[0]?.kind).toBe("backhand");
	});

	it("detects a large gamma at the peak as a serve, even with a strongly positive alpha", () => {
		// Positive alpha alone would classify as forehand — gamma must win.
		const baseRot: [number, number, number] = [
			900,
			0,
			SERVE_GAMMA_THRESHOLD_DEG_S,
		];
		const peakRot: [number, number, number] = [
			900,
			0,
			SERVE_GAMMA_THRESHOLD_DEG_S + 50,
		];
		const samples: MotionSample[] = Array.from({ length: 24 }, (_, i) => ({
			t: i * STEP_MS,
			acc: [0, 9.8, 0],
			rot: i === 12 ? peakRot : baseRot,
		}));
		const swings = detectSwings(samples);
		expect(swings).toHaveLength(1);
		expect(swings[0]?.kind).toBe("serve");
	});

	it("reports `at` as the timestamp of the peak sample", () => {
		const samples = runWithPeak(100, 24, 0, 400, 12, 700);
		const swings = detectSwings(samples);
		const peakT = samples[12]?.t;
		expect(swings[0]?.at).toBe(peakT);
	});

	// A single interval above threshold is "handling", not a swing — see
	// llm-knowledge/experiments/2026-09-19-ios-devicemotion-sampling.md.
	it("ignores a run shorter than the minimum swing duration", () => {
		const samples = run(0, 6, 0, 700); // 5 * 16.67ms ~ 83ms
		expect(detectSwings(samples)).toEqual([]);
	});

	it("treats a run at exactly the minimum duration as a swing", () => {
		// 19 samples at 60Hz span exactly 18 * 16.6667ms = 300.0003ms
		const count = Math.round(MIN_SWING_DURATION_MS / STEP_MS) + 1;
		const samples = run(0, count, 0, 700);
		expect(detectSwings(samples).length).toBeGreaterThanOrEqual(1);
	});

	it("merges two qualifying runs closer together than the episode gap into one swing", () => {
		const first = runWithPeak(0, 24, 0, 400, 12, 600);
		const firstEndT = first[first.length - 1]?.t ?? 0;
		const secondStart = firstEndT + EPISODE_MERGE_GAP_MS - 50;
		const second = runWithPeak(secondStart, 24, 0, 400, 12, 900);
		const swings = detectSwings([
			...first,
			...restBetween(firstEndT, secondStart),
			...second,
		]);
		expect(swings).toHaveLength(1);
		// The merged episode reports the stronger of the two peaks.
		expect(swings[0]?.at).toBe(second[12]?.t);
	});

	it("keeps two qualifying runs further apart than the episode gap as separate swings", () => {
		const first = runWithPeak(0, 24, 0, 400, 12, 600);
		const firstEndT = first[first.length - 1]?.t ?? 0;
		const secondStart = firstEndT + EPISODE_MERGE_GAP_MS + 100;
		const second = runWithPeak(secondStart, 24, 0, 400, 12, 900);
		const swings = detectSwings([
			...first,
			...restBetween(firstEndT, secondStart),
			...second,
		]);
		expect(swings).toHaveLength(2);
	});

	it("never reports a swing below the power floor, even for a run just over threshold", () => {
		const samples = run(0, 24, 0, SWING_ROT_THRESHOLD_DEG_S);
		const swings = detectSwings(samples);
		expect(swings[0]?.power).toBe(POWER_FLOOR);
	});

	it("reports power 1 for a run at or above the power ceiling", () => {
		const samples = run(0, 24, 0, POWER_CEIL_DEG_S + 200);
		const swings = detectSwings(samples);
		expect(swings[0]?.power).toBe(1);
	});

	it("maps power linearly between the floor and ceiling", () => {
		const mid = (POWER_FLOOR_DEG_S + POWER_CEIL_DEG_S) / 2;
		const samples = run(0, 24, 0, mid);
		const swings = detectSwings(samples);
		expect(swings[0]?.power).toBeCloseTo((1 + POWER_FLOOR) / 2, 5);
	});
});

// The main testing leverage: tuned and re-checked against the recorded
// captures rather than a mental model of what a swing looks like. See
// llm-knowledge/experiments/2026-09-19-ios-devicemotion-sampling.md.
describe("detectSwings against the committed motion traces", () => {
	const dir = new URL("../../../tests/fixtures/motion/", import.meta.url);
	const files = readdirSync(dir).filter((name) => name.endsWith(".json"));

	// Same trust boundary as tests/fixtures/motion/fixtures.test.ts: a
	// fixture is untrusted on-disk JSON until `isTrace` says otherwise.
	const load = (name: string): MotionTrace => {
		const parsed: unknown = JSON.parse(
			readFileSync(new URL(name, dir), "utf8"),
		);
		if (!isTrace(parsed)) throw new Error(`${name}: not a well-formed trace`);
		return parsed;
	};

	const swingFiles = files.filter((name) =>
		/^(forehand|backhand|serve)-/.test(name),
	);
	const negativeFiles = files.filter(
		(name) => !/^(forehand|backhand|serve)-/.test(name),
	);

	it("has both swing and negative fixtures to check against", () => {
		expect(swingFiles.length).toBeGreaterThan(0);
		expect(negativeFiles.length).toBeGreaterThan(0);
	});

	it.each(swingFiles)(
		"%s: every detected swing matches the recorded label",
		(name) => {
			const trace = load(name);
			const swings = detectSwings(trace.samples);
			expect(swings.length, `${name}: detected no swings`).toBeGreaterThan(0);
			for (const swing of swings) {
				expect(swing.kind, `${name}: ${JSON.stringify(swing)}`).toBe(
					trace.label,
				);
				expect(swing.power).toBeGreaterThanOrEqual(POWER_FLOOR);
				expect(swing.power).toBeLessThanOrEqual(1);
			}
		},
	);

	// "A swing that felt like a forehand reads as a forehand, and setting the
	// phone down mid-conversation never reads as a shot." — PRODUCT.md
	it.each(negativeFiles)("%s: never reads as a swing", (name) => {
		const trace = load(name);
		expect(detectSwings(trace.samples)).toEqual([]);
	});
});
