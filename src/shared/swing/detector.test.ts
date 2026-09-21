import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	detectSwings,
	EPISODE_MERGE_GAP_MS,
	MIN_SWING_DURATION_MS,
	POWER_CEIL_DEG_S,
	POWER_FLOOR,
	POWER_FLOOR_DEG_S,
	SPIN_DEADZONE_DEG_S,
	SPIN_FULL_DEG_S,
	SWING_ROT_THRESHOLD_DEG_S,
	swingFrom,
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

	// The exact shape that used to break: the loudest sample of a hard
	// forehand is dominated by gamma, and reading alpha *there* reads noise.
	// `forehand-06`'s peaks are (3, 241, 1012) and (202, 105, 1063) and all
	// ten of its swings came out wrong. The largest turn decides instead.
	it("classifies from the largest turn, not from the loudest sample", () => {
		const samples: MotionSample[] = Array.from({ length: 24 }, (_, i) => ({
			t: i * STEP_MS,
			acc: [0, 9.8, 0],
			// Sample 12 is by far the loudest and its alpha says "backhand".
			// Sample 6 is quieter overall but turned hardest, and says
			// "forehand". The swing is a forehand.
			rot: i === 12 ? [-90, 0, 1200] : i === 6 ? [700, 0, 200] : [400, 0, 200],
		}));
		const swings = detectSwings(samples);
		expect(swings).toHaveLength(1);
		expect(swings[0]?.kind).toBe("forehand");
	});

	// The phone stopped guessing serves on 2026-09-21: hard forehands in the
	// 30s captures reach |gamma| of 1063, so the old threshold labelled them
	// serves. The sim assigns serves from `phase` instead.
	it("never reports a serve, however violent the wrist", () => {
		const samples: MotionSample[] = Array.from({ length: 24 }, (_, i) => ({
			t: i * STEP_MS,
			acc: [0, 9.8, 0],
			rot: [900, 0, i === 12 ? 1400 : 800],
		}));
		const swings = detectSwings(samples);
		expect(swings).toHaveLength(1);
		expect(swings[0]?.kind).toBe("forehand");
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

describe("swingFrom", () => {
	it("takes power, spin and `at` from the peak and only the kind from the turn", () => {
		const peak: MotionSample = { t: 500, acc: [0, 9.8, 0], rot: [0, 0, 900] };
		const turn: MotionSample = { t: 420, acc: [0, 9.8, 0], rot: [-600, 0, 0] };
		expect(swingFrom(peak, turn)).toEqual({
			kind: "backhand",
			power:
				POWER_FLOOR +
				(1 - POWER_FLOOR) *
					((900 - POWER_FLOOR_DEG_S) / (POWER_CEIL_DEG_S - POWER_FLOOR_DEG_S)),
			at: 500,
			spin: 0,
		});
	});

	it("reads spin from the peak's beta axis, signed and dead-zoned", () => {
		const at = (beta: number) =>
			swingFrom(
				{ t: 500, acc: [0, 9.8, 0], rot: [900, beta, 0] },
				{ t: 500, acc: [0, 9.8, 0], rot: [900, beta, 0] },
			).spin;

		// Inside the dead zone: flat. Wrist noise is not a spin decision.
		expect(at(0)).toBe(0);
		expect(at(SPIN_DEADZONE_DEG_S - 1)).toBe(0);
		expect(at(-(SPIN_DEADZONE_DEG_S - 1))).toBe(0);

		// Saturates at the full-roll figure, and never leaves [-1, 1].
		expect(at(SPIN_FULL_DEG_S)).toBe(1);
		expect(at(SPIN_FULL_DEG_S * 3)).toBe(1);
		expect(at(-SPIN_FULL_DEG_S * 3)).toBe(-1);

		// Between the two it is linear and keeps beta's sign.
		const mid = (SPIN_DEADZONE_DEG_S + SPIN_FULL_DEG_S) / 2;
		expect(at(mid)).toBeCloseTo(0.5, 6);
		expect(at(-mid)).toBeCloseTo(-0.5, 6);
	});

	it("agrees with detectSwings on the peak it chose", () => {
		// Whatever detectSwings reports for a trace, rebuilding from the
		// samples it chose must give an identical Swing. This is the guard
		// that stops the two detectors drifting.
		const samples = runWithPeak(0, 40, 0, 800, 20, 1000);
		const [swing] = detectSwings(samples);
		expect(swing).toBeDefined();
		const peak = samples.find((s) => s.t === swing?.at);
		expect(peak).toBeDefined();
		const turn = samples.reduce((best, s) =>
			Math.abs(s.rot[0]) > Math.abs(best.rot[0]) ? s : best,
		);
		if (peak) expect(swingFrom(peak, turn)).toEqual(swing);
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

	// Serve traces are held to detection only. The phone no longer decides
	// what a serve is — the sim does, from `phase` — so asserting a kind here
	// would be asserting a guess this codebase deliberately stopped making.
	const groundstrokeFiles = swingFiles.filter((name) =>
		/^(forehand|backhand)-/.test(name),
	);

	it("has groundstroke fixtures of both kinds", () => {
		expect(groundstrokeFiles.some((n) => n.startsWith("forehand-"))).toBe(true);
		expect(groundstrokeFiles.some((n) => n.startsWith("backhand-"))).toBe(true);
	});

	it.each(groundstrokeFiles)(
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

	it.each(swingFiles)("%s: reads as at least one swing", (name) => {
		const trace = load(name);
		expect(detectSwings(trace.samples).length).toBeGreaterThan(0);
	});

	// "A swing that felt like a forehand reads as a forehand, and setting the
	// phone down mid-conversation never reads as a shot." — PRODUCT.md
	it.each(negativeFiles)("%s: never reads as a swing", (name) => {
		const trace = load(name);
		expect(detectSwings(trace.samples)).toEqual([]);
	});
});
