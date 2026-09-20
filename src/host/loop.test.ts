import { describe, expect, it } from "vitest";
import { advance, FIXED_DT, MAX_CATCHUP_TICKS } from "./loop.ts";

describe("advance", () => {
	// A literal 16.6ms, not the exact fraction 1/60 — a real frame timer never
	// lands on the exact double of 1/120s, and that's what forces the
	// alternation the plan calls out ("alternate 2 and 1 ticks").
	const FRAME_DT = 0.0166;

	it("alternates 1 and 2 ticks for 16.6ms frames at a 1/120s step, accumulator bounded", () => {
		let accumulator = 0;
		const seen = new Set<number>();
		for (let i = 0; i < 20; i++) {
			const result = advance(accumulator, FRAME_DT);
			seen.add(result.ticks);
			accumulator = result.accumulator;
			expect(accumulator).toBeGreaterThanOrEqual(0);
			expect(accumulator).toBeLessThan(FIXED_DT);
		}
		expect(seen).toEqual(new Set([1, 2]));
	});

	it("keeps alpha in [0, 1)", () => {
		let accumulator = 0;
		for (let i = 0; i < 20; i++) {
			const result = advance(accumulator, FRAME_DT);
			expect(result.alpha).toBeGreaterThanOrEqual(0);
			expect(result.alpha).toBeLessThan(1);
			accumulator = result.accumulator;
		}
	});

	it("caps a stalled tab's backlog at MAX_CATCHUP_TICKS instead of spiralling", () => {
		const result = advance(0, 3);
		expect(result.ticks).toBe(MAX_CATCHUP_TICKS);
	});

	it("a single small frame produces one tick with no more accumulated than one step", () => {
		const result = advance(0, FIXED_DT);
		expect(result.ticks).toBe(1);
		expect(result.accumulator).toBeCloseTo(0, 9);
	});
});
