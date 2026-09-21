import { describe, expect, it } from "vitest";
import type { Swing } from "../protocol.ts";
import { createBot, SERVE_DELAY } from "./bot.ts";

import { predictStrike } from "./players.ts";
import {
	createMatch,
	envFor,
	type MatchState,
	type RallyInput,
	tick,
} from "./rally.ts";
import { MISS_WINDOW } from "./shot.ts";

const DT = 1 / 120;

const GOOD_SERVE: Swing = { kind: "serve", power: 0.6, at: 0, spin: 0 };

/** Ticks a match forward with a bot playing `far`, and an optional scripted
 * input from `near` on tick `nearSwingsAt`. */
function play(
	ticks: number,
	skill: number,
	nearSwing?: { at: number; swing: Swing },
): MatchState[] {
	const bot = createBot("far", skill);
	const history: MatchState[] = [];
	let current = createMatch("near");
	for (let i = 0; i < ticks; i++) {
		const inputs: RallyInput[] = [];
		if (nearSwing && i === nearSwing.at) {
			inputs.push({ side: "near", swing: nearSwing.swing, time: current.time });
		}
		const botSwing = bot.swing(current);
		if (botSwing) {
			inputs.push({ side: "far", swing: botSwing, time: current.time });
		}
		current = tick(current, inputs, DT);
		history.push(current);
	}
	return history;
}

describe("createBot", () => {
	it("never swings for the side it is not playing", () => {
		const bot = createBot("far", 1);
		// `near` is serving: the far bot has no business swinging.
		expect(bot.swing(createMatch("near"))).toBeNull();
	});

	it("serves, but not instantly — a bot that serves on frame one is a bug that looks like lag", () => {
		const bot = createBot("far", 1);
		let current = createMatch("far");
		let served: Swing | null = null;
		let servedAt = 0;
		for (let i = 0; i < 600 && !served; i++) {
			served = bot.swing(current);
			if (served) servedAt = current.time;
			current = tick(current, [], DT);
		}
		expect(served?.kind).toBe("serve");
		expect(servedAt).toBeGreaterThanOrEqual(SERVE_DELAY);
		expect(servedAt).toBeLessThan(SERVE_DELAY + 0.1);
	});

	it("returns a serve back over the net", () => {
		const history = play(900, 1, { at: 0, swing: GOOD_SERVE });
		// The bot hit it: the ball crossed back to the near half at speed.
		const returned = history.some((s) => s.ball.p.z > 1 && s.ball.v.z > 0);
		expect(returned).toBe(true);
	});

	/**
	 * Two bots, one match. The near bot is always perfect, so the only thing
	 * that differs between runs is the far bot's skill — and the thing being
	 * measured is whether skill shows up in the score at all.
	 *
	 * An earlier version of this test asserted "a skill-0 bot cannot return a
	 * serve", and it passed with the skill parameter deleted entirely: the
	 * hopeless bot was failing to clear the net on POWER, not on timing, and
	 * the test could not tell the difference. Watched passing against the
	 * mutant, which is the only reason it was rewritten.
	 */
	function duel(
		farSkill: number,
		ticks = 20_000,
	): { hits: number; won: number } {
		const near = createBot("near", 1);
		const far = createBot("far", farSkill);
		let current = createMatch("near");
		let hits = 0;
		let won = 0;
		for (let i = 0; i < ticks && !current.score.setWinner; i++) {
			const inputs: RallyInput[] = [];
			const a = near.swing(current);
			if (a) inputs.push({ side: "near", swing: a, time: current.time });
			const b = far.swing(current);
			if (b) inputs.push({ side: "far", swing: b, time: current.time });
			const next = tick(current, inputs, DT);
			if (next.toHit !== current.toHit) hits += 1;
			if (
				next.score !== current.score &&
				next.score.points.near <= current.score.points.near &&
				next.score.games.near === current.score.games.near
			) {
				won += 1;
			}
			current = next;
		}
		return { hits, won };
	}

	// Measures points the far bot WINS, not how many points happen. The
	// original counted every score change, which read backwards the moment
	// the hopeless bot started losing sets outright: it lost 6-0 in 28 points
	// and stopped, while the perfect bot was still at 6-6 after 55. A
	// completed set is fewer score changes, not more.
	it("wins more points the higher its skill", () => {
		expect(duel(1).won).toBeGreaterThan(duel(0).won);
	});

	it("sustains a rally rather than trading one shot per point", () => {
		// A solo mode where every point is serve-then-over is not a game.
		// Two perfect bots keep the ball alive indefinitely — 273 hits and
		// not a single point in 40,000 ticks when this was written, which is
		// also why `points` above is the skill measure and `games` is not.
		expect(duel(1).hits).toBeGreaterThan(50);
	});

	it("times its swing by skill: perfect meets the ball, hopeless does not", () => {
		// The ideal contact moment is fixed the instant the serve is struck:
		// `time + predictStrike(...).t`. What the bot does with it is the
		// whole of `skill`.
		//
		// This is the assertion that catches skill being disconnected from
		// timing. `concedes more points` does not: it survives with the
		// timing term deleted, because a low-skill bot also swings softer.
		const timingError = (skill: number): number => {
			const bot = createBot("far", skill);
			let current = tick(
				createMatch("near"),
				[{ side: "near", swing: GOOD_SERVE, time: 0 }],
				DT,
			);
			// The same prediction the bot plans against: where and when it
			// will actually meet the ball, not a fixed baseline plane it may
			// have left.
			const ideal =
				current.time +
				predictStrike(current.ball, envFor(current), "far", current.players.far)
					.t;

			for (let i = 0; i < 900; i++) {
				if (bot.swing(current) !== null) return current.time - ideal;
				current = tick(current, [], DT);
			}
			throw new Error(`bot at skill ${skill} never swung`);
		};

		expect(Math.abs(timingError(1))).toBeLessThan(0.02);
		expect(Math.abs(timingError(0))).toBeGreaterThan(MISS_WINDOW);
	});

	it("is deterministic — the same match twice gives the same swings", () => {
		const once = JSON.stringify(play(900, 0.75, { at: 0, swing: GOOD_SERVE }));
		const twice = JSON.stringify(play(900, 0.75, { at: 0, swing: GOOD_SERVE }));
		expect(once).toBe(twice);
	});
});
