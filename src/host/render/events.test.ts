import { describe, expect, it } from "vitest";
import { createMatch, type MatchState, tick } from "../../shared/sim/rally.ts";
import { BOUNCE_HEIGHT, detectEvents, strokeAnim } from "./events.ts";

const state = (overrides: Partial<MatchState>): MatchState => ({
	...createMatch("near"),
	...overrides,
});

const hitOf = (events: ReturnType<typeof detectEvents>) =>
	events.find((e) => e.kind === "hit");

describe("strokeAnim", () => {
	it("animates a serve as a serve, bounce or no bounce", () => {
		expect(
			strokeAnim({ side: "near", kind: "serve", power: 1, air: false }),
		).toBe("serve");
		expect(
			strokeAnim({ side: "near", kind: "serve", power: 1, air: true }),
		).toBe("serve");
	});

	it("animates a groundstroke as the stroke it was", () => {
		expect(
			strokeAnim({ side: "near", kind: "forehand", power: 1, air: false }),
		).toBe("forehand");
		expect(
			strokeAnim({ side: "far", kind: "backhand", power: 1, air: false }),
		).toBe("backhand");
	});

	// A ball blocked back before it bounced is a volley whichever side of the
	// body it came off, and it looks nothing like a full groundstroke.
	it("animates anything taken out of the air as a volley", () => {
		expect(
			strokeAnim({ side: "near", kind: "forehand", power: 1, air: true }),
		).toBe("volley");
		expect(
			strokeAnim({ side: "near", kind: "backhand", power: 1, air: true }),
		).toBe("volley");
	});
});

describe("detectEvents", () => {
	it("reports nothing at all for a tick where nothing happened", () => {
		const s = state({ phase: "rally" });
		expect(detectEvents(s, s)).toEqual([]);
	});

	it("reports a hit, carrying the stroke to animate and who played it", () => {
		const before = state({ phase: "rally", toHit: "near" });
		const after = state({
			phase: "rally",
			toHit: "far",
			stroke: { side: "near", kind: "backhand", power: 0.6, air: false },
		});

		const hit = hitOf(detectEvents(before, after));
		expect(hit?.side).toBe("near");
		expect(hit?.stroke).toBe("backhand");
		expect(hit?.power).toBe(0.6);
	});

	// `toHit` also flips at the start of a point, when nothing was struck.
	// Animating a swing there is an avatar swiping at thin air.
	it("does not report a hit when nothing is in flight", () => {
		const before = state({ phase: "rally", toHit: "near" });
		const after = state({ phase: "rally", toHit: "far", stroke: null });

		expect(hitOf(detectEvents(before, after))).toBeUndefined();
	});

	it("reports a bounce only when the ball is low and turning upward", () => {
		const falling = state({
			ball: {
				p: { x: 0, y: BOUNCE_HEIGHT / 2, z: 0 },
				v: { x: 0, y: -4, z: 0 },
			},
		});
		const rising = state({
			ball: {
				p: { x: 0, y: BOUNCE_HEIGHT / 2, z: 0 },
				v: { x: 0, y: 3, z: 0 },
			},
		});
		const risingHigh = state({
			ball: {
				p: { x: 0, y: BOUNCE_HEIGHT + 1, z: 0 },
				v: { x: 0, y: 3, z: 0 },
			},
		});

		expect(detectEvents(falling, rising).map((e) => e.kind)).toContain(
			"bounce",
		);
		expect(detectEvents(falling, risingHigh).map((e) => e.kind)).not.toContain(
			"bounce",
		);
	});

	it("reports a point when the score object changes", () => {
		const before = state({});
		const after = state({ score: { ...before.score } });

		expect(detectEvents(before, after).map((e) => e.kind)).toContain("point");
	});

	// Driven through the real sim rather than hand-built states, so the event
	// stream cannot drift away from what `tick` actually does.
	it("reports a serve hit from a real serve through tick()", () => {
		const before = createMatch("near");
		const after = tick(
			before,
			[
				{
					side: "near",
					swing: { kind: "forehand", power: 0.6, at: 0, lag: 0 },
					time: 0,
				},
			],
			1 / 120,
		);

		expect(hitOf(detectEvents(before, after))?.stroke).toBe("serve");
	});
});
