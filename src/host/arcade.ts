/**
 * The arcade layer: what a match's events *mean* to a player watching — how
 * well a ball was timed, how fast it went, how long the rally is, who is on
 * a streak, what beat the session's best — and nothing about how any of it
 * is drawn or heard. Fed the same `RenderEvent`s the renderer and the audio
 * are, once a frame, so the three cannot disagree.
 *
 * Presentation only: the sim never hears of any of it, and nothing here
 * outlives the page (persisted stats are out of scope, `architecture.md`).
 * Why it exists and what it deliberately leaves out:
 * `llm-knowledge/decisions/0022-arcade-layer.md`.
 */

import type { Side } from "../shared/protocol.ts";
import { SAFE_TIMING } from "../shared/sim/shot.ts";
import type { Vec3 } from "../shared/sim/state.ts";
import { POWER_SHOT } from "../shared/swing/detector.ts";
import type { RenderEvent } from "./render/events.ts";

export type Grade = "perfect" | "great" | "good" | "early" | "late";

/** `|timing|` inside which a hit is perfect, and great. Past `SAFE_TIMING`
 * a groundstroke may not land in (`sim/shot.ts`), so that is where "good"
 * ends and the grade starts naming the mistake instead. */
const PERFECT = 0.12;
const GREAT = 0.25;

export function gradeOf(timing: number): Grade {
	const off = Math.abs(timing);
	if (off <= PERFECT) return "perfect";
	if (off <= GREAT) return "great";
	if (off <= SAFE_TIMING) return "good";
	return timing < 0 ? "early" : "late";
}

/** km/h from which a shot is drawn one step hotter. Measured 2026-09-27 over
 * three bot sets: median 100, p90 118, fastest 149. */
const HEAT_KMH: readonly number[] = [95, 115, 135];

export function heatOf(kmh: number): number {
	return HEAT_KMH.filter((k) => kmh >= k).length;
}

/** A rally is called out every this many strokes. */
export const RALLY_MILESTONE = 5;
/** Shortest rally worth calling a session best. */
export const LONG_RALLY = 8;
/** Strokes played this session before a fastest shot is worth calling —
 * the first few are all records. */
export const RECORD_WARMUP = 12;
/** Straight points that set a side on fire. */
const ON_FIRE = 3;

export interface Pop {
	readonly side: Side;
	readonly at: Vec3;
	readonly kmh: number;
	readonly grade: Grade;
	readonly heat: number;
	readonly power: boolean;
	/** The same ball re-struck by a harder peak: replace the last pop. */
	readonly revised: boolean;
}

/** What a callout is. The audio plays a sting per kind, so a callout's
 * words can change without its sound changing with them. */
export type CalloutKind =
	| "rally"
	| "record"
	| "ace"
	| "winner"
	| "miss"
	| "fire"
	| "broken";

export type Tone = "gold" | "hot" | "cool" | "bad" | "side";

/** The colour family each kind is drawn in (`styles/arcade.css`). */
export const TONE: Readonly<Record<CalloutKind, Tone>> = {
	rally: "cool",
	record: "gold",
	ace: "gold",
	winner: "side",
	miss: "bad",
	fire: "hot",
	broken: "cool",
};

export interface Callout {
	readonly kind: CalloutKind;
	readonly text: string;
	/** Whose moment it is, for `side` tone; `null` for nobody's. */
	readonly side: Side | null;
}

export interface SideStats {
	hits: number;
	/** km/h. */
	fastest: number;
	perfects: number;
	aces: number;
	winners: number;
}

export interface MatchStats {
	readonly near: Readonly<SideStats>;
	readonly far: Readonly<SideStats>;
	readonly longestRally: number;
}

/** What one frame's events came to. */
export interface ArcadeFrame {
	readonly pops: readonly Pop[];
	readonly callouts: readonly Callout[];
}

/** The session's bests: they survive `newMatch`, not a reload. */
export interface Bests {
	readonly rally: number;
	/** km/h. */
	readonly kmh: number;
}

