import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_SWING_LAG_MS, type Swing } from "../protocol.ts";
import { detectSwings } from "./detector.ts";
import { createSwingStream } from "./stream.ts";
import {
	isTrace,
	MAX_GAP_MS,
	type MotionSample,
	type MotionTrace,
} from "./trace.ts";

const NEGATIVE = ["idle", "walking", "pocket", "gesture"];

const dir = new URL("../../../tests/fixtures/motion/", import.meta.url);
const files = readdirSync(dir).filter((name) => name.endsWith(".json"));

function load(name: string): MotionTrace {
	const parsed: unknown = JSON.parse(readFileSync(new URL(name, dir), "utf8"));
	if (!isTrace(parsed)) throw new Error(`${name} is not a well-formed trace`);
	return parsed;
}

/** Every swing the stream emits for a trace, with when it emitted each. */
function replay(samples: readonly MotionSample[]): {
	swing: Swing;
	emitAt: number;
}[] {
	const stream = createSwingStream();
	const out: { swing: Swing; emitAt: number }[] = [];
	for (const sample of samples) {
		const swing = stream.push(sample);
		if (swing !== null) out.push({ swing, emitAt: sample.t });
	}
	return out;
}

describe("createSwingStream", () => {
	// Guards against the whole suite below passing vacuously.
	it("has fixtures to replay", () => {
		expect(files.length).toBeGreaterThan(0);
	});

	// THE bar from PRODUCT.md: "setting the phone down mid-conversation never
	// reads as a shot." Measured to hold for every policy tried; if this goes
	// red the detector is worse than useless at a party.
	const negatives = files.filter((n) => NEGATIVE.includes(load(n).label));
	it.each(negatives)("%s never fires", (name) => {
		expect(replay(load(name).samples).map((e) => e.swing)).toEqual([]);
	});

	const positives = files.filter((n) => !NEGATIVE.includes(load(n).label));
	it.each(positives)("%s fires at least once", (name) => {
		expect(replay(load(name).samples).length).toBeGreaterThan(0);
	});

	// The reason stream.ts exists rather than a rolling buffer into
	// detectSwings. See experiments/2026-09-20-streaming-swing-latency.md —
	// the batch equivalent sits at a median of 1066ms.
	// Raw latency stopped being the thing to guard on 2026-09-21. Holding
	// EMIT_HOLD_MS past the decay trigger buys the direction accuracy the
	// whole shot now rests on, and pushes p90 to ~334ms — past MISS_WINDOW.
	// What keeps that affordable is that the swing REPORTS the delay, so the
	// host can subtract it. So the guarantee to hold is `lag`'s accuracy, not
	// a latency ceiling: a lag that is wrong is worse than a lag that is big.
	it("reports `lag` as exactly the delay between the peak and the emission", () => {
		let checked = 0;
		for (const name of positives) {
			for (const e of replay(load(name).samples)) {
				expect(e.swing.lag).toBeCloseTo(e.emitAt - e.swing.at, 6);
				checked++;
			}
		}
		expect(checked).toBeGreaterThan(20);
	});

	it("never reports a lag the protocol would reject", () => {
		for (const name of positives) {
			for (const e of replay(load(name).samples)) {
				expect(e.swing.lag).toBeGreaterThanOrEqual(0);
				expect(e.swing.lag).toBeLessThanOrEqual(MAX_SWING_LAG_MS);
			}
		}
	});

	// Still bounded, just at a figure that reflects the hold. Emitting a
	// second after the swing is the batch detector's failure, and this is the
	// guard that it has not quietly come back.
	it("emits within 450ms of the peak at p90", () => {
		const latencies: number[] = [];
		for (const name of positives) {
			for (const e of replay(load(name).samples)) {
				latencies.push(e.emitAt - e.swing.at);
			}
		}
		latencies.sort((a, b) => a - b);
		const p90 = latencies[Math.floor(latencies.length * 0.9)];
		expect(p90).toBeDefined();
		expect(p90).toBeLessThanOrEqual(450);
	});

	// Both detectors must agree about what a swing IS, even where they
	// disagree about when to announce it.
	it("produces a swing identical to the batch detector on a clean single run", () => {
		const samples: MotionSample[] = [];
		for (let i = 0; i < 40; i++) {
			// Ramp up then down so there is one unambiguous peak and the decay
			// condition can fire.
			const v = i < 20 ? 400 + i * 30 : 400 + (39 - i) * 30;
			samples.push({ t: (i * 1000) / 60, acc: [0, 9.8, 0], rot: [v, 0, 0] });
		}
		// Let the run end so both detectors see the same episode.
		samples.push({ t: 41000 / 60, acc: [0, 9.8, 0], rot: [0, 0, 0] });

		const streamed = replay(samples);
		const [batch] = detectSwings(samples);
		// `lag` is the one field only the streaming detector can know — the
		// batch detector has no emission moment to measure against.
		const { lag, ...streamedSwing } = streamed[0]?.swing ?? {};
		expect(streamedSwing).toEqual(batch);
		expect(lag).toBeGreaterThan(0);
	});

	// THE guard for the feature the whole game now rests on: the ball goes
	// where the swing went, so a wrong `kind` is a shot flying the wrong way.
	// Before 2026-09-21 this stood at 34/64; `forehand-06` alone was 0/10.
	//
	// Stated as a floor over all groundstroke traces rather than per trace,
	// because these are 30s of continuous reps with no pause between them —
	// harder than a rally, where swings arrive one at a time. Isolated swings
	// cut from the same captures score 50/52. See
	// llm-knowledge/experiments/2026-09-21-swing-direction-classifier.md.
	describe("direction against the recorded labels", () => {
		const groundstrokes = files.filter((n) => {
			const label = load(n).label;
			return label === "forehand" || label === "backhand";
		});

		it("has forehand and backhand traces to check", () => {
			expect(groundstrokes.length).toBeGreaterThanOrEqual(12);
		});

		it("gets at least 90% of every emitted direction right", () => {
			let right = 0;
			let total = 0;
			const worst: string[] = [];
			for (const name of groundstrokes) {
				const trace = load(name);
				const kinds = replay(trace.samples).map((e) => e.swing.kind);
				const hits = kinds.filter((k) => k === trace.label).length;
				right += hits;
				total += kinds.length;
				if (hits < kinds.length) {
					worst.push(`${name} ${hits}/${kinds.length}`);
				}
			}
			expect(total).toBeGreaterThan(40);
			expect(
				right / total,
				`misses: ${worst.join(", ")}`,
			).toBeGreaterThanOrEqual(0.9);
		});

		// The trace that proved the old classifier was reading noise. Kept as
		// its own case so a regression names itself instead of hiding inside
		// an aggregate that is still above the floor.
		it("gets forehand-06 — the trace the old classifier scored 0/10 on — entirely right", () => {
			const trace = load("forehand-06.json");
			const kinds = replay(trace.samples).map((e) => e.swing.kind);
			expect(kinds.length).toBeGreaterThanOrEqual(8);
			expect(kinds.every((k) => k === "forehand")).toBe(true);
		});
	});

	// Documents the known cost of firing early (ADR 0009): a sustained
	// opposite-direction backswing is indistinguishable from a weak opposite
	// swing without seeing the future. This asserts current behaviour, NOT
	// that the behaviour is correct.
	it("fires on a long backswing, which is the known cost of emitting early", () => {
		const samples: MotionSample[] = [];
		let t = 0;
		const push = (rot: [number, number, number], count: number) => {
			for (let i = 0; i < count; i++) {
				samples.push({ t, acc: [0, 9.8, 0], rot });
				t += 1000 / 60;
			}
		};
		push([-500, 0, 0], 25); // backswing: 416ms, clears the duration gate
		push([-100, 0, 0], 2); // decay below 70% of peak -> emits here
		push([900, 0, 0], 25); // the real forward swing
		push([0, 0, 0], 2);

		const streamed = replay(samples);
		expect(streamed[0]?.swing.kind).toBe("backhand"); // the backswing
		expect(streamed[0]?.swing.power).toBeLessThan(0.3);
	});

	// iOS devicemotion delivery stalls (backgrounding, suspension) but
	// `performance.now()` keeps advancing, so `sample.t` carries the full gap.
	// Without a reset, a hot sample right before the stall and another right
	// after look like one continuous run: `sample.t - runStart` trivially
	// clears MIN_SWING_DURATION_MS on the very first post-gap sample, and if
	// its magnitude has dipped under the stale peak's decay threshold, a
	// phantom swing is emitted from data spanning almost no real motion.
	it("resets the run across a sampling gap larger than MAX_GAP_MS, instead of treating it as one continuous swing", () => {
		const stream = createSwingStream();

		// A short hot run that has NOT qualified yet on its own — far short of
		// MIN_SWING_DURATION_MS (300ms).
		expect(
			stream.push({ t: 0, acc: [0, 9.8, 0], rot: [500, 0, 0] }),
		).toBeNull();
		expect(
			stream.push({ t: 50, acc: [0, 9.8, 0], rot: [600, 0, 0] }),
		).toBeNull();

		// The sensor stalls for longer than MAX_GAP_MS, then resumes hot.
		// `gapStart - lastHot` (300ms) exceeds MAX_GAP_MS (250ms), so this must
		// start a new run rather than continue the old one.
		const gapStart = 50 + MAX_GAP_MS + 50;
		const swing = stream.push({
			t: gapStart,
			acc: [0, 9.8, 0],
			rot: [400, 0, 0],
		});

		// Without the fix: runStart stays 0, so gapStart - runStart (350ms)
		// clears MIN_SWING_DURATION_MS, and 400 < peakMag(600) * PEAK_DECAY_EMIT
		// (420) — a phantom swing fires here, built from the stale t=50 peak.
		expect(swing).toBeNull();
	});
});
