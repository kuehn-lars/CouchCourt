import { describe, expect, test } from "vitest";
import { awardPoint, initialScore } from "./scoring.ts";

describe("points within a game", () => {
	test("climbs the 0/15/30/40 ladder", () => {
		let score = initialScore("near");
		score = awardPoint(score, "near");
		expect(score.points.near).toBe(15);
		score = awardPoint(score, "near");
		expect(score.points.near).toBe(30);
		score = awardPoint(score, "near");
		expect(score.points.near).toBe(40);
	});

	test("winning at 40 against an opponent below 40 takes the game", () => {
		let score = initialScore("near");
		score = awardPoint(score, "near"); // 15-0
		score = awardPoint(score, "near"); // 30-0
		score = awardPoint(score, "near"); // 40-0
		score = awardPoint(score, "near"); // game
		expect(score.games.near).toBe(1);
		expect(score.points).toEqual({ near: 0, far: 0 });
	});

	test("40-40 is deuce, and winning from deuce is advantage, not game", () => {
		let score = initialScore("near");
		for (const w of ["near", "far", "near", "far", "near", "far"] as const) {
			score = awardPoint(score, w);
		}
		expect(score.points).toEqual({ near: 40, far: 40 });
		score = awardPoint(score, "near");
		expect(score.points).toEqual({ near: "AD", far: 40 });
		expect(score.games.near).toBe(0);
	});

	test("winning from advantage takes the game", () => {
		let score = initialScore("near");
		for (const w of [
			"near",
			"far",
			"near",
			"far",
			"near",
			"far",
			"near",
		] as const) {
			score = awardPoint(score, w);
		}
		expect(score.points).toEqual({ near: "AD", far: 40 });
		score = awardPoint(score, "near");
		expect(score.games.near).toBe(1);
		expect(score.points).toEqual({ near: 0, far: 0 });
	});

	test("losing from advantage returns to deuce, not to a 4th point", () => {
		let score = initialScore("near");
		for (const w of [
			"near",
			"far",
			"near",
			"far",
			"near",
			"far",
			"near",
		] as const) {
			score = awardPoint(score, w);
		}
		expect(score.points).toEqual({ near: "AD", far: 40 });
		score = awardPoint(score, "far");
		expect(score.points).toEqual({ near: 40, far: 40 });
		expect(score.games).toEqual({ near: 0, far: 0 });
	});

	test("deuce and advantage repeatedly, back and forth, never resolves early", () => {
		let score = initialScore("near");
		// Reach deuce.
		for (const w of ["near", "far", "near", "far", "near", "far"] as const) {
			score = awardPoint(score, w);
		}
		// Bounce off advantage five times without either side winning the game.
		for (let i = 0; i < 5; i++) {
			score = awardPoint(score, "near");
			expect(score.points).toEqual({ near: "AD", far: 40 });
			score = awardPoint(score, "far");
			expect(score.points).toEqual({ near: 40, far: 40 });
		}
		expect(score.games).toEqual({ near: 0, far: 0 });
	});
});

describe("games within a set", () => {
	function playGames(
		score: ReturnType<typeof initialScore>,
		winners: readonly ("near" | "far")[],
	) {
		for (const winner of winners) {
			for (let i = 0; i < 4; i++) score = awardPoint(score, winner);
		}
		return score;
	}

	test("6-4 takes the set", () => {
		// Alternating until the last game, so the set is only decided there.
		let score = initialScore("near");
		score = playGames(score, [
			"near",
			"far",
			"near",
			"far",
			"near",
			"far",
			"near",
			"far",
			"near",
			"near",
		]);
		expect(score.games).toEqual({ near: 6, far: 4 });
		expect(score.setWinner).toBe("near");
	});

	test("6-5 does not take the set", () => {
		let score = initialScore("near");
		score = playGames(score, [
			"near",
			"far",
			"near",
			"far",
			"near",
			"far",
			"near",
			"far",
			"near",
			"far",
			"near",
		]);
		expect(score.games).toEqual({ near: 6, far: 5 });
		expect(score.setWinner).toBeNull();
	});

	test("7-5 takes the set", () => {
		// 5-5, then two straight.
		let score = initialScore("near");
		score = playGames(score, [
			"near",
			"far",
			"near",
			"far",
			"near",
			"far",
			"near",
			"far",
			"near",
			"far",
			"near",
			"near",
		]);
		expect(score.games).toEqual({ near: 7, far: 5 });
		expect(score.setWinner).toBe("near");
	});

	test("6-6 opens a tiebreak instead of playing on for a 2-game lead", () => {
		let score = initialScore("near");
		score = playGames(score, [
			"near",
			"far",
			"near",
			"far",
			"near",
			"far",
			"near",
			"far",
			"near",
			"far",
			"near",
			"far",
		]);
		expect(score.games).toEqual({ near: 6, far: 6 });
		expect(score.setWinner).toBeNull();
		expect(score.tiebreak).not.toBeNull();
	});
});

