/**
 * Recorded `devicemotion` captures, used as replayable fixtures so swing
 * detection can be tuned without a phone in hand. See
 * `tests/fixtures/motion/README.md` for the on-disk format this mirrors.
 *
 * `src/shared/**` is compiled under both a DOM-only and a Node-only
 * tsconfig, so this file names no DOM type and no Node global — see
 * `llm-knowledge/decisions/0002-host-authoritative-simulation.md`.
 */

import type { SwingKind } from "../protocol.ts";

/** The three swing kinds plus the negatives a detector must not fire on. */
export type TraceLabel = SwingKind | "idle" | "walking" | "pocket" | "gesture";

export const TRACE_LABELS: readonly TraceLabel[] = [
	"forehand",
	"backhand",
	"serve",
	"idle",
	"walking",
	"pocket",
	"gesture",
];

/**
 * A capture containing an interval longer than this has a hole in it and is
 * not worth keeping — the recorder refuses to save one.
 *
 * Measured, not guessed: across 18,663 samples on the reference device the
 * worst interval was 147ms, so this leaves a 1.7x margin. A tighter value
 * would discard good captures. See
 * `llm-knowledge/experiments/2026-09-19-ios-devicemotion-sampling.md`.
 */
export const MAX_GAP_MS = 250;

export interface MotionSample {
	/** ms since the FIRST sample of the capture. */
	t: number;
	/** accelerationIncludingGravity x, y, z — m/s². */
	acc: readonly [number, number, number];
	/** rotationRate alpha, beta, gamma — deg/s. */
	rot: readonly [number, number, number];
}

export interface MotionTrace {
	label: TraceLabel;
	device: string;
	ios: string;
	/** MEASURED rate over the capture, not what the device reported. */
	hz: number;
	samples: MotionSample[];
}

/**
 * Structurally what a `DeviceMotionEvent` looks like, not that type itself —
 * naming the DOM type here would break the Node-side typecheck. A real event
 * is structurally assignable, so the recorder can pass one straight in.
 */
export interface MotionReading {
	accelerationIncludingGravity: {
		x: number | null;
		y: number | null;
		z: number | null;
	} | null;
	rotationRate: {
		alpha: number | null;
		beta: number | null;
		gamma: number | null;
	} | null;
}

const isRecord = (x: unknown): x is Record<string, unknown> =>
	typeof x === "object" && x !== null;

const isFiniteNumber = (x: unknown): x is number =>
	typeof x === "number" && Number.isFinite(x);

const isTraceLabel = (x: unknown): x is TraceLabel =>
	TRACE_LABELS.includes(x as TraceLabel);

const isNonEmptyString = (x: unknown): x is string =>
	typeof x === "string" && x.length > 0;

const isTriple = (x: unknown): x is readonly [number, number, number] =>
	Array.isArray(x) && x.length === 3 && x.every(isFiniteNumber);

const isSample = (x: unknown): x is MotionSample =>
	isRecord(x) &&
	isFiniteNumber(x.t) &&
	x.t >= 0 &&
	isTriple(x.acc) &&
	isTriple(x.rot);

/**
 * Trust boundary. This file is the only thing standing between a recorded
 * trace and both the filesystem (the dev-server endpoint builds a filename
 * from `label` — a hostile label like "../../etc/passwd" must never reach
 * it) and the detector (which treats every sample as real).
 */
export function isTrace(x: unknown): x is MotionTrace {
	if (!isRecord(x)) return false;
	if (!isTraceLabel(x.label)) return false;
	if (!isNonEmptyString(x.device)) return false;
	if (!isNonEmptyString(x.ios)) return false;
	if (!isFiniteNumber(x.hz) || x.hz <= 0) return false;
	if (!Array.isArray(x.samples)) return false;
	// An empty capture is not "no swing happened" — it is one of the two
	// silent failures of `devicemotion`: permission granted, zero events
	// delivered. Treat it as invalid, not as a valid trace with no data.
	if (x.samples.length === 0) return false;

	let prevT: number | null = null;
	for (const sample of x.samples) {
		if (!isSample(sample)) return false;
		// The other silent failure: sampling that stalls (e.g. the tab
		// backgrounding) and resumes with a stale or repeated clock. A
		// well-formed capture never goes backwards in time.
		if (prevT !== null && sample.t < prevT) return false;
		prevT = sample.t;
	}
	return true;
}

