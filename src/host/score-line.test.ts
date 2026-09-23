import { describe, expect, it } from "vitest";
import { createMatch, type MatchState, tick } from "../shared/sim/index.ts";
import { scoreLine } from "./score-line.ts";

const swing = { kind: "forehand" as const, power: 0.6, at: 0, lag: 0 };

describe("scoreLine", () => {
	it("starts at love all, the ball in the server's hand", () => {
		expect(scoreLine(createMatch("far"))).toEqual({
			games: { near: 0, far: 0 },
			points: { near: "0", far: "0" },
			serving: "far",
			ball: "hand",
		});
	});

	// "Your serve: swing to toss" is only true while the ball is in hand.
	it("reports the toss once the server has swung", () => {
		const s = createMatch("near");
		const tossed = tick(s, [{ side: "near", swing, time: s.time }], 1 / 120);
		expect(scoreLine(tossed).ball).toBe("toss");
	});

	it("says AD and 40 as the umpire would", () => {
		const s = createMatch("near");
		const state: MatchState = {
			...s,
			score: { ...s.score, points: { near: "AD", far: 40 } },
		};
		expect(scoreLine(state).points).toEqual({ near: "AD", far: "40" });
	});

	it("counts a tiebreak in plain numbers", () => {
		const s = createMatch("near");
		const state: MatchState = {
			...s,
			score: {
				...s.score,
				games: { near: 6, far: 6 },
				tiebreak: { points: { near: 4, far: 5 }, firstServer: "near" },
			},
		};
		expect(scoreLine(state).points).toEqual({ near: "4", far: "5" });
	});
});
