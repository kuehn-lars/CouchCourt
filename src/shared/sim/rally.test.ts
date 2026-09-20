import { describe, expect, it } from "vitest";
import type { Side, Swing } from "../protocol.ts";
import { BALL_RADIUS } from "./court.ts";
import {
	createMatch,
	type MatchState,
	type RallyInput,
	tick,
} from "./rally.ts";
import type { Ball } from "./state.ts";

const DT = 1 / 120;

const swing = (kind: Swing["kind"], power: number): Swing => ({
	kind,
	power,
	at: 0,
});

/** A `MatchState` for a test, built from a fresh match and overridden. */
function state(overrides: Partial<MatchState>): MatchState {
	return { ...createMatch("near"), ...overrides };
}

const still = (p: Ball["p"]): Ball => ({ p, v: { x: 0, y: -0.6, z: 0 } });

/** Ticks `s` forward, feeding `inputsAt` inputs on the tick they name, until
 * `stop` says so or `limit` ticks pass. */
function drive(
	s: MatchState,
	stop: (s: MatchState) => boolean,
	inputsAt: ReadonlyMap<number, readonly RallyInput[]> = new Map(),
	limit = 3000,
): MatchState {
	let current = s;
	for (let i = 0; i < limit; i++) {
		if (stop(current)) return current;
		current = tick(current, inputsAt.get(i) ?? [], DT);
	}
	return current;
}

describe("createMatch", () => {
	it("starts waiting for the named server to serve", () => {
		const s = createMatch("far");
		expect(s.phase).toBe("waiting-serve");
		expect(s.toHit).toBe("far");
		expect(s.serveNumber).toBe(1);
		expect(s.score.server).toBe("far");
		expect(s.ball.v).toEqual({ x: 0, y: 0, z: 0 });
	});
});

describe("input handling", () => {
	it("ignores a swing from the side that is not up", () => {
		const s = state({ phase: "rally", toHit: "far", bounces: 0 });
		const input: RallyInput = {
			side: "near",
			swing: swing("forehand", 1),
			time: 0,
		};
		const next = tick(s, [input], DT);

		// Only physics advanced the ball; the swing had no effect.
		expect(next.toHit).toBe("far");
		const physicsOnly = tick(s, [], DT);
		expect(next.ball).toEqual(physicsOnly.ball);
	});

	it("a wildly mistimed swing does not touch the ball", () => {
		// Heading toward `near`'s baseline (+BASELINE_Z) but nowhere near it yet.
		const ball: Ball = { p: { x: 0, y: 1.5, z: 3 }, v: { x: 0, y: 2, z: 5 } };
		const s = state({
			phase: "rally",
			toHit: "near",
			bounces: 0,
			ball,
			time: 0,
		});
		// The ball is nowhere near `near`'s baseline yet, so swinging "now" is
		// far outside the miss window against the predicted crossing.
		const input: RallyInput = {
			side: "near",
			swing: swing("forehand", 1),
			time: 0,
		};
		const next = tick(s, [input], DT);
		const control = tick(s, [], DT);

		expect(next.ball).toEqual(control.ball);
		expect(next.toHit).toBe("near");
	});
});

describe("terminal conditions", () => {
	it("awards the point to the receiver when the hitter's shot lands out", () => {
		const s = state({
			phase: "rally",
			toHit: "far",
			bounces: 0,
			ball: still({ x: 10, y: BALL_RADIUS + 0.005, z: -5 }),
		});
		const next = tick(s, [], DT);

		expect(next.phase).toBe("point-over");
		expect(next.score.points.far).toBe(15);
		expect(next.score.points.near).toBe(0);
	});

	it("awards the point to the hitter when the receiver lets it bounce twice", () => {
		const s = state({
			phase: "rally",
			toHit: "far",
			bounces: 1,
			ball: still({ x: 0, y: BALL_RADIUS + 0.005, z: -5 }),
		});
		const next = tick(s, [], DT);

		expect(next.phase).toBe("point-over");
		expect(next.score.points.near).toBe(15);
		expect(next.score.points.far).toBe(0);
	});

	it("awards the point to the receiver when the hitter puts it in the net", () => {
		// Same fixture ball.test.ts proves nets: below the band, closing fast.
		const s = state({
			phase: "rally",
			toHit: "far",
			bounces: 0,
			ball: { p: { x: 0, y: 0.4, z: 0.2 }, v: { x: 0, y: 0, z: -30 } },
		});
		const next = tick(s, [], DT);

		expect(next.phase).toBe("point-over");
		expect(next.score.points.far).toBe(15);
	});
});

