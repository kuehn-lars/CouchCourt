/**
 * Guards the committed motion traces.
 *
 * These files are the detector's training data: every threshold that ever gets
 * tuned is tuned against them. Nothing else checks them — `isTrace` runs on the
 * dev-server endpoint when a trace is saved, but a file can be edited, renamed
 * or hand-written afterwards and nothing would notice. This is the backstop.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	isTrace,
	longestGapMs,
	MAX_GAP_MS,
	type MotionTrace,
	measuredHz,
	TRACE_LABELS,
} from "../../../src/shared/swing/trace.ts";

const dir = fileURLToPath(new URL(".", import.meta.url));
const files = readdirSync(dir)
	.filter((name) => name.endsWith(".json"))
	.sort();

const load = (name: string): unknown =>
	JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));

describe("committed motion traces", () => {
	// Without this the whole suite below passes vacuously on an empty
	// directory, which is exactly the shape of green-means-nothing this repo
	// has been bitten by before.
	it("exist at all", () => {
		expect(files.length).toBeGreaterThan(0);
	});

	it.each(files)("%s is a well-formed trace", (name) => {
		expect(isTrace(load(name)), name).toBe(true);
	});

	// "A detector that never misses a forehand but fires when someone sets the
	// phone down is worse than useless at a party." Keeping this mechanical is
	// the only thing that stops the boring captures being skipped.
	it.each(TRACE_LABELS)("has at least one %s trace", (label) => {
		const matching = files.filter((name) => {
			const trace = load(name);
			return isTrace(trace) && trace.label === label;
		});
		expect(matching.length, `no trace labelled "${label}"`).toBeGreaterThan(0);
	});

	// `hz` is documented as measured, not nominal. A future recorder change that
	// hardcodes 60 — or computes it from DeviceMotionEvent.interval — would put
	// a wrong constant straight into the detector's input. Checked with the
	// recorder's own function, so the two cannot drift apart.
	it.each(files)("%s reports the rate it actually sampled at", (name) => {
		const trace = load(name) as MotionTrace;
		const measured = measuredHz(trace.samples);
		expect(measured, `${name}: stated ${trace.hz}`).toBe(trace.hz);
	});

	// The recorder refuses to save a holed capture, but only client-side — the
	// endpoint does not enforce it, so this is the only guard on what is
	// already committed.
	it.each(files)("%s has no hole in its sampling", (name) => {
		const trace = load(name) as MotionTrace;
		const gap = longestGapMs(trace.samples);
		expect(gap, `${name}: ${gap}ms gap`).toBeLessThanOrEqual(MAX_GAP_MS);
	});
});
