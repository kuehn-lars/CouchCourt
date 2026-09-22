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

import type { Swing, SwingKind } from "../protocol.ts";
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

/** Time constant, ms, of the running estimate of gravity the stroke is read
 * against. `accelerationIncludingGravity` is mostly the swing itself during a
 * swing, so the estimate is frozen when a lobe starts: it says how the racket
 * was held going *into* the swing. */
export const GRAVITY_TAU_MS = 200;

/**
 * An overhand starts with the racket up; a groundstroke with it at the
 * player's side. In the fixtures' grip the device's x axis (across the
 * screen) is close to vertical for a groundstroke — normalised gravity x of
 * −0.6 to −1.0 — and horizontal for an overhand, −0.2 to +0.4. Above this it
 * is an overhead. Measured 2026-09-22: 8 of 8 serve swings, 3 of 67
 * groundstroke peaks, flat from −0.4 to −0.25
 * (`llm-knowledge/experiments/2026-09-22-stroke-classifier.md`).
 */
export const OVERHEAD_TILT = -0.3;

/** How much of `gamma` counts toward the side of a groundstroke. Some hard
 * forehands are almost pure wrist snap at the peak — `(3, 241, 1012)` — and
 * their gamma is what says forehand. Flat from 0.3 to 0.5. */
export const SIDE_GAMMA_WEIGHT = 0.4;

/** What `peak` looks like, given the gravity the racket started from. */
export function strokeOf(
	peak: MotionSample,
	gravity: readonly [number, number, number],
): Exclude<SwingKind, "serve"> {
	const g = rotMagnitude(gravity);
	if (g > 0 && gravity[0] / g > OVERHEAD_TILT) return "overhead";
	const side = (peak.rot[TURN_AXIS] ?? 0) + SIDE_GAMMA_WEIGHT * peak.rot[2];
	return side > 0 ? "forehand" : "backhand";
}

export interface SwingStream {
	/**
	 * Feed one sample. Returns the swing that just became detectable, or
	 * `null`. At most one swing per call.
	 */
	push(sample: MotionSample): Swing | null;
	/** Rotation of the latest sample, deg/s — the controller draws it. */
	readonly level: number;
	/** What the swing in progress looks like so far, or `null` between
	 * swings. For the controller's debug readout; the host never sees it. */
	readonly current: SwingKind | null;
}

/** O(1) state: no sample buffer, so a phone shaken for a minute costs
 * nothing. */
export function createSwingStream(): SwingStream {
	let lobeStart: number | null = null;
	let lastT: number | null = null;
	let peak: MotionSample | null = null;
	let peakMag = 0;
	/** The loudest sample of the lobe so far, kept across announcements, for
	 * `current`. */
	let loudest: MotionSample | null = null;
	/** Magnitude of the last peak this lobe announced, or 0. */
	let fired = 0;
	let level = 0;
	let gravity: [number, number, number] | null = null;
	/** `gravity` as it was when the lobe started. */
	let held: [number, number, number] = [0, 0, 0];

	const endLobe = (): void => {
		lobeStart = null;
		peak = null;
		peakMag = 0;
		loudest = null;
		fired = 0;
	};

	/** The pending peak, if it has qualified and the rotation has fallen far
	 * enough off it to be sure it was the peak. */
	const announce = (now: number, ended: boolean): Swing | null => {
		if (peak === null || lobeStart === null) return null;
		const needed = fired > 0 ? fired * REFIRE_RATIO : TRIGGER_DEG_S;
		if (peakMag < needed) return null;
		if (!ended && level > peakMag * PEAK_CONFIRM) return null;
		if (fired === 0 && peak.t - lobeStart < MIN_RISE_MS) return null;

		const swing = {
			...swingFrom(peak, peak),
			kind: strokeOf(peak, held),
			lag: now - peak.t,
		};
		fired = peakMag;
		peak = null;
		peakMag = 0;
		return swing;
	};

	return {
		get level() {
			return level;
		},
		get current() {
			return loudest === null ? null : strokeOf(loudest, held);
		},
		push(sample) {
			const m = rotMagnitude(sample.rot);
			level = m;
			// A stalled sensor, not a continuous lobe: `sample.t` keeps
			// running through a stall (MAX_GAP_MS is measured in trace.ts).
			const dt = lastT === null ? 0 : sample.t - lastT;
			if (dt > MAX_GAP_MS) endLobe();
			lastT = sample.t;

			const ended = m < LOBE_FLOOR_DEG_S;
			if (!ended) {
				if (lobeStart === null) {
					lobeStart = sample.t;
					held = gravity ?? [...sample.acc];
				}
				if (m > peakMag) {
					peakMag = m;
					peak = sample;
				}
				if (loudest === null || m > rotMagnitude(loudest.rot)) loudest = sample;
			}
			const k = Math.min(1, dt / GRAVITY_TAU_MS);
			gravity =
				gravity === null
					? [...sample.acc]
					: [
							gravity[0] + (sample.acc[0] - gravity[0]) * k,
							gravity[1] + (sample.acc[1] - gravity[1]) * k,
							gravity[2] + (sample.acc[2] - gravity[2]) * k,
						];

			// A lobe that ends straight off its peak — rotation falling from
			// 1300 to under the floor in one sample — still announces it.
			const swing = announce(sample.t, ended);
			if (ended) endLobe();
			return swing;
		},
	};
}
