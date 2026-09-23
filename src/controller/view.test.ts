import { describe, expect, it } from "vitest";
import type { MatchInfo, MatchScore } from "../shared/protocol.ts";
import { racketView } from "./view.ts";

const score = (over: Partial<MatchScore> = {}): MatchScore => ({
	games: { near: 2, far: 1 },
	points: { near: "30", far: "15" },
	serving: "near",
	ball: "hand",
	...over,
});
const playing = (s: MatchScore): MatchInfo => ({
	phase: "playing",
	server: "near",
	score: s,
});
const words = (v: ReturnType<typeof racketView>) =>
	v.headline.map((i) => i.text).join("");

describe("racketView", () => {
	it("says it is looking for the host before anything has arrived", () => {
		const v = racketView(null, null, 0);
		expect(v.caption).toMatch(/host/i);
		expect(v.serveBall).toBeNull();
	});

	it("is ready and waiting in the lobby", () => {
		const v = racketView({ phase: "lobby", server: "near" }, "far", 0);
		expect(words(v)).toBe("READY");
		expect(v.rim).toMatch(/FAR/);
	});

	it("counts the countdown down in whole seconds, never below 1", () => {
		const m: MatchInfo = { phase: "countdown", server: "near" };
		expect(words(racketView(m, "near", 0.2))).toBe("3");
		expect(words(racketView(m, "near", 1.1))).toBe("2");
		expect(words(racketView(m, "near", 2.9))).toBe("1");
		expect(words(racketView(m, "near", 9))).toBe("1");
	});

	// The one moment the racket must be right: whose serve it is, and what
	// the next swing will do.
	it("puts a ball on your strings and says toss when it is your serve", () => {
		const v = racketView(playing(score()), "near", 0);
		expect(words(v)).toBe("SERVE");
		expect(v.caption).toMatch(/toss/i);
		expect(v.serveBall).toBe("hand");
	});

	it("says hit it once the ball is up", () => {
		const v = racketView(playing(score({ ball: "toss" })), "near", 0);
		expect(words(v)).toBe("HIT");
		expect(v.serveBall).toBe("toss");
	});

	it("gets you ready to return when they serve, with no ball on your strings", () => {
		const v = racketView(playing(score({ serving: "far" })), "near", 0);
		expect(words(v)).toBe("RETURN");
		expect(v.serveBall).toBeNull();
	});

	// Your own score first, whichever end you are at.
	it("shows the score from your side during a rally", () => {
		const s = score({ ball: "play" });
		expect(
			racketView(playing(s), "near", 0).headline.map((i) => i.text),
		).toEqual(["30", " ", "15"]);
		expect(
			racketView(playing(s), "far", 0).headline.map((i) => i.text),
		).toEqual(["15", " ", "30"]);
		// And each number says whose it is.
		expect(
			racketView(playing(s), "far", 0).headline.map((i) => i.label ?? ""),
		).toEqual(["YOU", "", "THEM"]);
	});

	it("calls deuce and advantage in words", () => {
		const deuce = score({ ball: "play", points: { near: "40", far: "40" } });
		expect(words(racketView(playing(deuce), "near", 0))).toBe("DEUCE");
		const ad = score({ ball: "play", points: { near: "AD", far: "40" } });
		expect(racketView(playing(ad), "near", 0).caption).toMatch(/yours/i);
		expect(racketView(playing(ad), "far", 0).caption).toMatch(/theirs/i);
	});

	it("gives your games first", () => {
		expect(racketView(playing(score()), "near", 0).games).toEqual([2, 1]);
		expect(racketView(playing(score()), "far", 0).games).toEqual([1, 2]);
	});

	it("tells the winner they won and the other a good game", () => {
		const over = (winner: "near" | "far"): MatchInfo => ({
			phase: "over",
			server: "near",
			winner,
			score: score({ games: { near: 6, far: 4 } }),
		});
		expect(words(racketView(over("near"), "near", 0))).toBe("WIN");
		expect(racketView(over("near"), "near", 0).caption).toContain("6-4");
		expect(words(racketView(over("near"), "far", 0))).toBe("GG");
	});
});
