import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Swing } from "../protocol.ts";
import { detectSwings } from "./detector.ts";
import { createSwingStream } from "./stream.ts";
import { isTrace, type MotionSample, type MotionTrace } from "./trace.ts";

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
	it("emits within 250ms of the peak at p90", () => {
		const latencies: number[] = [];
		for (const name of positives) {
			for (const e of replay(load(name).samples)) {
				latencies.push(e.emitAt - e.swing.at);
			}
		}
		latencies.sort((a, b) => a - b);
		const p90 = latencies[Math.floor(latencies.length * 0.9)];
		expect(p90).toBeDefined();
		expect(p90).toBeLessThanOrEqual(250);
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
		expect(streamed[0]?.swing).toEqual(batch);
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
});
