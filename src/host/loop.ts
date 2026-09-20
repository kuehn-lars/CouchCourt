/**
 * Fixed-timestep accumulator. `advance` is the whole reason this file exists:
 * rendering a fixed-step sim without interpolating by `alpha` is what makes
 * it judder, whatever the materials look like
 * (`llm-knowledge/modules/host.md`, "The frame").
 *
 * Pure and DOM-free on purpose, unlike `main.ts` — this is the part worth
 * testing without a browser.
 */

/** 120Hz, matching every `sim/` test's own `DT`. */
export const FIXED_DT = 1 / 120;

/**
 * A stalled tab (locked screen, backgrounded — see
 * `llm-knowledge/platform/ios-safari-tab-suspension.md`) can return with
 * seconds of backlog. Running it all would spiral: each caught-up tick takes
 * real time to simulate, which grows the backlog it was meant to clear.
 */
export const MAX_CATCHUP_TICKS = 5;

export interface Advance {
	/** Fixed-step ticks to run this frame. */
	readonly ticks: number;
	/** Leftover time carried into the next frame. */
	readonly accumulator: number;
	/** Where "now" sits between the last tick and the next one, `[0, 1)`. */
	readonly alpha: number;
}

export function advance(accumulator: number, frameDt: number): Advance {
	const acc = accumulator + frameDt;
	const ticks = Math.floor(acc / FIXED_DT);

	if (ticks > MAX_CATCHUP_TICKS) {
		// Drop the backlog rather than carrying it forward, or the next frame
		// would face the same overflow again.
		return { ticks: MAX_CATCHUP_TICKS, accumulator: 0, alpha: 0 };
	}

	const remainder = acc - ticks * FIXED_DT;
	return { ticks, accumulator: remainder, alpha: remainder / FIXED_DT };
}
