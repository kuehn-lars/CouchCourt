/**
 * What the renderer should draw about the tick that just happened, derived
 * from two consecutive `MatchState`s.
 *
 * Its own file, away from `index.ts`, because it is the one pure thing in
 * the renderer: no THREE, no DOM, no canvas. That makes it the one part of
 * the renderer a test can hold, and it decides which swing animation plays,
 * which is not a detail worth leaving unchecked.
 */

import type { Side } from "../../shared/protocol.ts";
import type { MatchState } from "../../shared/sim/index.ts";
import type { Vec3 } from "../../shared/sim/state.ts";
import type { StrokeAnim } from "./entities.ts";

export type RenderEvent =
	| {
			readonly kind: "hit";
			readonly side: Side;
			readonly position: Vec3;
			/** Which animation to play. Taken from `MatchState.stroke`, which
			 * exists precisely because the swing is gone by the time a hit is
			 * derived from a `toHit` flip. */
			readonly stroke: StrokeAnim;
			readonly power: number;
	  }
	| { readonly kind: "bounce"; readonly position: Vec3 }
	| { readonly kind: "point" };

/** Ball must be this low, metres, and moving upward, to count as a bounce.
 * A heuristic on the interpolated ball state, not a sim event — cosmetic
 * only, see the phase 8 session log for why `MatchState` doesn't carry a
 * "bounced this tick" flag of its own. */
export const BOUNCE_HEIGHT = 0.2;

/** A serve is a serve however it was reached; anything else taken before the
 * ball bounced is a volley, and is blocked rather than swung at. */
export function strokeAnim(
	stroke: NonNullable<MatchState["stroke"]>,
): StrokeAnim {
	if (stroke.kind === "serve") return "serve";
	return stroke.air ? "volley" : stroke.kind;
}

/** Diffs two consecutive tick states into the effects worth drawing. Mirrors
 * `main.ts`'s own `hit`/`point` feedback derivation (`toHit` flip, `score`
 * reference change) rather than adding a second notion of what a hit is. */
export function detectEvents(
	before: MatchState,
	current: MatchState,
): RenderEvent[] {
	const events: RenderEvent[] = [];

	if (before.toHit !== current.toHit && current.stroke) {
		events.push({
			kind: "hit",
			side: before.toHit,
			position: current.ball.p,
			stroke: strokeAnim(current.stroke),
			power: current.stroke.power,
		});
	}
	if (
		before.ball.v.y < 0 &&
		current.ball.v.y > 0 &&
		current.ball.p.y < BOUNCE_HEIGHT
	) {
		events.push({ kind: "bounce", position: current.ball.p });
	}
	if (before.score !== current.score) {
		events.push({ kind: "point" });
	}
	return events;
}
