import { describe, expect, it } from "vitest";
import { backoffMs } from "./session.ts";

describe("backoffMs", () => {
	it("doubles from half a second", () => {
		expect([0, 1, 2, 3, 4].map(backoffMs)).toEqual([
			500, 1000, 2000, 4000, 8000,
		]);
	});

	// A phone in a pocket for ten minutes must not queue a reconnect storm,
	// and must still come back promptly when it wakes.
	it("caps so a long absence does not back off forever", () => {
		expect(backoffMs(20)).toBe(8000);
	});

	it("never returns a negative or zero delay", () => {
		for (let i = 0; i < 30; i++) expect(backoffMs(i)).toBeGreaterThan(0);
	});
});
