import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_SWING_LAG_MS, type Swing } from "../protocol.ts";
import { rotMagnitude } from "./detector.ts";
import { createSwingStream, LOBE_FLOOR_DEG_S } from "./stream.ts";
import {
	isTrace,
	MAX_GAP_MS,
	type MotionSample,
	type MotionTrace,
} from "./trace.ts";

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

const SWINGS = ["forehand", "backhand", "serve"];
const swingTraces = files.filter((n) => SWINGS.includes(load(n).label));

/** Every lobe in `samples` loud enough to be the main part of a swing —
 * what a player would call "the swing". A lobe already under way when the
 * capture started is skipped: its wind-up is not in the data. */
function mainLobes(
	samples: readonly MotionSample[],
	floor: number,
): { start: number; end: number; peak: number }[] {
	const lobes: { start: number; end: number; peak: number }[] = [];
	let start: number | null = null;
	let peak = 0;
	for (const s of samples) {
		const m = rotMagnitude(s.rot);
		if (m >= LOBE_FLOOR_DEG_S) {
			start ??= s.t;
			peak = Math.max(peak, m);
			continue;
		}
		if (start !== null && peak >= floor && start > (samples[0]?.t ?? 0)) {
			lobes.push({ start, end: s.t, peak });
		}
		start = null;
		peak = 0;
	}
	return lobes;
}

const at = (t: number, rot: number): MotionSample => ({
	t,
	acc: [0, 9.8, 0],
	rot: [rot, 0, 0],
});

/** A smooth lobe: up to `peak` and back down, 60Hz, starting at `t0`. */
function lobe(t0: number, peak: number, samples = 24): MotionSample[] {
	return Array.from({ length: samples }, (_, i) =>
		at(t0 + (i * 1000) / 60, peak * Math.sin((Math.PI * (i + 0.5)) / samples)),
	);
}

describe("createSwingStream", () => {
	it("has swing fixtures to replay", () => {
		expect(swingTraces.length).toBeGreaterThanOrEqual(15);
	});

	// PRODUCT.md: "setting the phone down mid-conversation never reads as a
	// shot." A phone lying still or in a pocket never gets near a swing.
	const resting = files.filter((n) =>
		["idle", "pocket"].includes(load(n).label),
	);
	it.each(resting)("%s never fires", (name) => {
		expect(replay(load(name).samples)).toEqual([]);
	});

	it.each(swingTraces)("%s fires", (name) => {
		expect(replay(load(name).samples).length).toBeGreaterThan(0);
	});

	// The point of the rewrite: announce the swing at its peak. The old
	// detector held 150ms past a decay trigger and reported a median lag of
	// 200ms, p90 334ms.
	it("announces a swing a sample or two after its peak", () => {
		const lags: number[] = [];
		for (const name of swingTraces) {
			for (const e of replay(load(name).samples))
				lags.push(e.emitAt - e.swing.at);
		}
		lags.sort((x, y) => x - y);
		expect(lags.length).toBeGreaterThan(80);
		expect(lags[Math.floor(lags.length / 2)]).toBeLessThanOrEqual(55);
		expect(lags[Math.floor(lags.length * 0.9)]).toBeLessThanOrEqual(100);
	});

	it("reports every real swing at (nearly) its full speed", () => {
		let total = 0;
		const missed: string[] = [];
		for (const name of swingTraces) {
			const samples = load(name).samples;
			const magAt = new Map(samples.map((s) => [s.t, rotMagnitude(s.rot)]));
			const emitted = replay(samples).map((e) => magAt.get(e.swing.at) ?? 0);
			const ats = replay(samples).map((e) => e.swing.at);
			for (const lobe of mainLobes(samples, 600)) {
				total++;
				const best = Math.max(
					0,
					...ats.map((t, i) =>
						t >= lobe.start && t < lobe.end ? (emitted[i] ?? 0) : 0,
					),
				);
				if (best < lobe.peak * 0.95) missed.push(`${name}@${lobe.start}`);
			}
		}
		expect(total).toBeGreaterThan(70);
		expect(missed).toEqual([]);
	});

	it("reports `lag` as exactly the delay between the peak and the emission", () => {
		for (const name of swingTraces) {
			for (const e of replay(load(name).samples)) {
				expect(e.swing.lag).toBeCloseTo(e.emitAt - e.swing.at, 6);
				expect(e.swing.lag).toBeGreaterThanOrEqual(0);
				expect(e.swing.lag).toBeLessThanOrEqual(MAX_SWING_LAG_MS);
			}
		}
	});

	it("never claims a serve — the sim decides that from the phase", () => {
		for (const name of swingTraces) {
			for (const e of replay(load(name).samples)) {
				expect(e.swing.kind).not.toBe("serve");
			}
		}
	});

	it("fires once for one smooth swing", () => {
		expect(replay(lobe(0, 900))).toHaveLength(1);
	});

	it("ignores a lobe that never gets fast enough to be a swing", () => {
		expect(replay(lobe(0, 380))).toEqual([]);
	});

	it("announces a swing whose rotation stops dead straight off the peak", () => {
		const abrupt = [
			at(0, 250),
			at(17, 500),
			at(33, 800),
			at(50, 1200),
			at(67, 50),
		];
		const out = replay(abrupt);
		expect(out).toHaveLength(1);
		expect(out[0]?.swing.at).toBe(50);
	});

	it("ignores a knock: a spike with no wind-up", () => {
		const knock = [at(0, 0), at(16, 0), at(33, 1200), at(50, 100), at(66, 0)];
		expect(replay(knock)).toEqual([]);
	});

	// Backswing and swing without the rotation ever dropping in between.
	// The host plays the harder of the two, so the phone must report both.
	it("reports a harder second peak in the same lobe", () => {
		const samples = [
			...lobe(0, 500, 20),
			...lobe(20 * (1000 / 60), 1100, 20).map((s) => ({
				...s,
				rot: [Math.max(s.rot[0], LOBE_FLOOR_DEG_S + 10), 0, 0] as const,
			})),
			at(41 * (1000 / 60), 0),
		];
		const powers = replay(samples).map((e) => e.swing.power);
		expect(powers).toHaveLength(2);
		expect(powers[1]).toBeGreaterThan(powers[0] ?? 1);
	});

	// iOS devicemotion stalls when backgrounded but `performance.now()` keeps
	// running, so a hot sample either side of a stall must not read as one
	// continuous lobe.
	it("starts a new lobe across a sampling gap larger than MAX_GAP_MS", () => {
		const stream = createSwingStream();
		expect(stream.push(at(0, 300))).toBeNull();
		expect(stream.push(at(16, 900))).toBeNull();
		// Stalled, then resumes lower: that is NOT the old lobe's decay.
		expect(stream.push(at(16 + MAX_GAP_MS + 50, 500))).toBeNull();
	});
});