export interface Arcade {
	step(events: readonly RenderEvent[]): ArcadeFrame;
	/** Strokes in the point being played. */
	readonly rally: number;
	readonly onFire: Side | null;
	readonly best: Bests;
	stats(): MatchStats;
	newMatch(): void;
}

const blank = (): SideStats => ({
	hits: 0,
	fastest: 0,
	perfects: 0,
	aces: 0,
	winners: 0,
});

export function createArcade(): Arcade {
	let rally = 0;
	let longestRally = 0;
	let onFire: Side | null = null;
	let streak = { near: 0, far: 0 };
	let stats = { near: blank(), far: blank() };
	const best = { rally: 0, kmh: 0 };
	let sessionHits = 0;

	return {
		get rally() {
			return rally;
		},
		get onFire() {
			return onFire;
		},
		best,
		stats: () => ({ near: stats.near, far: stats.far, longestRally }),
		newMatch() {
			rally = 0;
			longestRally = 0;
			onFire = null;
			streak = { near: 0, far: 0 };
			stats = { near: blank(), far: blank() };
		},

		step(events) {
			const pops: Pop[] = [];
			const callouts: Callout[] = [];
			for (const event of events) {
				if (event.kind === "hit") {
					const kmh = Math.round(event.speed * 3.6);
					const grade = gradeOf(event.timing);
					const mine = stats[event.side];
					mine.fastest = Math.max(mine.fastest, kmh);
					if (!event.revised) {
						rally += 1;
						sessionHits += 1;
						mine.hits += 1;
						if (grade === "perfect") mine.perfects += 1;
						if (rally % RALLY_MILESTONE === 0) {
							callouts.push({
								kind: "rally",
								text: `RALLY ×${rally}`,
								side: null,
							});
						}
					}
					if (kmh > best.kmh) {
						if (sessionHits > RECORD_WARMUP) {
							callouts.push({
								kind: "record",
								text: `FASTEST YET ${kmh} KM/H`,
								side: event.side,
							});
						}
						best.kmh = kmh;
					}
					pops.push({
						side: event.side,
						at: event.position,
						kmh,
						grade,
						heat: heatOf(kmh),
						power: event.power >= POWER_SHOT,
						revised: event.revised,
					});
				} else if (event.kind === "fault") {
					callouts.push({ kind: "miss", text: "FAULT", side: event.side });
				} else if (event.kind === "point" && event.winner !== null) {
					const winner = event.winner;
					const loser: Side = winner === "near" ? "far" : "near";
					switch (event.how) {
						case "ace":
							stats[winner].aces += 1;
							callouts.push({ kind: "ace", text: "ACE!", side: winner });
							break;
						case "winner":
							stats[winner].winners += 1;
							callouts.push({ kind: "winner", text: "WINNER!", side: winner });
							break;
						case "double-fault":
							callouts.push({
								kind: "miss",
								text: "DOUBLE FAULT",
								side: loser,
							});
							break;
						case "out":
							callouts.push({ kind: "miss", text: "OUT", side: loser });
							break;
						case "net":
							callouts.push({ kind: "miss", text: "NET", side: loser });
							break;
					}
					if (rally >= LONG_RALLY && rally > best.rally) {
						best.rally = rally;
						callouts.push({
							kind: "record",
							text: `BEST RALLY ${rally}`,
							side: null,
						});
					}
					longestRally = Math.max(longestRally, rally);
					rally = 0;

					streak = { ...streak, [winner]: streak[winner] + 1, [loser]: 0 };
					if (onFire === loser) {
						onFire = null;
						callouts.push({
							kind: "broken",
							text: "STREAK BROKEN",
							side: winner,
						});
					}
					if (streak[winner] === ON_FIRE) {
						onFire = winner;
						callouts.push({ kind: "fire", text: "ON FIRE!", side: winner });
					}
				}
			}
			return { pops, callouts };
		},
	};
}
