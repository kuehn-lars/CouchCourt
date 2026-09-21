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
	swingFrom,
	TURN_AXIS,
} from "./detector.ts";
import { MAX_GAP_MS, type MotionSample } from "./trace.ts";

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

/**
 * Extra milliseconds of the swing to watch after the decay trigger fires,
 * before announcing it.
 *
 * The decay trigger says "the peak is behind us". It does not say the swing
 * is over, and the difference decides forehand from backhand: at the trigger
 * the racket is often still coming through, and the fastest turn of the whole
 * swing has not happened yet. Measured across all 15 swing traces — the 9
 * original 6s captures plus the 6 new 30s ones — the direction is right in
 * 47 of 55 emissions at +0ms and **52 of 55 at +150ms**. On isolated swings
 * cut out with real quiet either side, which is what gameplay actually looks
 * like, it is 50 of 52. Past +150ms nothing further is gained.
 *
 * The cost is latency: median 133ms after the peak becomes 200ms, p90 334ms.
 * That would be unaffordable — `MISS_WINDOW` is 280ms, so p90 would read as a
 * whiff — except that `Swing.lag` now carries the delay and the host subtracts
 * it. See `llm-knowledge/decisions/0013-detector-latency-is-compensated.md`.
 */
export const EMIT_HOLD_MS = 150;

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
	// The fastest turn seen so far, tracked separately from the loudest
	// sample because they are routinely different samples and this is the one
	// that decides which way the ball goes (`detector.ts`, `turnOf`).
	let turn: MotionSample | null = null;
	let turnMag = 0;
	// Sample time at which a swing whose peak is already behind it will be
	// announced. Set by the decay trigger, not acted on until it passes, so
	// the run keeps feeding `peak` and `turn` in the meantime.
	let holdUntil: number | null = null;
	// Absolute sample time until which everything is ignored. This is the
	// streaming equivalent of the batch detector's episode merge: one swing's
	// backswing, strike and follow-through must announce themselves once.
	let mutedUntil: number | null = null;

	const clearRun = (): void => {
		runStart = null;
		lastHot = null;
		peak = null;
		peakMag = 0;
		turn = null;
		turnMag = 0;
		holdUntil = null;
	};

	const emit = (at: number): Swing | null => {
		if (peak === null || turn === null) return null;
		const swing = { ...swingFrom(peak, turn), lag: at - peak.t };
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
				// A gap this long is a stalled sensor, not a continuous swing
				// (MAX_GAP_MS is measured in trace.ts against real capture
				// stalls). `sample.t` keeps advancing through the stall, so
				// without this the resumed run inherits a runStart and peak
				// from before it and can qualify and emit off almost no real
				// motion.
				if (
					runStart !== null &&
					lastHot !== null &&
					sample.t - lastHot > MAX_GAP_MS
				) {
					clearRun();
				}
				if (runStart === null) runStart = sample.t;
				lastHot = sample.t;
				if (magnitude > peakMag) {
					peakMag = magnitude;
					peak = sample;
				}
				const turning = Math.abs(sample.rot[TURN_AXIS] ?? 0);
				if (turning > turnMag) {
					turnMag = turning;
					turn = sample;
				}
				// The hold set by an earlier decay trigger. Everything above
				// still ran, so the swing announced here is the best view of
				// it available — that is the entire point of waiting.
				if (holdUntil !== null) {
					return sample.t >= holdUntil ? emit(sample.t) : null;
				}
				// Duration measured to this sample, exactly as `findRuns` does.
				const qualified = sample.t - runStart >= MIN_SWING_DURATION_MS;
				if (qualified && magnitude < peakMag * PEAK_DECAY_EMIT) {
					holdUntil = sample.t + EMIT_HOLD_MS;
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
