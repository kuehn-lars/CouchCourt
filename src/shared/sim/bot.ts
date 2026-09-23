/**
 * The solo opponent. Not part of the simulation: `tick` never sees it. The
 * host calls `bot.swing(state)` once per tick and, when it returns a swing,
 * queues it as an ordinary `RallyInput` — exactly the same path a phone's
 * swing takes, judged by exactly the same contact model. A bot that reached
 * into the ball would be a second way for the ball to move.
 *
 * It plays the way the stroke rule invites: it looks at where its opponent
 * is standing and plays the stroke that sends the ball to the other side — a
 * forehand to screen-left, a backhand to screen-right — and smashes a high ball
 * out of the air. Skill is how often it mistimes a shot into an error, and
 * how far its timing wanders on the rest: a little and the ball drifts off
 * the line toward the middle.
 *
 * `src/shared/**` is compiled under both a DOM-only and a Node-only tsconfig,
 * so this file names no DOM type and no Node global — see
 * `llm-knowledge/decisions/0002-host-authoritative-simulation.md`.
 */

import type { Side, Swing, SwingKind } from "../protocol.ts";
import { SMASH_HEIGHT } from "./players.ts";
import type { MatchState } from "./rally.ts";
import { TOSS_APEX } from "./serve.ts";
import { screenLeftOf, TIMING_IDEAL } from "./shot.ts";

/** Seconds the bot waits before tossing. A bot that serves the instant the
 * point starts reads as a glitch, not as an opponent. */
export const SERVE_DELAY = 1.2;

/** Groundstroke power at skill 0 and at skill 1. */
const POWER_MIN = 0.5;
const POWER_MAX = 0.95;
const SERVE_POWER = 0.65;

/** Spread of the bot's timing, seconds, at skill 0 and skill 1 — the same
 * thing that separates a novice from a decent player. Its mistakes are
 * whatever that spread does under the shot rules, exactly as a person's are:
 * early goes wide, late and hard goes long. */
const SIGMA_WORST = 0.15;
const SIGMA_BEST = 0.02;

/**
 * Timing noise in [-1, 1] for the bot's `n`th shot: a hash, not an RNG, so a
 * solo match replays identically — the only reason a failing bot test can be
 * debugged at all. It used to be a short fixed cycle, and two bots of equal
 * skill walked the same cycle in lockstep and traded points at deuce forever.
 */
function noise(n: number, salt: number): number {
	const x = Math.sin(n * 12.9898 + salt * 78.233) * 43758.5453;
	return (x - Math.floor(x)) * 2 - 1;
}
const SPIN_CYCLE: readonly number[] = [0.4, 0, 0.7, -0.3, 0.2, 0.55];
const POWER_JITTER: readonly number[] = [0, 0.08, -0.06, 0.05, -0.1, 0.03];

const clamp = (x: number, lo: number, hi: number) =>
	Math.max(lo, Math.min(hi, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export interface Bot {
	/**
	 * Call once per tick with the current state. Returns the swing to queue
	 * for this tick, or `null`. Stateful — it remembers the shot it has
	 * committed to — so one bot instance belongs to one match.
	 */
	swing(state: MatchState): Swing | null;
}

/** `side` is the end the bot plays. `skill` runs 0 (hopeless) to 1 (never
 * mistimes anything). */
export function createBot(side: Side, skill = 0.75): Bot {
	const strength = clamp(skill, 0, 1);
	const salt = side === "near" ? 1 : 2;
	/** Timing error committed to for the current contact, seconds. */
	let plannedError = 0;
	/** What the plan was made for — a new contact, toss or point replans. */
	let plannedFor: string | null = null;
	/** The plan already swung for: one swing per plan. */
	let swungFor: string | null = null;
	let power = 0;
	let kind: SwingKind = "forehand";
	let shot = 0;
	let waitingSince: number | null = null;

	const swingNow = (state: MatchState): Swing => ({
		kind,
		power,
		at: state.time,
		spin: SPIN_CYCLE[shot % SPIN_CYCLE.length] ?? 0,
		// No phone and no detector between the bot and the sim.
		lag: 0,
	});

	/** The stroke that sends the ball to the side the opponent is not on,
	 * or a smash when the ball is up there to be hit. */
	const strokeFor = (state: MatchState): SwingKind => {
		const c = state.contact;
		if (c?.air && c.ball.y >= SMASH_HEIGHT - 0.2) return "overhead";
		const opponent = state.players[side === "near" ? "far" : "near"];
		// World side to aim for: away from the opponent, alternating when
		// they are dead centre.
		const away =
			Math.abs(opponent.x) > 0.4 ? -Math.sign(opponent.x) : shot % 2 ? 1 : -1;
		return away === screenLeftOf(side, state.split) ? "forehand" : "backhand";
	};

	/** Timing error, seconds: roughly normal (the sum of three hashes),
	 * bounded at three spreads. */
	const errorFor = (): number => {
		const g =
			noise(shot, salt) + noise(shot, salt + 7) + noise(shot, salt + 13);
		return TIMING_IDEAL + g * lerp(SIGMA_WORST, SIGMA_BEST, strength);
	};

	return {
		swing(state) {
			if (state.score.setWinner !== null || state.toHit !== side) {
				plannedFor = null;
				waitingSince = null;
				return null;
			}

			let key: string | null = null;
			let at: number | null = null;
			if (state.phase === "waiting-serve") {
				if (state.toss === null) {
					waitingSince ??= state.time;
					key = `wait-${waitingSince}`;
					at = waitingSince + SERVE_DELAY;
					power = 0.5;
				} else {
					key = `toss-${state.toss}`;
					at = state.toss + TOSS_APEX;
					power = SERVE_POWER;
				}
			} else if (state.contact && state.contact.side === side) {
				waitingSince = null;
				key = `contact-${state.stroke?.at ?? 0}`;
				if (plannedFor !== key) {
					const jitter = POWER_JITTER[shot % POWER_JITTER.length] ?? 0;
					power = clamp(
						POWER_MIN + (POWER_MAX - POWER_MIN) * strength + jitter,
						0.15,
						1,
					);
					// Commit to an error once, as a player does. The contact
					// itself is tracked as it firms up — the ball is in plain
					// sight — but how well it is hit is decided now.
					plannedError = errorFor();
				}
				// The stroke is chosen as late as it is swung: a high ball
				// that is only now known to be taken overhead gets a smash.
				if (state.time >= state.contact.at + plannedError) {
					kind = strokeFor(state);
				}
				at = state.contact.at + plannedError;
			}

			if (key === null || at === null) return null;
			plannedFor = key;
			if (swungFor === key || state.time < at) return null;

			swungFor = key;
			if (state.phase !== "waiting-serve") shot += 1;
			return swingNow(state);
		},
	};
}
