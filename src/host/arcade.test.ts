import { describe, expect, it } from "vitest";
import type { Side } from "../shared/protocol.ts";
import {
	createArcade,
	gradeOf,
	heatOf,
	LONG_RALLY,
	RALLY_MILESTONE,
	RECORD_WARMUP,
} from "./arcade.ts";
import type { PointHow, RenderEvent } from "./render/events.ts";

const hit = (
	side: Side,
	speed = 25,
	extra: Partial<Extract<RenderEvent, { kind: "hit" }>> = {},
): RenderEvent => ({
	kind: "hit",
	side,
	position: { x: 0, y: 1, z: side === "near" ? 11 : -11 },
	stroke: "forehand",
	power: 0.6,
	revised: false,
	speed,
	timing: 0,
	...extra,
});

const point = (winner: Side, how: PointHow): RenderEvent => ({
	kind: "point",
	winner,
	how,
});

const texts = (out: { callouts: readonly { text: string }[] }) =>
	out.callouts.map((c) => c.text);

describe("gradeOf", () => {
	it("grades timing from dead on to either edge of the window", () => {
		expect(gradeOf(0)).toBe("perfect");
		expect(gradeOf(0.1)).toBe("perfect");
		expect(gradeOf(-0.2)).toBe("great");
		expect(gradeOf(0.33)).toBe("good");
		expect(gradeOf(-0.6)).toBe("early");
		expect(gradeOf(0.6)).toBe("late");
	});
});

describe("heatOf", () => {
	it("rises with pace", () => {
		expect(heatOf(70)).toBe(0);
		expect(heatOf(100)).toBe(1);
		expect(heatOf(120)).toBe(2);
		expect(heatOf(140)).toBe(3);
	});
});

describe("createArcade", () => {
	it("pops the shot's speed in km/h, its grade and whether it was a power shot", () => {
		const arcade = createArcade();
		const { pops } = arcade.step([hit("near", 30, { power: 0.9 })]);
		expect(pops).toEqual([
			{
				side: "near",
				at: { x: 0, y: 1, z: 11 },
				kmh: 108,
				grade: "perfect",
				heat: 1,
				power: true,
				revised: false,
			},
		]);
	});

	it("counts the rally in strokes, not in re-struck balls, and resets it on a point", () => {
		const arcade = createArcade();
		arcade.step([hit("near"), hit("far"), hit("far", 26, { revised: true })]);
		expect(arcade.rally).toBe(2);
		arcade.step([point("far", "winner")]);
		expect(arcade.rally).toBe(0);
	});

	it("calls out rally milestones", () => {
		const arcade = createArcade();
		const calls: string[] = [];
		for (let i = 0; i < RALLY_MILESTONE * 2; i++) {
			calls.push(...texts(arcade.step([hit(i % 2 ? "far" : "near")])));
		}
		expect(calls).toEqual([
			`RALLY ×${RALLY_MILESTONE}`,
			`RALLY ×${RALLY_MILESTONE * 2}`,
		]);
	});

	it("calls out how the point was won and counts aces and winners", () => {
		const arcade = createArcade();
		expect(texts(arcade.step([hit("near"), point("near", "ace")]))).toEqual([
			"ACE!",
		]);
		expect(texts(arcade.step([hit("far"), point("far", "winner")]))).toEqual([
			"WINNER!",
		]);
		expect(texts(arcade.step([hit("far"), point("near", "out")]))).toEqual([
			"OUT",
		]);
		const stats = arcade.stats();
		expect(stats.near.aces).toBe(1);
		expect(stats.far.winners).toBe(1);
		expect(stats.near.winners).toBe(0);
	});

	it("sets a side on fire after three straight points and puts it out when the other side scores", () => {
		const arcade = createArcade();
		arcade.step([point("near", "net")]);
		arcade.step([point("near", "out")]);
		expect(arcade.onFire).toBeNull();
		expect(texts(arcade.step([point("near", "out")]))).toContain("ON FIRE!");
		expect(arcade.onFire).toBe("near");
		expect(texts(arcade.step([point("near", "out")]))).not.toContain(
			"ON FIRE!",
		);
		expect(texts(arcade.step([point("far", "out")]))).toContain(
			"STREAK BROKEN",
		);
		expect(arcade.onFire).toBeNull();
	});

	it("only calls a speed record once there is a record worth beating", () => {
		const arcade = createArcade();
		const calls: string[] = [];
		for (let i = 0; i < RECORD_WARMUP; i++) {
			calls.push(...texts(arcade.step([hit("near", 20 + i)])));
		}
		expect(calls.filter((t) => t.startsWith("FASTEST"))).toEqual([]);
		expect(texts(arcade.step([hit("far", 40)]))).toEqual([
			"FASTEST YET 144 KM/H",
		]);
	});

	it("keeps the session's records across matches but starts each match's stats afresh", () => {
		const arcade = createArcade();
		arcade.step([hit("near", 30), hit("far", 20), point("far", "winner")]);
		expect(arcade.stats().near.fastest).toBe(108);
		expect(arcade.stats().near.hits).toBe(1);
		arcade.newMatch();
		expect(arcade.stats().near.fastest).toBe(0);
		expect(arcade.stats().near.hits).toBe(0);
		expect(arcade.best.kmh).toBe(108);
	});

	it("calls a session-best rally once it is long enough to be one", () => {
		const arcade = createArcade();
		const rally = (n: number) => {
			const events: RenderEvent[] = [];
			for (let i = 0; i < n; i++) events.push(hit(i % 2 ? "far" : "near"));
			return texts(arcade.step([...events, point("near", "winner")]));
		};
		expect(rally(LONG_RALLY - 1)).not.toContain(`BEST RALLY ${LONG_RALLY - 1}`);
		expect(rally(LONG_RALLY)).toContain(`BEST RALLY ${LONG_RALLY}`);
		expect(rally(LONG_RALLY)).not.toContain(`BEST RALLY ${LONG_RALLY}`);
		expect(arcade.best.rally).toBe(LONG_RALLY);
	});

	it("counts perfect hits and the longest rally of the match", () => {
		const arcade = createArcade();
		arcade.step([
			hit("near", 25, { timing: 0.05 }),
			hit("far", 25, { timing: 0.3 }),
			hit("near", 25, { timing: -0.5 }),
			point("near", "winner"),
		]);
		arcade.step([hit("far", 25, { timing: 0.5 }), point("near", "out")]);
		const stats = arcade.stats();
		expect(stats.near.perfects).toBe(1);
		expect(stats.far.perfects).toBe(0);
		expect(stats.longestRally).toBe(3);
	});
});
