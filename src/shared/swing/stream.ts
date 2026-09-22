/**
 * The live swing detector that runs on the phone. It announces a swing at its
 * **peak** — the moment the racket is moving fastest, which is the moment it
 * would meet the ball — one or two samples after it happens.
 *
 * The previous detector waited for 300ms of sustained rotation, then for the
 * run to decay, then another 150ms, so its swings arrived a median 200ms after
 * the peak (p90 334ms). That delay is what the host could not undo, and it is
 * why returns stopped connecting
 * (`llm-knowledge/decisions/0015-contact-model.md`).
 *
 * **What it gave up.** The sustained-rotation gate was what kept a hand
 * gesture or a walking stride from firing, and no gate that can be checked at
 * the peak separates them from real swings (measured 2026-09-22: backhands
 * rise to their peak in 66-183ms, gestures in 11-134ms). They fire now. That
 * is affordable because the host has changed what a swing *means*: nothing
 * happens unless a ball is at the player's contact point, or the player is
 * about to serve (where a stray swing tosses the ball, which is caught). A
 * phone lying still or in a pocket still never gets near a swing — the bar
 * `PRODUCT.md` actually sets.
 *
 * **One swing, several peaks.** A backswing, the swing and the
 * follow-through can each fire. The host plays the hardest one inside the
 * timing window, so the phone reports them all rather than guessing.
 *
 * `src/shared/**` is compiled under both a DOM-only and a Node-only tsconfig,
 * so this file names no DOM type and no Node global.
 */

import type { Swing } from "../protocol.ts";
import { rotMagnitude, swingFrom, TURN_AXIS } from "./detector.ts";
import { MAX_GAP_MS, type MotionSample } from "./trace.ts";

/** deg/s. Rotation below this is not part of any swing: a lobe starts and
 * ends here. Idle and pocket captures peak at 301 at most. */
export const LOBE_FLOOR_DEG_S = 200;

/** deg/s a lobe must peak at to be a swing. The same number `power` starts
 * counting from (`POWER_FLOOR_DEG_S`); the softest real swing peak in the
 * fixtures is 405. */
export const TRIGGER_DEG_S = 400;

/** Fraction of the peak rotation must fall to before the peak is announced.
 * A swing decelerates steeply after contact, so this is one sample, two at
 * most — and it is what stops a swing still speeding up from firing early. */
export const PEAK_CONFIRM = 0.85;

/** A lobe that reaches its peak faster than this is a knock or a drop, not
 * a swing — nothing with a racket in it winds up in under 40ms. */
export const MIN_RISE_MS = 40;

/** How much harder a later peak in the same lobe must be to be reported as
 * well — the swing after a backswing that never paused. */
export const REFIRE_RATIO = 1.05;

export interface SwingStream {
	/**
	 * Feed one sample. Returns the swing that just became detectable, or
	 * `null`. At most one swing per call.
	 */
	push(sample: MotionSample): Swing | null;
	/** Rotation of the latest sample, deg/s — the controller draws it. */
	readonly level: number;
}

/** O(1) state: no sample buffer, so a phone shaken for a minute costs
 * nothing. */
export function createSwingStream(): SwingStream {
	let lobeStart: number | null = null;
	let lastT: number | null = null;
	let peak: MotionSample | null = null;
	let peakMag = 0;
	// The fastest turn so far, which is what decides forehand or backhand
	// (`detector.ts`, `classify`) — often a different sample from the peak.
	let turn: MotionSample | null = null;
	let turnMag = 0;
	/** Magnitude of the last peak this lobe announced, or 0. */
	let fired = 0;
	let level = 0;

	const endLobe = (): void => {
		lobeStart = null;
		peak = null;
		peakMag = 0;
		turn = null;
		turnMag = 0;
		fired = 0;
	};

	/** The pending peak, if it has qualified and the rotation has fallen far
	 * enough off it to be sure it was the peak. */
	const announce = (now: number, ended: boolean): Swing | null => {
		if (peak === null || turn === null || lobeStart === null) return null;
		const needed = fired > 0 ? fired * REFIRE_RATIO : TRIGGER_DEG_S;
		if (peakMag < needed) return null;
		if (!ended && level > peakMag * PEAK_CONFIRM) return null;
		if (fired === 0 && peak.t - lobeStart < MIN_RISE_MS) return null;

		const swing = { ...swingFrom(peak, turn), lag: now - peak.t };
		fired = peakMag;
		peak = null;
		peakMag = 0;
		turn = null;
		turnMag = 0;
		return swing;
	};

	return {
		get level() {
			return level;
		},
		push(sample) {
			const m = rotMagnitude(sample.rot);
			level = m;
			// A stalled sensor, not a continuous lobe: `sample.t` keeps
			// running through a stall (MAX_GAP_MS is measured in trace.ts).
			if (lastT !== null && sample.t - lastT > MAX_GAP_MS) endLobe();
			lastT = sample.t;

			const ended = m < LOBE_FLOOR_DEG_S;
			if (!ended) {
				lobeStart ??= sample.t;
				if (m > peakMag) {
					peakMag = m;
					peak = sample;
				}
				const turning = Math.abs(sample.rot[TURN_AXIS] ?? 0);
				if (turning > turnMag) {
					turnMag = turning;
					turn = sample;
				}
			}

			// A lobe that ends straight off its peak — rotation falling from
			// 1300 to under the floor in one sample — still announces it.
			const swing = announce(sample.t, ended);
			if (ended) endLobe();
			return swing;
		},
	};
}
