/**
 * The live counterpart to `detectSwings`. Same thresholds, same idea of what a
 * swing is — but it emits BEFORE the swing has finished, because the batch
 * detector cannot know an episode ended until `EPISODE_MERGE_GAP_MS` of quiet
 * has passed, and a second of latency is not a game.
 *
 * Why this exists at all, what firing early costs, and the alternatives
 * rejected: `llm-knowledge/decisions/0009-streaming-swing-detection.md`.
 * The measurements behind PEAK_DECAY_EMIT:
 * `llm-knowledge/experiments/2026-09-20-streaming-swing-latency.md`.
 *
 * `src/shared/**` is compiled under both a DOM-only and a Node-only tsconfig,
 * so this file names no DOM type and no Node global.
 */

import type { Swing } from "../protocol.ts";
import {
	EPISODE_MERGE_GAP_MS,
	MIN_SWING_DURATION_MS,
	rotMagnitude,
	SWING_ROT_THRESHOLD_DEG_S,
	swingFromPeak,
} from "./detector.ts";
import type { MotionSample } from "./trace.ts";

/**
 * Fraction of the run's running peak that rotation must fall to before the
 * swing is announced. The peak is behind us at that point, so the swing can be
 * classified and scaled from it.
 *
 * Measured across the 20 committed fixtures: 0.7 emits a median 133ms after
 * the peak (p90 234ms, max 317ms), against 1066ms for a faithful batch replay.
 * 0.6 and 0.5 are slower on both — the run must decay further before they
 * trigger. Higher than 0.7 fires on the first downward tick, which is noise or
 * a local maximum of a swing still accelerating.
 */
export const PEAK_DECAY_EMIT = 0.7;

export interface SwingStream {
	/**
	 * Feed one sample. Returns the swing that just became detectable, or
	 * `null`. At most one swing per call.
	 */
	push(sample: MotionSample): Swing | null;
}

/**
 * Carries O(1) state — the run's start, its peak sample and that peak's
 * magnitude. Deliberately no sample buffer: a player who shakes the phone for
 * a minute must cost nothing, and a buffer would need a length nobody has
 * measured.
 */
export function createSwingStream(): SwingStream {
	let runStart: number | null = null;
	let lastHot: number | null = null;
	let peak: MotionSample | null = null;
	let peakMag = 0;
	// Absolute sample time until which everything is ignored. This is the
	// streaming equivalent of the batch detector's episode merge: one swing's
	// backswing, strike and follow-through must announce themselves once.
	let mutedUntil: number | null = null;

	const clearRun = (): void => {
		runStart = null;
		lastHot = null;
		peak = null;
		peakMag = 0;
	};

	const emit = (at: number): Swing | null => {
		if (peak === null) return null;
		const swing = swingFromPeak(peak);
		mutedUntil = at + EPISODE_MERGE_GAP_MS;
		clearRun();
		return swing;
	};

	return {
		push(sample: MotionSample): Swing | null {
			if (mutedUntil !== null) {
				if (sample.t < mutedUntil) return null;
				mutedUntil = null;
			}

			const magnitude = rotMagnitude(sample.rot);

			if (magnitude >= SWING_ROT_THRESHOLD_DEG_S) {
				if (runStart === null) runStart = sample.t;
				lastHot = sample.t;
				if (magnitude > peakMag) {
					peakMag = magnitude;
					peak = sample;
				}
				// Duration measured to this sample, exactly as `findRuns` does.
				const qualified = sample.t - runStart >= MIN_SWING_DURATION_MS;
				if (qualified && magnitude < peakMag * PEAK_DECAY_EMIT) {
					return emit(sample.t);
				}
				return null;
			}

			// Below threshold: the run is over. Announce it if it was long
			// enough, measured between its first and last HOT samples so this
			// agrees with the batch detector rather than counting the silent
			// sample that ended it.
			const started = runStart;
			const ended = lastHot;
			if (
				started !== null &&
				ended !== null &&
				ended - started >= MIN_SWING_DURATION_MS
			) {
				return emit(sample.t);
			}
			clearRun();
			return null;
		},
	};
}
