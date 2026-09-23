/**
 * What the renderer should draw about the tick that just happened, derived
 * from two consecutive `MatchState`s.
 *
 * Its own file, away from `index.ts`, because it is the one pure thing in
 * the renderer: no THREE, no DOM, no canvas. It decides which swing animation
 * plays and whether a ball that jumped was a new shot or a re-struck one,
 * which are not details worth leaving unchecked.
 */

import type { Side } from "../../shared/protocol.ts";
import type { MatchState, Stroke } from "../../shared/sim/index.ts";
import type { Vec3 } from "../../shared/sim/state.ts";
import type { StrokeAnim } from "./poses.ts";

export type RenderEvent =
	| {
			readonly kind: "hit";
			readonly side: Side;
			/** Where the racket met the ball — not where the ball is now,
			 * which after a rewind is some way down the court. */
			readonly position: Vec3;
			readonly stroke: StrokeAnim;
			readonly power: number;
			/** The same ball re-struck by a harder peak of the same swing
			 * (`rally.ts`, `revise`): the ball jumps, nobody swings again. */
			readonly revised: boolean;
	  }
	| { readonly kind: "whiff"; readonly side: Side; readonly stroke: StrokeAnim }
	| { readonly kind: "toss"; readonly side: Side }
	| { readonly kind: "bounce"; readonly position: Vec3 }
	| { readonly kind: "point" };

/** Ball must be this low, metres, and moving upward, to count as a bounce.
 * A heuristic on the ball state, not a sim event — cosmetic only. */
export const BOUNCE_HEIGHT = 0.2;

/** A serve and a smash are the same overhead swing, and the smash is jumped;
 * anything else taken before the ball bounced is a volley, and is blocked
 * rather than swung at. */
export function strokeAnim(stroke: Pick<Stroke, "kind" | "air">): StrokeAnim {
	if (stroke.kind === "serve") return "serve";
	if (stroke.kind === "overhead") return "smash";
	return stroke.air ? "volley" : stroke.kind;
}

export function detectEvents(
	before: MatchState,
	current: MatchState,
): RenderEvent[] {
	const events: RenderEvent[] = [];
	const stroke = current.stroke;

	if (stroke && stroke !== before.stroke) {
		events.push({
			kind: "hit",
			side: stroke.side,
			position: stroke.from,
			stroke: strokeAnim(stroke),
			power: stroke.power,
			revised: before.stroke?.at === stroke.at,
		});
	}
	for (const side of ["near", "far"] as const) {
		if (current.whiffs[side] > before.whiffs[side]) {
			const c = current.contact ?? before.contact;
			const set = c?.side === side ? c : null;
			events.push({
				kind: "whiff",
				side,
				stroke: set
					? strokeAnim({ kind: set.stroke, air: set.air })
					: "forehand",
			});
		}
	}
	if (current.toss !== null && before.toss === null) {
		events.push({ kind: "toss", side: current.toHit });
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
