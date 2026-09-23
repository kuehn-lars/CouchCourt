import { describe, expect, it } from "vitest";
import {
	createMatch,
	type MatchState,
	type Stroke,
	tick,
} from "../../shared/sim/rally.ts";
import { TOSS_APEX } from "../../shared/sim/serve.ts";
import { BOUNCE_HEIGHT, detectEvents, strokeAnim } from "./events.ts";

const DT = 1 / 120;

const base = createMatch("near");
const state = (overrides: Partial<MatchState>): MatchState => ({
	...base,
	...overrides,
});

const stroke = (overrides: Partial<Stroke>): Stroke => ({
	side: "near",
	kind: "forehand",
	power: 0.6,
	air: false,
	at: 1,
	from: { x: 1, y: 1, z: 11 },
	timing: 0,
	...overrides,
});

describe("strokeAnim", () => {
	it("animates a serve as a serve", () => {
		expect(strokeAnim({ kind: "serve", air: false })).toBe("serve");
	});

	it("animates a groundstroke as the stroke it was", () => {
		expect(strokeAnim({ kind: "forehand", air: false })).toBe("forehand");
		expect(strokeAnim({ kind: "backhand", air: false })).toBe("backhand");
	});

	// A smash is the serve's overhead swing, jumped: the one stroke taken
	// off the ground, and the one a player should look like they launched.
	it("animates a smash as a jumping overhead, not as a serve", () => {
		expect(strokeAnim({ kind: "overhead", air: true })).toBe("smash");
	});

	it("animates anything else taken out of the air as a volley", () => {
		expect(strokeAnim({ kind: "backhand", air: true })).toBe("volley");
	});
});

describe("detectEvents", () => {
	it("reports nothing for a tick where nothing happened", () => {
		const s = state({ phase: "rally" });
		expect(detectEvents(s, s)).toEqual([]);
	});

	it("reports a hit at the contact point, with the stroke and who played it", () => {
		const before = state({ phase: "rally" });
		const after = state({
			phase: "rally",
			stroke: stroke({ kind: "backhand" }),
		});
		const [hit] = detectEvents(before, after);
		expect(hit).toEqual({
			kind: "hit",
			side: "near",
			position: { x: 1, y: 1, z: 11 },
			stroke: "backhand",
			power: 0.6,
			revised: false,
		});
	});

	// A harder peak re-struck the same ball: the ball jumps, but it is not
	// a second swing — no second animation, no second crack.
	it("reports a re-struck ball as revised, not as a new hit", () => {
		const first = stroke({ power: 0.3 });
		const before = state({ phase: "rally", stroke: first });
		const after = state({ phase: "rally", stroke: { ...first, power: 0.9 } });
		const [hit] = detectEvents(before, after);
		expect(hit?.kind === "hit" && hit.revised).toBe(true);
	});

	it("reports a whiff, as the stroke the player was set up for", () => {
		const contact = {
			side: "far" as const,
			ball: { x: 0, y: 1, z: -11 },
			at: 2,
			air: false,
			stroke: "backhand" as const,
		};
		const before = state({ phase: "rally", contact });
		const after = state({
			phase: "rally",
			contact,
			whiffs: { near: 0, far: 1 },
		});
		expect(detectEvents(before, after)).toEqual([
			{ kind: "whiff", side: "far", stroke: "backhand" },
		]);
	});

	it("reports the toss", () => {
		const s = createMatch("near");
		const tossed = tick(
			s,
			[
				{
					side: "near",
					swing: { kind: "forehand", power: 0.5, at: 0, lag: 0 },
					time: 0,
				},
			],
			DT,
		);
		expect(detectEvents(s, tossed)).toEqual([{ kind: "toss", side: "near" }]);
	});

	it("reports a bounce only when the ball is low and turning upward", () => {
		const falling = state({
			ball: { p: { x: 0, y: 0.1, z: 3 }, v: { x: 0, y: -4, z: 0 } },
		});
		const rising = state({
			ball: { p: { x: 0, y: 0.1, z: 3 }, v: { x: 0, y: 3, z: 0 } },
		});
		const risingHigh = state({
			ball: {
				p: { x: 0, y: BOUNCE_HEIGHT + 1, z: 3 },
				v: { x: 0, y: 3, z: 0 },
			},
		});
		expect(detectEvents(falling, rising).map((e) => e.kind)).toEqual([
			"bounce",
		]);
		expect(detectEvents(falling, risingHigh)).toEqual([]);
	});

	it("reports a point when the score object changes", () => {
		const before = state({});
		const after = { ...before, score: { ...before.score } };
		expect(after.score).not.toBe(before.score);
		expect(detectEvents(before, after)).toEqual([{ kind: "point" }]);
	});

	it("reports a serve hit from a real toss and serve through tick()", () => {
		const swing = { kind: "forehand" as const, power: 0.6, at: 0, lag: 0 };
		let s = tick(createMatch("near"), [{ side: "near", swing, time: 0 }], DT);
		while (s.time < TOSS_APEX) s = tick(s, [], DT);
		const served = tick(s, [{ side: "near", swing, time: s.time }], DT);
		const hit = detectEvents(s, served).find((e) => e.kind === "hit");
		expect(hit?.kind === "hit" && hit.stroke).toBe("serve");
	});
});