const round = (x: number, decimals: number): number => {
	const factor = 10 ** decimals;
	const rounded = Math.round(x * factor) / factor;
	// Normalise -0, which round-trips through JSON as 0 and would otherwise
	// make identical-looking traces compare unequal.
	return rounded === 0 ? 0 : rounded;
};

/**
 * Builds one recordable sample from a raw sensor reading, or `null` if it
 * cannot be trusted.
 *
 * A zeroed sample is fabricated "at rest" data fed straight to the one
 * algorithm whose entire job is telling rest from a swing — so a missing or
 * non-finite field drops the whole sample rather than defaulting to 0. A
 * fake zero looks exactly like a phone lying still on a table.
 */
export function toSample(
	t: number,
	reading: MotionReading,
): MotionSample | null {
	const acc = reading.accelerationIncludingGravity;
	const rot = reading.rotationRate;
	if (acc === null || rot === null) return null;
	if (
		!isFiniteNumber(acc.x) ||
		!isFiniteNumber(acc.y) ||
		!isFiniteNumber(acc.z) ||
		!isFiniteNumber(rot.alpha) ||
		!isFiniteNumber(rot.beta) ||
		!isFiniteNumber(rot.gamma)
	) {
		return null;
	}
	return {
		t,
		acc: [round(acc.x, 3), round(acc.y, 3), round(acc.z, 3)],
		rot: [round(rot.alpha, 2), round(rot.beta, 2), round(rot.gamma, 2)],
	};
}

/**
 * Next filename for a new capture of `label`, e.g. "forehand-04.json".
 *
 * Max-plus-one, not count-plus-one: a deleted trace must never cause a
 * silent overwrite. Names that aren't exactly `<label>-<digits>.json` are
 * ignored, since traces get renamed descriptively after recording (e.g.
 * "forehand-fast-01.json" must not be parsed as number "fast-01").
 */
export function nextTraceName(
	existing: readonly string[],
	label: TraceLabel,
): string {
	const pattern = new RegExp(`^${label}-(\\d+)\\.json$`);
	let max = 0;
	for (const name of existing) {
		const match = pattern.exec(name);
		if (match === null) continue;
		const n = Number(match[1]);
		if (n > max) max = n;
	}
	const next = max + 1;
	const padded = next < 10 ? `0${next}` : `${next}`;
	return `${label}-${padded}.json`;
}

/**
 * The rate a capture actually achieved, rounded. `0` when there is nothing to
 * measure.
 *
 * This is what belongs in `MotionTrace.hz` — never a nominal 60, and never
 * `1000 / DeviceMotionEvent.interval`. Five of the first twenty real captures
 * sampled at 57-59Hz because delivery stalled, and a hardcoded constant would
 * put that error straight into the data a detector is tuned against.
 */
export function measuredHz(samples: readonly MotionSample[]): number {
	const first = samples[0];
	const last = samples[samples.length - 1];
	if (first === undefined || last === undefined) return 0;
	const elapsed = last.t - first.t;
	// Two samples can share a millisecond on iOS, so elapsed can be 0 even
	// with samples present. Infinity here would fail isTrace much later.
	if (elapsed <= 0) return 0;
	return Math.round((1000 * (samples.length - 1)) / elapsed);
}

/** Longest interval between consecutive samples, ms. `0` when under two. */
export function longestGapMs(samples: readonly MotionSample[]): number {
	let worst = 0;
	for (let i = 1; i < samples.length; i++) {
		const prev = samples[i - 1];
		const cur = samples[i];
		if (prev === undefined || cur === undefined) continue;
		worst = Math.max(worst, cur.t - prev.t);
	}
	return worst;
}

/**
 * The on-disk fixture layout: header fields readable, one sample per line so a
 * re-recorded trace produces a legible `git diff`.
 *
 * Lives next to `isTrace` on purpose — this is the writer and that is the
 * reader of the same format, and `trace.test.ts` round-trips one through the
 * other. Split them across modules and they drift.
 */
export function formatTrace(trace: MotionTrace): string {
	const samples = trace.samples
		.map((sample) => `\t\t${JSON.stringify(sample)}`)
		.join(",\n");
	return [
		"{",
		`\t"label": ${JSON.stringify(trace.label)},`,
		`\t"device": ${JSON.stringify(trace.device)},`,
		`\t"ios": ${JSON.stringify(trace.ios)},`,
		`\t"hz": ${trace.hz},`,
		'\t"samples": [',
		samples,
		"\t]",
		"}",
		"",
	].join("\n");
}
