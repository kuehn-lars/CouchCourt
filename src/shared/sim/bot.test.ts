import { describe, expect, it } from "vitest";
import type { Side, Swing } from "../protocol.ts";
import { createBot, SERVE_DELAY } from "./bot.ts";
import {
	createMatch,
	type MatchState,
	type RallyInput,
	tick,
} from "./rally.ts";
import { TOSS_APEX } from "./serve.ts";

const DT = 1 / 120;

/** Two bots, one match, `ticks` long. */
function play(ticks: number, near: number, far: number, server: Side = "near") {
	const bots = { near: createBot("near", near), far: createBot("far", far) };
	let s: MatchState = createMatch(server);
	const swings: { side: Side; time: number; swing: Swing }[] = [];
	let hits = 0;
	for (let i = 0; i < ticks; i++) {
		const inputs: RallyInput[] = [];
		for (const side of ["near", "far"] as const) {
			const sw = bots[side].swing(s);
			if (sw) {
				inputs.push({ side, swing: sw, time: s.time });
				swings.push({ side, time: s.time, swing: sw });
			}
		}
		const next = tick(s, inputs, DT);
		if (next.stroke && next.stroke.at !== s.stroke?.at) hits++;
		s = next;
	}
	return { final: s, swings, hits };
}

describe("createBot", () => {
	it("never swings for the side it is not playing", () => {
		expect(createBot("far", 1).swing(createMatch("near"))).toBeNull();
	});

	it("waits before tossing, then hits the toss at the top", () => {
		const { swings } = play(Math.ceil((SERVE_DELAY + 1) / DT), 1, 1, "far");
		const [toss, hit] = swings.filter((s) => s.side === "far");
		expect(toss?.time).toBeGreaterThanOrEqual(SERVE_DELAY);
		expect(toss?.time).toBeLessThan(SERVE_DELAY + 0.05);
		expect((hit?.time ?? 0) - (toss?.time ?? 0)).toBeCloseTo(TOSS_APEX, 1);
	});

	it("swings once per ball, not once per tick", () => {
		const { swings, hits } = play(120 * 20, 0.9, 0.9);
		// Two swings per serve (toss, hit), one per return, and a few that
		// missed. Never dozens.
		expect(swings.length).toBeLessThan(hits * 2 + 10);
	});

	it("returns a serve", () => {
		const { hits } = play(120 * 6, 0.9, 0.9, "far");
		expect(hits).toBeGreaterThanOrEqual(2);
	});

	it("wins more points the higher its skill", () => {
		const { final } = play(120 * 60 * 3, 0.95, 0.5);
		expect(final.score.games.near).toBeGreaterThan(final.score.games.far);
	});

	it("is deterministic — the same match twice gives the same swings", () => {
		const run = () => JSON.stringify(play(120 * 30, 0.7, 0.7).swings);
		expect(run()).toBe(run());
	});
});
