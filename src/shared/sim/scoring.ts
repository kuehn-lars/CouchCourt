/**
 * Pure scoring. Implements `llm-knowledge/reference/tennis-scoring.md` — that
 * note is the specification; this file does not re-derive the rules, only
 * encodes them. No ball, no geometry, no timing here: `awardPoint` only ever
 * needs to know who won the point.
 *
 * The points ladder carries its own state: deuce is both sides at `40`,
 * advantage is one side at `"AD"` with the other still at `40`. That is
 * enough to drive the game state machine without a hidden raw point count.
 */

import type { Side } from "../protocol.ts";

export type PointValue = 0 | 15 | 30 | 40 | "AD";

export interface TiebreakState {
	readonly points: Readonly<Record<Side, number>>;
	/** Who served the tiebreak's first point — the rotation is computed from this. */
	readonly firstServer: Side;
}

export interface Score {
	readonly points: Readonly<Record<Side, PointValue>>;
	readonly games: Readonly<Record<Side, number>>;
	/** Who serves the next point (in a tiebreak) or the next game. */
	readonly server: Side;
	readonly tiebreak: TiebreakState | null;
	readonly setWinner: Side | null;
}

export function initialScore(server: Side): Score {
	return {
		points: { near: 0, far: 0 },
		games: { near: 0, far: 0 },
		server,
		tiebreak: null,
		setWinner: null,
	};
}

function other(side: Side): Side {
	return side === "near" ? "far" : "near";
}

const LADDER: readonly PointValue[] = [0, 15, 30, 40];

export function awardPoint(score: Score, winner: Side): Score {
	const loser = other(winner);
	return score.tiebreak
		? awardTiebreakPoint(score, winner, loser)
		: awardGamePoint(score, winner, loser);
}

function awardGamePoint(score: Score, winner: Side, loser: Side): Score {
	const w = score.points[winner];
	const l = score.points[loser];

	if (w === "AD") {
		return winGame(score, winner, loser);
	}
	if (l === "AD") {
		return {
			...score,
			points: { [winner]: 40, [loser]: 40 } as Record<Side, PointValue>,
		};
	}
	if (w === 40) {
		return l === 40
			? { ...score, points: { ...score.points, [winner]: "AD" } }
			: winGame(score, winner, loser);
	}
	const next = LADDER[LADDER.indexOf(w) + 1];
	return { ...score, points: { ...score.points, [winner]: next } };
}

function winGame(score: Score, winner: Side, loser: Side): Score {
	const games = { ...score.games, [winner]: score.games[winner] + 1 };
	const server = other(score.server);
	const points: Record<Side, PointValue> = { near: 0, far: 0 };

	if (games[winner] >= 6 && games[winner] - games[loser] >= 2) {
		return {
			...score,
			points,
			games,
			server,
			tiebreak: null,
			setWinner: winner,
		};
	}
	if (games.near === 6 && games.far === 6) {
		return {
			...score,
			points,
			games,
			server,
			tiebreak: { points: { near: 0, far: 0 }, firstServer: server },
		};
	}
	return { ...score, points, games, server };
}

/** Who serves tiebreak point `n` (1-indexed): one point, then alternates every two. */
function tiebreakServer(firstServer: Side, n: number): Side {
	if (n === 1) return firstServer;
	const pairIndex = Math.floor((n - 2) / 2);
	return pairIndex % 2 === 0 ? other(firstServer) : firstServer;
}

function awardTiebreakPoint(score: Score, winner: Side, loser: Side): Score {
	const tb = score.tiebreak;
	if (!tb)
		throw new Error("awardTiebreakPoint called without a tiebreak in progress");

	const points = { ...tb.points, [winner]: tb.points[winner] + 1 };
	if (points[winner] >= 7 && points[winner] - points[loser] >= 2) {
		const games = { ...score.games, [winner]: score.games[winner] + 1 };
		return {
			...score,
			points: { near: 0, far: 0 },
			games,
			tiebreak: null,
			setWinner: winner,
		};
	}

	const played = points.near + points.far;
	return {
		...score,
		tiebreak: { points, firstServer: tb.firstServer },
		server: tiebreakServer(tb.firstServer, played + 1),
	};
}
