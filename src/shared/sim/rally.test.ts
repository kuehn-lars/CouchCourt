import { describe, expect, it } from "vitest";
import type { Side, Swing } from "../protocol.ts";
import { createBot } from "./bot.ts";
import { BALL_RADIUS, BASELINE_Z, isInServiceBox } from "./court.ts";
import {
	createMatch,
	type MatchState,
	type RallyInput,
	tick,
} from "./rally.ts";
import { TOSS_APEX, TOSS_MIN_HIT } from "./serve.ts";
import { TIMING_EARLY, TIMING_IDEAL, TIMING_LATE } from "./shot.ts";
import type { Ball } from "./state.ts";

const DT = 1 / 120;

const swing = (power: number, lag = 0, spin = 0): Swing => ({
	kind: "forehand",
	power,
	at: 0,
	lag,
	spin,
});

const input = (side: Side, s: MatchState, sw: Swing): RallyInput => ({
	side,
	swing: sw,
	time: s.time,
});

/** A `MatchState` for a test, built from a fresh match and overridden. */
function state(overrides: Partial<MatchState>): MatchState {
	return { ...createMatch("near"), ...overrides };
}

const still = (p: Ball["p"]): Ball => ({ p, v: { x: 0, y: -0.6, z: 0 } });

function until(
	s: MatchState,
	stop: (s: MatchState) => boolean,
	limit = 3000,
): MatchState {
	let current = s;
	for (let i = 0; i < limit && !stop(current); i++) {
		current = tick(current, [], DT);
	}
	if (!stop(current)) throw new Error("never happened");
	return current;
}

/** Tosses, waits for the top of the toss, and hits it. */
function serve(s: MatchState, power = 0.6, spin = 0): MatchState {
	const server = s.toHit;
	const tossed = tick(s, [input(server, s, swing(0.5))], DT);
	const top = until(tossed, (x) => x.time >= tossed.time - DT + TOSS_APEX);
	return tick(top, [input(server, top, swing(power, 0, spin))], DT);
}

/** `far` serves to `near`; returns the state once near's contact is fixed:
 * the serve has bounced in near's box and near is waiting on it. */
function awaitingReturn(): MatchState {
	const served = serve(createMatch("far"));
	return until(
		served,
		(x) => x.phase === "rally" && x.bounces === 1 && x.contact !== null,
	);
}

describe("createMatch", () => {
	it("starts waiting for the named server, ball in hand", () => {
		const s = createMatch("far");
		expect(s.phase).toBe("waiting-serve");
		expect(s.toHit).toBe("far");
		expect(s.toss).toBeNull();
		expect(s.ball.v).toEqual({ x: 0, y: 0, z: 0 });
	});
});

// Wii Tennis: one swing tosses the ball, the next one hits it.
describe("the serve", () => {
	it("tosses on the first swing and does not serve yet", () => {
		const s = createMatch("near");
		const after = tick(s, [input("near", s, swing(0.6))], DT);
		expect(after.phase).toBe("waiting-serve");
		expect(after.toss).not.toBeNull();
		expect(after.ball.v.y).toBeGreaterThan(0);
	});

	it("serves on the second swing, into the box", () => {
		const served = serve(createMatch("near"));
		expect(served.phase).toBe("serve-flight");
		expect(served.toHit).toBe("far");
		expect(served.stroke?.kind).toBe("serve");
		const landed = until(
			served,
			(x) => x.bounces > 0 || x.phase !== "serve-flight",
		);
		expect(landed.phase).toBe("rally");
		expect(isInServiceBox(landed.ball.p.x, landed.ball.p.z, "far")).toBe(true);
	});

	it("ignores a swing right after the toss — that is the toss's own tail", () => {
		const s = createMatch("near");
		const tossed = tick(s, [input("near", s, swing(0.6))], DT);
		const soon = until(tossed, (x) => x.time >= tossed.time + TOSS_MIN_HIT / 2);
		const after = tick(soon, [input("near", soon, swing(0.9))], DT);
		expect(after.phase).toBe("waiting-serve");
	});

	it("catches a toss nobody hits, without a fault", () => {
		const s = createMatch("near");
		const tossed = tick(s, [input("near", s, swing(0.6))], DT);
		const caught = until(tossed, (x) => x.toss === null);
		expect(caught.phase).toBe("waiting-serve");
		expect(caught.serveNumber).toBe(1);
		expect(caught.ball.v).toEqual({ x: 0, y: 0, z: 0 });
	});

	it("is faster struck at the top of the toss than on the way up", () => {
		const speedAt = (after: number): number => {
			const s = createMatch("near");
			const tossed = tick(s, [input("near", s, swing(0.5))], DT);
			const at = until(tossed, (x) => x.time >= tossed.time - DT + after);
			const v = tick(at, [input("near", at, swing(0.8))], DT).ball.v;
			return Math.hypot(v.x, v.y, v.z);
		};
		expect(speedAt(TOSS_APEX)).toBeGreaterThan(speedAt(TOSS_MIN_HIT + 0.02));
	});
});

