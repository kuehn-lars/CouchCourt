/**
 * `callFor` is the only part of the score overlay that is not DOM: it turns
 * two consecutive `Score` values into what an umpire would say. Everything
 * else in `ui.ts` is `document.createElement`, and stays untested per
 * `CLAUDE.md` §3.
 */

import { describe, expect, it } from "vitest";
import {
	awardPoint,
	initialScore,
	type Score,
} from "../../shared/sim/scoring.ts";
import { callFor } from "./ui.ts";

/** Plays `winners` in order from a fresh score. */
function play(...winners: ("near" | "far")[]): Score[] {
	const states: Score[] = [initialScore("near")];
	for (const winner of winners) {
		const last = states[states.length - 1];
		if (last) states.push(awardPoint(last, winner));
	}
	return states;
}

const lastCall = (states: Score[]): string | null => {
	const before = states[states.length - 2];
	const after = states[states.length - 1];
	return before && after ? callFor(before, after) : null;
};

describe("callFor", () => {
	it("says nothing when the score has not changed", () => {
		const score = initialScore("near");
		expect(callFor(score, score)).toBeNull();
	});

	it("calls the running score with the server's points first", () => {
		expect(lastCall(play("near"))).toBe("15 – 0");
		expect(lastCall(play("near", "far"))).toBe("15 all");
		expect(lastCall(play("near", "far", "far"))).toBe("15 – 30");
	});

	it("calls deuce and advantage", () => {
		const toDeuce: ("near" | "far")[] = [
			"near",
			"far",
			"near",
			"far",
			"near",
			"far",
		];
		expect(lastCall(play(...toDeuce))).toBe("Deuce");
		expect(lastCall(play(...toDeuce, "near"))).toBe("Advantage Near");
		expect(lastCall(play(...toDeuce, "far"))).toBe("Advantage Far");
	});

	it("calls the game, not the points, on the point that wins it", () => {
		expect(lastCall(play("near", "near", "near", "near"))).toBe("Game — Near");
	});

	it("calls the set ahead of the game that won it", () => {
		let score = initialScore("near");
		// Six straight games to `near`.
		while (!score.setWinner) score = awardPoint(score, "near");
		const before = { ...score, setWinner: null } as Score;
		expect(callFor(before, score)).toBe("Set — Near");
	});
});
