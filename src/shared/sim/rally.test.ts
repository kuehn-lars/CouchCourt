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

/**
 * Serve fixtures, re-derived 2026-09-20 when `SERVE_ANGLE_SLOW/FAST` made a
 * flat serve land in the box at **every** power. The old fixtures were bare
 * powers (0.55 long, 0.15 netted) and they stopped being faults the moment
 * the serve was aimed properly — a fixture that encodes a bug is a fixture
 * that dies with the bug.
 *
 * Spin is what makes a serve missable now, so these name it. Found with a
 * throwaway driver over the (power, spin) grid, not guessed:
 * `llm-knowledge/experiments/2026-09-20-serve-that-lands.md`.
 */
/** Floats long: lands in the court, past the service line. */
const LONG_SERVE: Swing = { kind: "serve", power: 0.6, at: 0, spin: -1 };
/** Dips into the band. */
const NETTED_SERVE: Swing = { kind: "serve", power: 1, at: 0, spin: 1 };
/** Lands in the box at any power, which is now what flat means. */
const GOOD_SERVE: Swing = { kind: "serve", power: 0.6, at: 0, spin: 0 };

describe("serve faults", () => {
	it("a serve past the service line is a fault, not a lost point, even though it lands inside the court", () => {
		const s = createMatch("near");
		const hit = tick(s, [{ side: "near", swing: LONG_SERVE, time: 0 }], DT);
		const resolved = drive(hit, (st) => st.phase !== "serve-flight");

		expect(resolved.phase).toBe("waiting-serve");
		expect(resolved.serveNumber).toBe(2);
		expect(resolved.toHit).toBe("near");
		expect(resolved.score.points.near).toBe(0);
		expect(resolved.score.points.far).toBe(0);
	});

	it("a serve blocked by the net is also a fault", () => {
		const s = createMatch("near");
		const hit = tick(s, [{ side: "near", swing: NETTED_SERVE, time: 0 }], DT);
		const resolved = drive(hit, (st) => st.phase !== "serve-flight");

		expect(resolved.phase).toBe("waiting-serve");
		expect(resolved.serveNumber).toBe(2);
	});

	it("a second serve fault is a double fault: the receiver wins the point", () => {
		const s = createMatch("near");
		const firstFault = drive(
			tick(s, [{ side: "near", swing: LONG_SERVE, time: 0 }], DT),
			(st) => st.phase !== "serve-flight",
		);
		expect(firstFault.serveNumber).toBe(2);

		const secondHit = tick(
			firstFault,
			[{ side: "near", swing: LONG_SERVE, time: firstFault.time }],
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
	 * The determinism regression net: the same inputs must always produce the
	 * same set. Every shot-feel constant is guarded by this.
	 *
	 * **Self-timing since 2026-09-20.** It used to be 36 hardcoded
	 * `{tick, side, swing}` rows, derived by a throwaway driver from how long
	 * each point happened to take. Re-tuning the serve moved every one of
	 * those ticks and the script silently stopped serving into the right
	 * phases — 36 magic numbers that encode nothing but yesterday's flight
	 * times. Serving whenever the state says `waiting-serve` is just as
	 * deterministic and survives the next tuning pass.
	 *
	 * `near` serves flat (in, and never swung at, so the point is theirs on
	 * the second bounce); `far` slices (long, twice, every time). So `near`
	 * takes the set 6-0 without a single return being attempted — the return
	 * path is covered by the smaller terminal-condition tests above.
	 */
	function playSet(): MatchState {
		let current = createMatch("near");
		for (let i = 0; i < 20_000; i++) {
			if (current.score.setWinner) return current;
			const inputs: RallyInput[] =
				current.phase === "waiting-serve"
					? [
							{
								side: current.toHit,
								swing: current.toHit === "near" ? GOOD_SERVE : LONG_SERVE,
								time: current.time,
							},
						]
					: [];
			current = tick(current, inputs, DT);
		}
		throw new Error("the set never finished");
	}

	it("reaches a completed set with the expected score", () => {
		const final = playSet();

		expect(final.score.setWinner).toBe("near");
		expect(final.score.games).toEqual({ near: 6, far: 0 });
		expect(final.score.points).toEqual({ near: 0, far: 0 });
	});

	it("is the same run twice", () => {
		const run = () => JSON.stringify(playSet());
		expect(run()).toBe(run());
	});
});

describe("spin", () => {
	/**
	 * How deep a serve of this spin flies before the court (or the net, or
	 * the line judge) stops it: the ball's `z` on the last tick it is still
	 * in flight.
	 *
	 * Reading the flight's end rather than `bounces` on purpose — a serve
	 * that lands long is a fault, and `fault()` resets the ball before
	 * anything can look at where it went. The whole point here is to compare
	 * a legal landing with an illegal one.
	 */
	function landingZ(spin: number): number {
		let cur = tick(
			createMatch("near"),
			[
				{
					side: "near",
					swing: { kind: "serve", power: 0.6, at: 0, spin },
					time: 0,
				},
			],
			DT,
		);
		for (let i = 0; i < 3000; i++) {
			const next = tick(cur, [], DT);
			if (next.phase !== "serve-flight") return cur.ball.p.z;
			cur = next;
		}
		throw new Error(`serve with spin ${spin} never came down`);
	}

	it("makes topspin land shorter than flat, and slice longer", () => {
		const top = landingZ(1);
		const flat = landingZ(0);
		const slice = landingZ(-1);

		// The server is `near`, hitting toward -z: shorter means closer to the
		// net, which is a LARGER (less negative) z.
		expect(top).toBeGreaterThan(flat);
		expect(flat).toBeGreaterThan(slice);
		// And it is a difference a player would see, not a rounding artefact.
		expect(top - slice).toBeGreaterThan(0.5);
	});

	it("carries the spin of the shot in flight, and clears it on a new point", () => {
		const served = tick(
			createMatch("near"),
			[
				{
					side: "near",
					swing: { kind: "serve", power: 0.5, at: 0, spin: 0.75 },
					time: 0,
				},
			],
			DT,
		);
		expect(served.spin).toBeCloseTo(0.75, 6);
		expect(createMatch("near").spin).toBe(0);
	});

	it("treats a swing with no spin field as flat", () => {
		const served = tick(
			createMatch("near"),
			[{ side: "near", swing: swing("serve", 0.5), time: 0 }],
			DT,
		);
		expect(served.spin).toBe(0);
	});
});
