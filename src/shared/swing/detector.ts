/**
 * Turns a stream of `MotionSample`s into the semantic `Swing` events the wire
 * protocol carries. Pure — no DOM, no Node, no I/O — so it can be tuned
 * entirely against the recorded fixtures. See
 * `llm-knowledge/experiments/2026-09-19-ios-devicemotion-sampling.md` for the
 * measurements every constant below is taken from.
 *
 * `src/shared/**` is compiled under both a DOM-only and a Node-only tsconfig,
 * so this file names no DOM type and no Node global — see
 * `llm-knowledge/decisions/0002-host-authoritative-simulation.md`.
 */

import type { Swing, SwingKind } from "../protocol.ts";
import type { MotionSample } from "./trace.ts";

/**
 * deg/s, vector magnitude of `rotationRate`. Peak alone cannot separate a
 * swing from a hand gesture (backhands reach down to 585.7, gestures reach up
 * to 866.2 — they overlap), so this threshold exists to gate *sustained*
 * rotation, never to classify on its own. See `MIN_SWING_DURATION_MS`.
 */
export const SWING_ROT_THRESHOLD_DEG_S = 300;

/**
 * A run above the threshold shorter than this is handling, not a swing.
 * Measured: no negative trace (idle/pocket/walking/gesture) ever sustains
 * `SWING_ROT_THRESHOLD_DEG_S` for more than 200ms; every real swing does.
 */
export const MIN_SWING_DURATION_MS = 300;

/**
 * Two qualifying runs closer together than this are phases of one swing —
 * backswing, forward swing, follow-through — not two separate swings. A real
 * swing's rotation dips below the threshold between phases, briefly
 * splitting it into several short runs. Measured against the fixtures: below
 * ~800ms some real swings still fracture into a spurious extra detection;
 * 800-2000ms merges cleanly with no false merges of genuinely separate reps.
 */
export const EPISODE_MERGE_GAP_MS = 800;

/**
 * deg/s, `|gamma|` (rotationRate z-axis) at a swing's peak sample. A serve's
 * pronation/wrist-snap reaches 400-770 here; groundstrokes stay under 300 at
 * the same moment. Set at the midpoint of that gap.
 */
export const SERVE_GAMMA_THRESHOLD_DEG_S = 350;

/** Peak rotation magnitude `power` is linearly mapped from. Measured range
 * across every correctly-classified swing in the fixtures: 392.1-1401.4. */
export const POWER_FLOOR_DEG_S = 400;
export const POWER_CEIL_DEG_S = 1400;

/**
 * `power` never reads as 0 for a detected swing — a swing that cleared
 * `MIN_SWING_DURATION_MS` was a real swing attempt, and PRODUCT.md asks for
 * generous input: "when in doubt about what a player meant, guess in their
 * favour."
 */
export const POWER_FLOOR = 0.15;

export function rotMagnitude(rot: readonly [number, number, number]): number {
	return Math.sqrt(rot[0] ** 2 + rot[1] ** 2 + rot[2] ** 2);
}

/** A maximal contiguous slice of samples — a candidate swing before merging,
 * or a merged episode after. Samples, not indices: a run is meaningless
 * without the array it came from, so it carries that array with it instead
 * of a separate array plus a pair of offsets into it. */
type Run = readonly MotionSample[];

function isLongEnough(run: Run): boolean {
	const first = run[0];
	const last = run[run.length - 1];
	return (
		first !== undefined &&
		last !== undefined &&
		last.t - first.t >= MIN_SWING_DURATION_MS
	);
}

/** Maximal runs of `samples` where rotation magnitude stays at or above the
 * swing threshold for at least `MIN_SWING_DURATION_MS`. Shorter crossings
 * are dropped here, before merging — they are never a swing on their own. */
function findRuns(samples: readonly MotionSample[]): Run[] {
	const runs: Run[] = [];
	let current: MotionSample[] = [];

	const flush = (): void => {
		if (isLongEnough(current)) runs.push(current);
		current = [];
	};

	for (const sample of samples) {
		if (rotMagnitude(sample.rot) >= SWING_ROT_THRESHOLD_DEG_S) {
			current.push(sample);
		} else {
			flush();
		}
	}
	flush();

	return runs;
}

/** ms between the end of `a` and the start of `b`. */
function gapMs(a: Run, b: Run): number {
	const end = a[a.length - 1];
	const start = b[0];
	if (end === undefined || start === undefined) return Number.POSITIVE_INFINITY;
	return start.t - end.t;
}

/** Collapses runs within `EPISODE_MERGE_GAP_MS` of each other into one. */
function mergeRuns(runs: readonly Run[]): Run[] {
	const merged: MotionSample[][] = [];
	for (const run of runs) {
		const prev = merged[merged.length - 1];
		if (prev !== undefined && gapMs(prev, run) <= EPISODE_MERGE_GAP_MS) {
			prev.push(...run);
		} else {
			merged.push([...run]);
		}
	}
	return merged;
}

/** The sample with the highest rotation magnitude within `run`. Throws on an
 * empty run — `findRuns` never produces one, so this signals a caller bug. */
function peakOf(run: Run): MotionSample {
	return run.reduce((best, sample) =>
		rotMagnitude(sample.rot) > rotMagnitude(best.rot) ? sample : best,
	);
}

/** Serve's pronation spike beats groundstroke direction; otherwise the sign
 * of alpha (rotationRate x-axis) tells forehand from backhand. */
function classify(peak: MotionSample): SwingKind {
	const [alpha, , gamma] = peak.rot;
	if (Math.abs(gamma) >= SERVE_GAMMA_THRESHOLD_DEG_S) return "serve";
	return alpha > 0 ? "forehand" : "backhand";
}

function powerOf(peakMagnitude: number): number {
	const ratio =
		(peakMagnitude - POWER_FLOOR_DEG_S) /
		(POWER_CEIL_DEG_S - POWER_FLOOR_DEG_S);
	const clamped = Math.min(1, Math.max(0, ratio));
	return POWER_FLOOR + (1 - POWER_FLOOR) * clamped;
}

/**
 * A `Swing` from the single sample at an episode's peak. Split out of
 * `toSwing` so the streaming detector in `stream.ts`, which tracks its peak
 * incrementally and never holds an episode, classifies and scales power
 * through exactly this code. Two detectors, one definition of what a swing is
 * — see `llm-knowledge/decisions/0009-streaming-swing-detection.md`.
 */
export function swingFromPeak(peak: MotionSample): Swing {
	return {
		kind: classify(peak),
		power: powerOf(rotMagnitude(peak.rot)),
		at: peak.t,
	};
}

function toSwing(episode: Run): Swing {
	return swingFromPeak(peakOf(episode));
}

export function detectSwings(samples: readonly MotionSample[]): Swing[] {
	return mergeRuns(findRuns(samples)).map(toSwing);
}