describe("the return — the swing path that broke", () => {
	it("has a contact planned, in the future, once the serve bounces", () => {
		const s = awaitingReturn();
		expect(s.contact?.side).toBe("near");
		expect(s.contact?.at).toBeGreaterThan(s.time);
	});

	// The regression. A perfectly timed swing that the phone announces
	// 250ms after the fact arrives when the ball is already past the
	// contact point. It used to be judged against a *new* prediction made
	// at arrival and read as 650ms early: a whiff. Back-dated by its lag it
	// must connect exactly as a prompt one does.
	it("connects a well-timed swing that arrives late but reports its lag, exactly as a prompt one", () => {
		const s = awaitingReturn();
		const ideal = until(
			s,
			(x) => x.time >= (s.contact?.at ?? 0) + TIMING_IDEAL,
		);

		const prompt = tick(ideal, [input("near", ideal, swing(0.7))], DT);
		const late = until(ideal, (x) => x.time >= ideal.time + 0.25 - 1e-9);
		const laggy = tick(late, [input("near", late, swing(0.7, 250))], DT);

		expect(prompt.toHit).toBe("far");
		expect(laggy.toHit).toBe("far");
		const caughtUp = until(prompt, (x) => x.time >= laggy.time - 1e-9);
		expect(laggy.ball.p.x).toBeCloseTo(caughtUp.ball.p.x, 2);
		expect(laggy.ball.p.y).toBeCloseTo(caughtUp.ball.p.y, 2);
		expect(laggy.ball.p.z).toBeCloseTo(caughtUp.ball.p.z, 2);
	});

	it("holds an early swing and strikes the ball at the contact point, not where it was", () => {
		const s = awaitingReturn();
		const c = s.contact;
		if (!c) throw new Error("no contact");
		const early = until(s, (x) => x.time >= c.at - 0.15);
		const armed = tick(early, [input("near", early, swing(0.7))], DT);
		expect(armed.toHit).toBe("near");
		expect(armed.armed).not.toBeNull();

		const hit = until(armed, (x) => x.toHit === "far");
		expect(hit.stroke?.at).toBeCloseTo(c.at, 6);
		expect(hit.stroke?.from).toEqual(c.ball);
	});

	it("leaves the ball alone when the swing is outside the window", () => {
		const s = awaitingReturn();
		const c = s.contact;
		if (!c) throw new Error("no contact");
		const late = until(
			s,
			(x) => x.time >= c.at + TIMING_IDEAL + TIMING_LATE + 0.05,
		);
		const after = tick(late, [input("near", late, swing(0.9))], DT);
		const control = tick(late, [], DT);
		expect(after.toHit).toBe("near");
		expect(after.ball).toEqual(control.ball);
		expect(after.whiffs.near).toBe(late.whiffs.near + 1);
	});

	it("does not count an early practice swing as a whiff", () => {
		// The serve is still in the air: contact is most of a second away.
		const s = until(serve(createMatch("far")), (x) => x.contact !== null);
		const c = s.contact;
		if (!c) throw new Error("no contact");
		expect(c.at - s.time).toBeGreaterThan(TIMING_EARLY + 0.1);
		const after = tick(s, [input("near", s, swing(0.9))], DT);
		expect(after.whiffs.near).toBe(s.whiffs.near);
		expect(after.armed).toBeNull();
	});

	// One real swing is several peaks on the phone: backswing, swing,
	// follow-through. The hardest of them is the swing.
	it("plays the harder of two swings in the window — the backswing does not steal the shot", () => {
		const s = awaitingReturn();
		const c = s.contact;
		if (!c) throw new Error("no contact");
		const back = until(s, (x) => x.time >= c.at - 0.25);
		const a = tick(back, [input("near", back, swing(0.3))], DT);
		const fwd = until(a, (x) => x.time >= c.at - 0.05);
		const b = tick(fwd, [input("near", fwd, swing(0.9))], DT);
		const hit = until(b, (x) => x.toHit === "far");
		expect(hit.stroke?.power).toBe(0.9);
	});

	it("upgrades a hit when the real swing lands just after a weaker peak already struck", () => {
		const s = awaitingReturn();
		const c = s.contact;
		if (!c) throw new Error("no contact");
		const at = until(s, (x) => x.time >= c.at + TIMING_IDEAL);
		const weak = tick(at, [input("near", at, swing(0.3))], DT);
		expect(weak.toHit).toBe("far");
		const later = until(weak, (x) => x.time >= at.time + 0.1);
		const strong = tick(later, [input("near", later, swing(0.9))], DT);
		expect(strong.stroke?.power).toBe(0.9);
		expect(strong.toHit).toBe("far");
		const speed = (b: Ball) => Math.hypot(b.v.x, b.v.y, b.v.z);
		expect(speed(strong.ball)).toBeGreaterThan(speed(tick(later, [], DT).ball));
	});

	// The real swing is announced after its peak and carried over the
	// network: it happened in the window but arrives well after it.
	it("upgrades a hit from a real swing that happened in the window but arrived after it", () => {
		const s = awaitingReturn();
		const c = s.contact;
		if (!c) throw new Error("no contact");
		const at = until(s, (x) => x.time >= c.at);
		const weak = tick(at, [input("near", at, swing(0.3))], DT);
		const later = until(weak, (x) => x.time >= c.at + TIMING_LATE + 0.08);
		// Swung 0.15s after contact, arriving 0.28s after it.
		const lag = (later.time - (c.at + 0.15)) * 1000;
		const strong = tick(later, [input("near", later, swing(0.9, lag))], DT);
		expect(strong.stroke?.power).toBe(0.9);
	});

	it("does not let a weaker follow-through undo a hit", () => {
		const s = awaitingReturn();
		const c = s.contact;
		if (!c) throw new Error("no contact");
		const at = until(s, (x) => x.time >= c.at + TIMING_IDEAL);
		const hit = tick(at, [input("near", at, swing(0.8))], DT);
		const later = until(hit, (x) => x.time >= at.time + 0.1);
		const after = tick(later, [input("near", later, swing(0.4))], DT);
		expect(after.ball).toEqual(tick(later, [], DT).ball);
	});
});