describe("serve faults", () => {
	it("a serve past the service line is a fault, not a lost point, even though it lands inside the court", () => {
		const s = createMatch("near");
		const hit = tick(
			s,
			[{ side: "near", swing: swing("serve", 0.55), time: 0 }],
			DT,
		);
		const resolved = drive(hit, (st) => st.phase !== "serve-flight");

		expect(resolved.phase).toBe("waiting-serve");
		expect(resolved.serveNumber).toBe(2);
		expect(resolved.toHit).toBe("near");
		expect(resolved.score.points.near).toBe(0);
		expect(resolved.score.points.far).toBe(0);
	});

	it("a serve blocked by the net is also a fault", () => {
		const s = createMatch("near");
		const hit = tick(
			s,
			[{ side: "near", swing: swing("serve", 0.15), time: 0 }],
			DT,
		);
		const resolved = drive(hit, (st) => st.phase !== "serve-flight");

		expect(resolved.phase).toBe("waiting-serve");
		expect(resolved.serveNumber).toBe(2);
	});

	it("a second serve fault is a double fault: the receiver wins the point", () => {
		const s = createMatch("near");
		const firstFault = drive(
			tick(s, [{ side: "near", swing: swing("serve", 0.55), time: 0 }], DT),
			(st) => st.phase !== "serve-flight",
		);
		expect(firstFault.serveNumber).toBe(2);

		const secondHit = tick(
			firstFault,
			[{ side: "near", swing: swing("serve", 0.55), time: firstFault.time }],
			DT,
		);
		const resolved = drive(secondHit, (st) => st.phase !== "serve-flight");

		expect(resolved.phase).toBe("point-over");
		expect(resolved.score.points.far).toBe(15);
		expect(resolved.score.points.near).toBe(0);
	});

	it("a serve landing legally in the box starts a rally, not a fault", () => {
		const s = createMatch("near");
		const hit = tick(
			s,
			[{ side: "near", swing: swing("serve", 0.35), time: 0 }],
			DT,
		);
		const resolved = drive(hit, (st) => st.phase !== "serve-flight");

		expect(resolved.phase).toBe("rally");
		expect(resolved.serveNumber).toBe(1);
		expect(resolved.toHit).toBe("far");
	});
});

describe("match over", () => {
	it("freezes once the set has a winner: tick is a no-op", () => {
		const s = state({
			phase: "point-over",
			score: { ...createMatch("near").score, setWinner: "near" },
			ball: { p: { x: 1, y: 2, z: 3 }, v: { x: 4, y: 5, z: 6 } },
		});
		const next = tick(
			s,
			[{ side: "near", swing: swing("serve", 1), time: 0 }],
			DT,
		);

		expect(next).toEqual(s);
	});
});

describe("determinism", () => {
	it("the same match, run twice, produces identical states throughout", () => {
		const script: ReadonlyMap<number, readonly RallyInput[]> = new Map([
			[0, [{ side: "near", swing: swing("serve", 0.35), time: 0 }]],
		]);
		const run = () =>
			JSON.stringify(
				drive(
					createMatch("near"),
					(st) => st.phase === "point-over",
					script,
					1000,
				),
			);

		expect(run()).toBe(run());
	});
});

