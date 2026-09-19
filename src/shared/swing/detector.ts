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

function rotMagnitude(rot: readonly [number, number, number]): number {
	return Math.sqrt(rot[0] ** 2 + rot[1] ** 2 + rot[2] ** 2);
}

interface Run {
	startIndex: number;
	endIndex: number;
}

/** Runs of `samples` where rotation magnitude stays at or above the swing
 * threshold for at least `MIN_SWING_DURATION_MS`. Shorter crossings are
 * dropped here, before merging — they are never a swing on their own. */
function findRuns(samples: readonly MotionSample[]): Run[] {
	const runs: Run[] = [];
	let startIndex: number | null = null;

	const closeRun = (endIndex: number): void => {
		if (startIndex === null) return;
		const start = samples[startIndex];
		const end = samples[endIndex];
		if (start !== undefined && end !== undefined) {
			if (end.t - start.t >= MIN_SWING_DURATION_MS) {
				runs.push({ startIndex, endIndex });
			}
		}
		startIndex = null;
	};

	for (let i = 0; i < samples.length; i++) {
		const sample = samples[i];
		if (sample === undefined) continue;
		if (rotMagnitude(sample.rot) >= SWING_ROT_THRESHOLD_DEG_S) {
			if (startIndex === null) startIndex = i;
		} else {
			closeRun(i - 1);
		}
	}
	closeRun(samples.length - 1);

	return runs;
}

/** Collapses runs within `EPISODE_MERGE_GAP_MS` of each other into one. */
function mergeRuns(
	samples: readonly MotionSample[],
	runs: readonly Run[],
): Run[] {
	const merged: Run[] = [];
	for (const current of runs) {
		const prev = merged[merged.length - 1];
		const prevEnd = prev !== undefined ? samples[prev.endIndex] : undefined;
		const curStart = samples[current.startIndex];
		if (
			prev !== undefined &&
			prevEnd !== undefined &&
			curStart !== undefined &&
			curStart.t - prevEnd.t <= EPISODE_MERGE_GAP_MS
		) {
			prev.endIndex = current.endIndex;
		} else {
			merged.push({ ...current });
		}
	}
	return merged;
}

/** The sample with the highest rotation magnitude within `run`. */
function peakOf(samples: readonly MotionSample[], run: Run): MotionSample {
	let best = samples[run.startIndex];
	if (best === undefined) throw new Error("empty run");
	let bestMagnitude = rotMagnitude(best.rot);
	for (let i = run.startIndex + 1; i <= run.endIndex; i++) {
		const sample = samples[i];
		if (sample === undefined) continue;
		const magnitude = rotMagnitude(sample.rot);
		if (magnitude > bestMagnitude) {
			best = sample;
			bestMagnitude = magnitude;
		}
	}
	return best;
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

export function detectSwings(samples: readonly MotionSample[]): Swing[] {
	const episodes = mergeRuns(samples, findRuns(samples));
	return episodes.map((episode) => {
		const peak = peakOf(samples, episode);
		return {
			kind: classify(peak),
			power: powerOf(rotMagnitude(peak.rot)),
			at: peak.t,
		};
	});
}