describe("tiebreak", () => {
	function reachTiebreak(server: "near" | "far") {
		let score = initialScore(server);
		const winners: readonly ("near" | "far")[] = [
			"near",
			"far",
			"near",
			"far",
			"near",
			"far",
			"near",
			"far",
			"near",
			"far",
			"near",
			"far",
		];
		for (const winner of winners) {
			for (let i = 0; i < 4; i++) score = awardPoint(score, winner);
		}
		return score;
	}

	test("first to 7, 2 clear, wins the tiebreak and the set is recorded 7-6", () => {
		let score = reachTiebreak("near");
		for (let i = 0; i < 7; i++) score = awardPoint(score, "near");
		expect(score.games).toEqual({ near: 7, far: 6 });
		expect(score.setWinner).toBe("near");
		expect(score.tiebreak).toBeNull();
	});

	test("6-6 in the tiebreak plays on; 8-6 wins it, set still recorded 7-6", () => {
		let score = reachTiebreak("near");
		for (let i = 0; i < 6; i++) score = awardPoint(score, "near");
		for (let i = 0; i < 6; i++) score = awardPoint(score, "far");
		expect(score.setWinner).toBeNull();
		score = awardPoint(score, "near");
		expect(score.setWinner).toBeNull(); // 7-6, not yet 2 clear
		expect(score.tiebreak?.points).toEqual({ near: 7, far: 6 });
		score = awardPoint(score, "near"); // 8-6, 2 clear
		expect(score.games).toEqual({ near: 7, far: 6 });
		expect(score.setWinner).toBe("near");
	});

	test("9-7 also wins it, once ahead by 2, set still recorded 7-6", () => {
		let score = reachTiebreak("near");
		for (let i = 0; i < 7; i++) {
			score = awardPoint(score, "near");
			score = awardPoint(score, "far");
		}
		expect(score.setWinner).toBeNull(); // 7-7
		score = awardPoint(score, "near");
		expect(score.setWinner).toBeNull(); // 8-7, not yet 2 clear
		score = awardPoint(score, "near"); // 9-7, 2 clear
		expect(score.games).toEqual({ near: 7, far: 6 });
		expect(score.setWinner).toBe("near");
	});

	test("serve rotation: one point, then alternates every two", () => {
		// The classic bug: the plan calls for an explicit table, points 1-13.
		const expectedServer: readonly ("near" | "far")[] = [
			"near", // 1
			"far", // 2
			"far", // 3
			"near", // 4
			"near", // 5
			"far", // 6
			"far", // 7
			"near", // 8
			"near", // 9
			"far", // 10
			"far", // 11
			"near", // 12
			"near", // 13
		];
		let score = reachTiebreak("near");
		expect(score.server).toBe("near");
		const actualServer: ("near" | "far")[] = [];
		for (let i = 0; i < expectedServer.length; i++) {
			actualServer.push(score.server);
			score = awardPoint(score, i % 2 === 0 ? "near" : "far");
		}
		expect(actualServer).toEqual(expectedServer);
	});
});
