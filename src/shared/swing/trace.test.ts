import { describe, expect, it } from "vitest";
import {
	formatTrace,
	isTrace,
	longestGapMs,
	MAX_GAP_MS,
	type MotionReading,
	type MotionSample,
	type MotionTrace,
	measuredHz,
	nextTraceName,
	TRACE_LABELS,
	toSample,
} from "./trace.ts";

const validTrace: MotionTrace = {
	label: "forehand",
	device: "iPhone 14 Pro",
	ios: "26.6.1",
	hz: 60,
	samples: [
		{ t: 0, acc: [0, 0, 9.8], rot: [0, 0, 0] },
		{ t: 16, acc: [0.1, 0, 9.8], rot: [1, 0, 0] },
	],
};

describe("isTrace", () => {
	it("accepts a well-formed trace", () => {
		expect(isTrace(validTrace), JSON.stringify(validTrace)).toBe(true);
	});

	it("accepts every label the recorder buttons offer", () => {
		for (const label of TRACE_LABELS) {
			const trace: MotionTrace = { ...validTrace, label };
			expect(isTrace(trace), JSON.stringify(trace)).toBe(true);
		}
	});

	it("rejects malformed payloads", () => {
		const invalid: unknown[] = [
			// not an object / null
			null,
			"forehand",
			42,
			[],

			// label not in TRACE_LABELS
			{ ...validTrace, label: "volley" },
			// load-bearing: the dev-server endpoint builds a filename from this
			{ ...validTrace, label: "../../etc/passwd" },

			// device / ios not a non-empty string
			{ ...validTrace, device: "" },
			{ ...validTrace, device: 7 },
			{ ...validTrace, ios: "" },
			{ ...validTrace, ios: null },

			// hz not a finite number > 0
			{ ...validTrace, hz: 0 },
			{ ...validTrace, hz: Number.NaN },
			{ ...validTrace, hz: Number.POSITIVE_INFINITY },
			{ ...validTrace, hz: -5 },

			// samples not an array, or an empty array — the two cases below are
			// the tool's silent failures, not padding: "permission granted, zero
			// events delivered" and "sampling stopped when the tab backgrounded"
			{ ...validTrace, samples: "nope" },
			{ ...validTrace, samples: [] },

			// sample.t not a finite number >= 0
			{ ...validTrace, samples: [{ t: -1, acc: [0, 0, 0], rot: [0, 0, 0] }] },
			{
				...validTrace,
				samples: [{ t: Number.NaN, acc: [0, 0, 0], rot: [0, 0, 0] }],
			},

			// acc / rot not exactly 3 finite numbers
			{ ...validTrace, samples: [{ t: 0, acc: [0, 0], rot: [0, 0, 0] }] },
			{
				...validTrace,
				samples: [{ t: 0, acc: [0, 0, 0, 0], rot: [0, 0, 0] }],
			},
			{
				...validTrace,
				samples: [{ t: 0, acc: [0, "x", 0], rot: [0, 0, 0] }],
			},
			{
				...validTrace,
				samples: [{ t: 0, acc: [0, 0, 0], rot: [0, Number.NaN, 0] }],
			},

			// non-monotonic t: sampling that stalls (e.g. tab backgrounded) and
			// resumes with a stale or repeated clock
			{
				...validTrace,
				samples: [
					{ t: 10, acc: [0, 0, 0], rot: [0, 0, 0] },
					{ t: 5, acc: [0, 0, 0], rot: [0, 0, 0] },
				],
			},
		];
		for (const trace of invalid) {
			expect(isTrace(trace), JSON.stringify(trace)).toBe(false);
		}
	});
});

describe("toSample", () => {
	it("rounds acc to 3 decimals and rot to 2, passing t through unrounded", () => {
		const reading: MotionReading = {
			accelerationIncludingGravity: {
				x: 0.123456,
				y: -1.0000001,
				z: 9.80665,
			},
			rotationRate: { alpha: 1.23456, beta: -0.001, gamma: 0 },
		};
		expect(toSample(1234.5, reading)).toEqual({
			t: 1234.5,
			acc: [0.123, -1, 9.807],
			rot: [1.23, 0, 0],
		});
	});

	it("drops the whole sample rather than substituting 0", () => {
		// A zeroed sample is fabricated "at rest" data fed to the one algorithm
		// whose entire job is telling rest from a swing. Any missing or
		// non-finite field must drop the sample, never default it.
		const invalid: MotionReading[] = [
			{
				accelerationIncludingGravity: null,
				rotationRate: { alpha: 0, beta: 0, gamma: 0 },
			},
			{
				accelerationIncludingGravity: { x: 0, y: 0, z: 0 },
				rotationRate: null,
			},
			{
				accelerationIncludingGravity: { x: null, y: 0, z: 0 },
				rotationRate: { alpha: 0, beta: 0, gamma: 0 },
			},
			{
				accelerationIncludingGravity: { x: 0, y: 0, z: 0 },
				rotationRate: { alpha: 0, beta: Number.NaN, gamma: 0 },
			},
			{
				accelerationIncludingGravity: {
					x: 0,
					y: 0,
					z: Number.POSITIVE_INFINITY,
				},
				rotationRate: { alpha: 0, beta: 0, gamma: 0 },
			},
		];
		for (const reading of invalid) {
			expect(toSample(0, reading), JSON.stringify(reading)).toBeNull();
		}
	});
});

