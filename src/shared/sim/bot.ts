/**
 * The solo opponent. Not part of the simulation: `tick` never sees it. The
 * host calls `bot.swing(state)` once per tick and, when it returns a swing,
 * queues it as an ordinary `RallyInput` — exactly the same path a phone's
 * swing takes. The bot has no privileged access to anything; it reads the
 * same `MatchState` the renderer does and answers with the same `Swing` a
 * phone would send.
 *
 * That is the whole design. A bot that reached into the ball's velocity, or
 * that `tick` special-cased, would be a second way for the ball to move and
 * would break the one property the replay tests rest on.
 *
 * It commits to a shot the way a player does: the moment the ball is on its
 * way, it decides *when* it will swing and stops re-deciding. That is where
 * skill lives — a perfect bot plans to meet the ball exactly, a poor one
 * plans to be late or early, and `shot.ts` turns that error into a weak or
 * mistimed shot with no further help.
 *
 * `src/shared/**` is compiled under both a DOM-only and a Node-only tsconfig,
 * so this file names no DOM type and no Node global — see
 * `llm-knowledge/decisions/0002-host-authoritative-simulation.md`.
 */

import type { Side, Swing } from "../protocol.ts";
import { predictStrike } from "./players.ts";
import { envFor, type MatchState } from "./rally.ts";
import { MISS_WINDOW } from "./shot.ts";

/** Seconds the bot waits before serving. A bot that serves the instant the
 * point starts reads as a glitch, not as an opponent. */
export const SERVE_DELAY = 1.2;

/** Worst timing error a skill-0 bot plans, seconds. Just past `MISS_WINDOW`,
 * so the hopeless end of the scale genuinely whiffs rather than dinking every
 * ball back. */
const MAX_PLANNED_ERROR = MISS_WINDOW * 1.15;

/** Groundstroke power at skill 0 and at skill 1. */
const POWER_MIN = 0.45;
const POWER_MAX = 0.9;

/** Serve power. Flat, so it lands at any power
 * (`llm-knowledge/experiments/2026-09-20-serve-that-lands.md`) — this is
 * chosen to look like a serve, not to be safe. */
const SERVE_POWER = 0.7;

/**
 * Shot-to-shot variation, cycled by shot index rather than drawn from an RNG.
 * Deterministic on purpose: a solo rally has to replay identically for the
 * same reason `tick` does, and "deterministic" is also the only reason a
 * failing bot test can be debugged at all.
 *
 * The signs matter more than the numbers: timing error's sign is the whole
 * direction mechanic ([[0008-timing-not-aim-for-shot-direction]]), so a bot
 * that is always a little early would only ever hit cross-court.
 */
const ERROR_BIAS: readonly number[] = [1, -0.7, 0.45, -1, 0.8, -0.35];
const SPIN_CYCLE: readonly number[] = [0.4, 0, 0.7, -0.3, 0.2, 0.55];
const POWER_JITTER: readonly number[] = [0, 0.08, -0.06, 0.05, -0.1, 0.03];

const clamp = (x: number, lo: number, hi: number) =>
	Math.max(lo, Math.min(hi, x));

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
	let plannedAt: number | null = null;
	let plannedSwing: Swing | null = null;
	let shot = 0;

	const forget = (): null => {
		plannedAt = null;
		plannedSwing = null;
		return null;
	};

	/** Signed timing error the bot aims for on this shot. Zero at skill 1. */
	const plannedError = (): number => {
		const bias = ERROR_BIAS[shot % ERROR_BIAS.length] ?? 0;
		return (1 - strength) * MAX_PLANNED_ERROR * bias;
	};

	const groundstroke = (state: MatchState): Swing => {
		const jitter = POWER_JITTER[shot % POWER_JITTER.length] ?? 0;
		const power = clamp(
			POWER_MIN + (POWER_MAX - POWER_MIN) * strength + jitter,
			0,
			1,
		);
		// Cosmetic only — the sim reads no difference between the two — but
		// the renderer swings the right arm, and a backhand played as a
		// forehand is the kind of thing that looks wrong without looking like
		// a bug.
		const reach = state.ball.p.x - state.players[side].x;
		const kind = (side === "near" ? reach >= 0 : reach <= 0)
			? "forehand"
			: "backhand";
		return {
			kind,
			power,
			at: state.time,
			spin: SPIN_CYCLE[shot % SPIN_CYCLE.length] ?? 0,
			// The bot has no phone and no detector between it and the sim, so
			// it reports no delay. Leaving this out would have the sim assume
			// DEFAULT_SWING_LAG_MS and judge every bot shot 200ms early.
			lag: 0,
		};
	};

	return {
		swing(state) {
			if (state.score.setWinner !== null) return forget();
			if (state.toHit !== side) return forget();

			if (plannedAt === null) {
				if (state.phase === "waiting-serve") {
					plannedAt = state.time + SERVE_DELAY;
					plannedSwing = {
						kind: "serve",
						power: SERVE_POWER,
						at: state.time,
						spin: 0,
						lag: 0,
					};
				} else {
					// Commit once, to the trajectory as it stands now. Not
					// re-planned every tick: a bot that keeps re-deciding is a
					// bot that always has perfect information, which is exactly
					// the thing `skill` is supposed to take away.
					// The same prediction the bot's own feet are following, so
					// it commits to hitting the ball where it will be standing
					// rather than at a baseline it may have left.
					const strike = predictStrike(
						state.ball,
						envFor(state),
						side,
						state.players[side],
						state.bounces > 0,
					);
					plannedAt = state.time + strike.t + plannedError();
					plannedSwing = groundstroke(state);
				}
			}

			if (plannedAt === null || state.time < plannedAt) return null;

			const swing = plannedSwing;
			shot += 1;
			forget();
			return swing;
		},
	};
}