describe("a full set, replayed", () => {
	/**
	 * Discovered empirically (a throwaway driver logging its own decisions,
	 * per the session log), not hand-guessed. A receiver *can* return a legal
	 * serve in this sim (`llm-knowledge/experiments/2026-09-20-serve-reachability-recheck.md`)
	 * — this script simply doesn't attempt one, to keep the replay small and
	 * deterministic: `near`'s serve at power 0.35 lands legally and is never
	 * swung at, so it stands as an unreturned point; `far`'s serve at 0.55
	 * clears the net but lands past the service line every time (a fault, not
	 * a lost point) — so `near` wins outright and `far` double-faults every
	 * service game.
	 *
	 * `{tick, side, swing}`, per the plan. No one swings at a return here —
	 * that path is covered by the smaller terminal-condition tests above.
	 */
	const NEAR_ACE = swing("serve", 0.35);
	const FAR_FAULT = swing("serve", 0.55);
	const script: readonly { tick: number; side: Side; swing: Swing }[] = [
		{ tick: 0, side: "near", swing: NEAR_ACE },
		{ tick: 190, side: "near", swing: NEAR_ACE },
		{ tick: 380, side: "near", swing: NEAR_ACE },
		{ tick: 570, side: "near", swing: NEAR_ACE },
		{ tick: 760, side: "far", swing: FAR_FAULT },
		{ tick: 868, side: "far", swing: FAR_FAULT },
		{ tick: 977, side: "far", swing: FAR_FAULT },
		{ tick: 1085, side: "far", swing: FAR_FAULT },
		{ tick: 1194, side: "far", swing: FAR_FAULT },
		{ tick: 1302, side: "far", swing: FAR_FAULT },
		{ tick: 1411, side: "far", swing: FAR_FAULT },
		{ tick: 1519, side: "far", swing: FAR_FAULT },
		{ tick: 1628, side: "near", swing: NEAR_ACE },
		{ tick: 1818, side: "near", swing: NEAR_ACE },
		{ tick: 2008, side: "near", swing: NEAR_ACE },
		{ tick: 2198, side: "near", swing: NEAR_ACE },
		{ tick: 2388, side: "far", swing: FAR_FAULT },
		{ tick: 2496, side: "far", swing: FAR_FAULT },
		{ tick: 2605, side: "far", swing: FAR_FAULT },
		{ tick: 2713, side: "far", swing: FAR_FAULT },
		{ tick: 2822, side: "far", swing: FAR_FAULT },
		{ tick: 2930, side: "far", swing: FAR_FAULT },
		{ tick: 3039, side: "far", swing: FAR_FAULT },
		{ tick: 3147, side: "far", swing: FAR_FAULT },
		{ tick: 3256, side: "near", swing: NEAR_ACE },
		{ tick: 3446, side: "near", swing: NEAR_ACE },
		{ tick: 3636, side: "near", swing: NEAR_ACE },
		{ tick: 3826, side: "near", swing: NEAR_ACE },
		{ tick: 4016, side: "far", swing: FAR_FAULT },
		{ tick: 4124, side: "far", swing: FAR_FAULT },
		{ tick: 4233, side: "far", swing: FAR_FAULT },
		{ tick: 4341, side: "far", swing: FAR_FAULT },
		{ tick: 4450, side: "far", swing: FAR_FAULT },
		{ tick: 4558, side: "far", swing: FAR_FAULT },
		{ tick: 4667, side: "far", swing: FAR_FAULT },
		{ tick: 4775, side: "far", swing: FAR_FAULT },
	];

	function runScript(): MatchState {
		const inputsAt = new Map<number, RallyInput[]>();
		for (const { tick: t, side, swing: sw } of script) {
			inputsAt.set(t, [{ side, swing: sw, time: t * DT }]);
		}
		return drive(
			createMatch("near"),
			(st) => st.score.setWinner !== null,
			inputsAt,
			6000,
		);
	}

	it("reaches a completed set with the expected score", () => {
		const final = runScript();

		expect(final.score.setWinner).toBe("near");
		expect(final.score.games).toEqual({ near: 6, far: 0 });
		expect(final.score.points).toEqual({ near: 0, far: 0 });
	});

	it("is the same run twice", () => {
		const run = () => JSON.stringify(runScript());
		expect(run()).toBe(run());
	});
});