describe("nextTraceName", () => {
	it("takes max-plus-one, not count-plus-one, so a deleted trace never causes a silent overwrite", () => {
		expect(
			nextTraceName(
				["forehand-01.json", "forehand-03.json", "idle-09.json"],
				"forehand",
			),
		).toBe("forehand-04.json");
	});

	it("returns 01 for an empty or non-matching list", () => {
		expect(nextTraceName([], "forehand")).toBe("forehand-01.json");
		expect(nextTraceName(["idle-01.json"], "forehand")).toBe(
			"forehand-01.json",
		);
	});

	it("ignores names that are not exactly <label>-<digits>.json", () => {
		// Traces get renamed descriptively after recording (e.g.
		// "forehand-fast-01.json"); that must not be parsed as number "fast-01".
		expect(
			nextTraceName(["forehand-fast-01.json", "forehand-02.json"], "forehand"),
		).toBe("forehand-03.json");
	});

	it("zero-pads to 2 digits and grows naturally past 99", () => {
		expect(nextTraceName(["forehand-99.json"], "forehand")).toBe(
			"forehand-100.json",
		);
	});
});

const sampleAt = (t: number): MotionSample => ({
	t,
	acc: [0, 9.8, 0],
	rot: [1, 2, 3],
});

const traceOf = (samples: MotionSample[]): MotionTrace => ({
	label: "forehand",
	device: "iPhone 14 Pro",
	ios: "26.6.1",
	hz: 60,
	samples,
});

describe("measuredHz", () => {
	// The recorder writes what it achieved, never a nominal 60 — five of the
	// twenty committed traces sampled at 57-59Hz, so a constant would be a lie
	// baked into the detector's input.
	it("reports the rate actually achieved", () => {
		const samples = Array.from({ length: 61 }, (_, i) => sampleAt(i * 16.6667));
		expect(measuredHz(samples)).toBe(60);
	});

	it("is 0 when there is nothing to measure", () => {
		expect(measuredHz([])).toBe(0);
		expect(measuredHz([sampleAt(0)])).toBe(0);
	});

	// Two samples can share a millisecond on iOS: performance.now() is quantised
	// to 1ms and delivery catches up after a stall. Dividing by zero elapsed
	// must not produce Infinity, which isTrace would then reject.
	it("does not divide by zero when every sample shares a timestamp", () => {
		expect(measuredHz([sampleAt(5), sampleAt(5)])).toBe(0);
	});
});

describe("longestGapMs", () => {
	it("finds the worst interval", () => {
		expect(longestGapMs([sampleAt(0), sampleAt(16), sampleAt(300)])).toBe(284);
	});

	it("is 0 when there is no interval to measure", () => {
		expect(longestGapMs([])).toBe(0);
		expect(longestGapMs([sampleAt(0)])).toBe(0);
	});

	// 147ms was the worst gap across 18,663 real samples; MAX_GAP_MS sits at
	// 250 to leave margin. A capture at the limit is still saveable.
	it("treats a gap at exactly the limit as acceptable", () => {
		const at = [sampleAt(0), sampleAt(MAX_GAP_MS)];
		expect(longestGapMs(at)).toBeLessThanOrEqual(MAX_GAP_MS);
	});
});

describe("formatTrace", () => {
	// The endpoint writes; isTrace and the detector read. If these two ever
	// disagree the fixtures become unreadable, and nothing else checks it.
	it("round-trips through isTrace", () => {
		const trace = traceOf([sampleAt(0), sampleAt(16.7)]);
		const parsed: unknown = JSON.parse(formatTrace(trace));
		expect(isTrace(parsed)).toBe(true);
		expect(parsed).toEqual(trace);
	});

	it("puts one sample per line so a re-recorded trace diffs legibly", () => {
		const text = formatTrace(
			traceOf([sampleAt(0), sampleAt(16), sampleAt(33)]),
		);
		const sampleLines = text
			.split("\n")
			.filter((line) => line.trimStart().startsWith('{"t"'));
		expect(sampleLines).toHaveLength(3);
	});
});
