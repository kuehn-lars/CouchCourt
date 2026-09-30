/**
 * The swing cooldown: once a swing starts, the racket has to recharge before
 * another one counts, so flailing the phone cannot cover the timing window.
 *
 * **A swing is several peaks.** Backswing, swing and follow-through each
 * fire (`stream.ts`), and the host plays the hardest one in its window, so
 * every peak inside `SWING_GROUP_MS` of the first is let through. Measured
 * 2026-09-27 over the committed fixtures: peaks of one swing land 66-450ms
 * apart, a few up to ~600; the next rep starts 700ms+ later. A shorter group
 * drops the real swing behind its own backswing.
 *
 * **A take-back can come a full second before its swing**, and it is often
 * read as the opposite stroke. So a peak past the group that is harder than
 * everything in it is the swing, not a new one: it is let through and the
 * cooldown restarts from it — once per swing. Timing the cooldown from the
 * first peak refused five real swings in the 30s captures, mostly
 * backhands. A flail no harder than what opened it is still dropped.
 *
 * **The cooldown cannot touch real play.** Two bots never strike twice within
 * 1.97s (three sets, 2026-09-27): the ball has to cross the court and come
 * back first. Recorded in
 * `llm-knowledge/decisions/0022-arcade-layer.md`.
 *
 * Runs on the phone, before the swing is sent, so the racket can draw the
 * recharge from the same numbers that enforce it. Times are the stream's own
 * clock, milliseconds.
 *
 * `src/shared/**` is compiled under both a DOM-only and a Node-only tsconfig,
 * so this file names no DOM type and no Node global.
 */

export const SWING_GROUP_MS = 600;
export const SWING_COOLDOWN_MS = 1200;

export interface SwingGate {
	/** Whether the peak at `at` with `power` counts. A counted peak that
	 * starts a new swing, or is the hardest of its swing so far after the
	 * group, (re)starts the cooldown; a dropped one changes nothing. */
	admit(at: number, power: number): boolean;
	/** 0 at the start of a swing, rising to 1 once the next can start. */
	charge(now: number): number;
	/** Forget the last swing — the serve, where the toss and the hit are two
	 * swings close together and neither is spam. */
	reset(): void;
}

export function createSwingGate(): SwingGate {
	/** When the cooldown runs from. */
	let start: number | null = null;
	let hardest = 0;
	/** Whether this swing has already moved `start` to a harder peak. */
	let moved = false;
	return {
		admit(at, power) {
			if (start === null || at - start >= SWING_COOLDOWN_MS) {
				start = at;
				hardest = power;
				moved = false;
				return true;
			}
			if (at - start <= SWING_GROUP_MS) {
				hardest = Math.max(hardest, power);
				return true;
			}
			if (!moved && power > hardest) {
				start = at;
				moved = true;
				return true;
			}
			return false;
		},
		charge(now) {
			if (start === null) return 1;
			return Math.min(1, Math.max(0, (now - start) / SWING_COOLDOWN_MS));
		},
		reset() {
			start = null;
		},
	};
}
