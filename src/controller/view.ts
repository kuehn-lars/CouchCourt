/**
 * What the racket says, for every state the match can be in. Pure: the
 * canvas (`racket.ts`) draws whatever this returns and decides nothing.
 *
 * The phone is glanced at between points, from a racket grip, often out of
 * the corner of an eye. So the headline is one word or one number, big
 * enough to read at arm's length, and it is always the thing to do next —
 * SERVE, HIT, RETURN — or, mid-rally when nobody is looking anyway, the
 * score from your own side.
 *
 * All of it is presentation of facts the host relayed
 * (`llm-knowledge/decisions/0002-host-authoritative-simulation.md`).
 */

import type { MatchInfo, Side } from "../shared/protocol.ts";

/** How a piece of the headline is inked: the ball's yellow, the player's
 * own colour, or dimmed. */
export type Tone = "accent" | "side" | "dim";

export interface Ink {
	readonly text: string;
	readonly tone: Tone;
	/** A small word printed under this piece: whose number it is. */
	readonly label?: string;
}

export interface RacketView {
	/** The stencil across the strings. */
	readonly headline: readonly Ink[];
	/** A smaller stencil under it. */
	readonly caption: string;
	/** Printed round the top of the frame, like a racket's branding. */
	readonly rim: string;
	/** Games won: yours, then theirs. `null` before a match. */
	readonly games: readonly [number, number] | null;
	/** A ball on your strings, when the serve is yours to hit. */
	readonly serveBall: "hand" | "toss" | null;
}

const SIDE_NAME: Record<Side, string> = {
	near: "NEAR COURT",
	far: "FAR COURT",
};

const other = (side: Side): Side => (side === "near" ? "far" : "near");

/** Seconds the host counts down before a match (`host/main.ts`). */
const COUNTDOWN = 3;

/**
 * `sinceCountdown` is seconds since the phone was told the countdown began,
 * which is all it has: the host sends the phase, not a clock.
 */
export function racketView(
	match: MatchInfo | null,
	me: Side | null,
	sinceCountdown: number,
): RacketView {
	const rim = me ? SIDE_NAME[me] : "SWINGCOURT";
	if (!match || !me) {
		return {
			headline: [{ text: "HI", tone: "accent" }],
			caption: "finding the host",
			rim,
			games: null,
			serveBall: null,
		};
	}
	const s = match.score;
	const games = s ? ([s.games[me], s.games[other(me)]] as const) : null;

	switch (match.phase) {
		case "lobby":
			return {
				headline: [{ text: "READY", tone: "accent" }],
				caption: "the host starts the match",
				rim,
				games: null,
				serveBall: null,
			};
		case "countdown": {
			const left = Math.max(1, Math.ceil(COUNTDOWN - sinceCountdown));
			return {
				headline: [{ text: String(left), tone: "accent" }],
				caption: "racket up",
				rim,
				games,
				serveBall: null,
			};
		}
		case "over": {
			const won = match.winner === me;
			const line = games ? `${games[0]}-${games[1]}` : "";
			return {
				headline: [{ text: won ? "WIN" : "GG", tone: won ? "accent" : "side" }],
				caption: won ? `game, set and match ${line}` : `good game ${line}`,
				rim,
				games,
				serveBall: null,
			};
		}
		case "playing":
			break;
	}

	if (!s) {
		return {
			headline: [{ text: "PLAY", tone: "accent" }],
			caption: "swing when it reaches you",
			rim,
			games,
			serveBall: null,
		};
	}

	const mine = s.points[me];
	const theirs = s.points[other(me)];
	const score = `${mine}-${theirs}`;

	if (s.ball !== "play") {
		if (s.serving !== me) {
			return {
				headline: [{ text: "RETURN", tone: "side" }],
				caption: `they serve at ${score}`,
				rim,
				games,
				serveBall: null,
			};
		}
		return s.ball === "hand"
			? {
					headline: [{ text: "SERVE", tone: "accent" }],
					caption: "swing once to toss",
					rim,
					games,
					serveBall: "hand",
				}
			: {
					headline: [{ text: "HIT", tone: "accent" }],
					caption: "at the top of the toss",
					rim,
					games,
					serveBall: "toss",
				};
	}

	if (mine === "40" && theirs === "40") {
		return {
			headline: [{ text: "DEUCE", tone: "side" }],
			caption: "two clear points",
			rim,
			games,
			serveBall: null,
		};
	}
	if (mine === "AD" || theirs === "AD") {
		const yours = mine === "AD";
		return {
			headline: [{ text: "AD", tone: yours ? "accent" : "dim" }],
			caption: yours ? "advantage yours" : "advantage theirs",
			rim,
			games,
			serveBall: null,
		};
	}
	return {
		headline: [
			{ text: mine, tone: "accent", label: "YOU" },
			{ text: " ", tone: "dim" },
			{ text: theirs, tone: "dim", label: "THEM" },
		],
		caption: "",
		rim,
		games,
		serveBall: null,
	};
}