describe("forehand or backhand is where the ball is, not what the phone said", () => {
	const incoming = (x: number): MatchState =>
		tick(
			state({
				phase: "rally",
				toHit: "near",
				ball: { p: { x, y: 1.4, z: -3 }, v: { x: 0, y: 2, z: 14 } },
			}),
			[],
			DT,
		);

	it("plays a ball on the near player's right (+x) as a forehand", () => {
		expect(incoming(2.5).contact?.stroke).toBe("forehand");
	});

	it("plays a ball on their left as a backhand", () => {
		expect(incoming(-2.5).contact?.stroke).toBe("backhand");
	});
});

describe("reach", () => {
	it("whiffs when the player cannot get to the ball in time", () => {
		const s = tick(
			state({
				phase: "rally",
				toHit: "near",
				bounces: 1,
				ball: { p: { x: 4, y: 1, z: 9 }, v: { x: 0, y: 0, z: 12 } },
				players: {
					near: { side: "near", x: -4.5, z: BASELINE_Z },
					far: { side: "far", x: 0, z: -BASELINE_Z },
				},
			}),
			[],
			DT,
		);
		const c = s.contact;
		if (!c) throw new Error("no contact");
		const at = until(s, (x) => x.time >= c.at + TIMING_IDEAL);
		const after = tick(at, [input("near", at, swing(0.8))], DT);
		expect(after.toHit).toBe("near");
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
		expect(next.lastPoint).toBe("far");
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
	});

	it("awards the point to the receiver when the hitter puts it in the net", () => {
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

	it("an unreturned serve is the server's point", () => {
		const served = serve(createMatch("near"));
		const over = until(served, (x) => x.phase === "point-over");
		expect(over.score.points.near).toBe(15);
	});
});

describe("serve faults", () => {
	const serving = (ball: Ball, serveNumber: 1 | 2 = 1): MatchState =>
		state({ phase: "serve-flight", toHit: "far", ball, serveNumber });

	it("a serve past the service line is a fault, not a lost point", () => {
		const next = tick(
			serving(still({ x: 0, y: BALL_RADIUS + 0.005, z: -8 })),
			[],
			DT,
		);
		expect(next.phase).toBe("waiting-serve");
		expect(next.serveNumber).toBe(2);
		expect(next.toHit).toBe("near");
		expect(next.score.points).toEqual({ near: 0, far: 0 });
	});

	it("a serve into the net is a fault", () => {
		const next = tick(
			serving({ p: { x: 0, y: 0.4, z: 0.2 }, v: { x: 0, y: 0, z: -30 } }),
			[],
			DT,
		);
		expect(next.phase).toBe("waiting-serve");
		expect(next.serveNumber).toBe(2);
	});

	it("a second fault is a double fault", () => {
		const next = tick(
			serving(still({ x: 0, y: BALL_RADIUS + 0.005, z: -8 }), 2),
			[],
			DT,
		);
		expect(next.phase).toBe("point-over");
		expect(next.score.points.far).toBe(15);
	});
});

describe("serving positions", () => {
	it("serves from the deuce court on the first point and the ad court on the second", () => {
		const first = createMatch("near");
		// The near player faces -z: their right, the deuce court, is +x.
		expect(first.players.near.x).toBeGreaterThan(0);
		const served = serve(first);
		const next = tick(
			until(served, (x) => x.phase === "point-over"),
			[],
			DT,
		);
		expect(next.players.near.x).toBeLessThan(0);
	});
});

describe("spin", () => {
	it("carries the spin of the shot in flight, and clears it on a new point", () => {
		const served = serve(createMatch("near"), 0.5, 0.75);
		expect(served.spin).toBeCloseTo(0.75, 6);
		expect(createMatch("near").spin).toBe(0);
	});

	it("puts more arc on topspin than slice, for the same target", () => {
		const apex = (spin: number): number => {
			let s = serve(createMatch("near"), 0.5, spin);
			let top = s.ball.p.y;
			while (s.phase === "serve-flight") {
				s = tick(s, [], DT);
				top = Math.max(top, s.ball.p.y);
			}
			return top;
		};
		expect(apex(1)).toBeGreaterThan(apex(-1));
	});
});

describe("match over", () => {
	it("freezes once the set has a winner: tick is a no-op", () => {
		const s = state({
			phase: "point-over",
			score: { ...createMatch("near").score, setWinner: "near" },
		});
		expect(tick(s, [input("near", s, swing(1))], DT)).toEqual(s);
	});
});

describe("a full set between two bots, replayed", () => {
	/**
	 * The regression net under every feel constant: the whole machine —
	 * toss, serve, contact planning, arming, rewinds, movement, scoring —
	 * driven by two deterministic bots. Same inputs, same set, every time.
	 */
	function playSet(): { final: MatchState; hits: number; points: number } {
		const near = createBot("near", 0.85);
		const far = createBot("far", 0.6);
		let s = createMatch("near");
		let hits = 0;
		let points = 0;
		for (let i = 0; i < 400_000; i++) {
			if (s.score.setWinner) return { final: s, hits, points };
			const inputs: RallyInput[] = [];
			const a = near.swing(s);
			if (a) inputs.push(input("near", s, a));
			const b = far.swing(s);
			if (b) inputs.push(input("far", s, b));
			const next = tick(s, inputs, DT);
			if (next.stroke !== s.stroke && next.stroke) hits++;
			if (next.score !== s.score) points++;
			s = next;
		}
		throw new Error("the set never finished");
	}

	it("finishes, and the better bot wins it", () => {
		const { final } = playSet();
		expect(final.score.setWinner).toBe("near");
	});

	it("has real rallies, not one shot per point", () => {
		const { hits, points } = playSet();
		expect(hits / points).toBeGreaterThan(3);
	});

	it("is the same run twice", () => {
		expect(JSON.stringify(playSet().final)).toBe(
			JSON.stringify(playSet().final),
		);
	});
});
