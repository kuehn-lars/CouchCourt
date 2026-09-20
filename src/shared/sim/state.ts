/**
 * The simulation's state, as plain flat data. No methods, no classes, nothing
 * that cannot be structurally cloned.
 *
 * `tick` returns a **new** state rather than mutating one, because the
 * renderer interpolates between the previous state and the current one every
 * frame (`alpha`, phase 7 of the plan). That makes a small flat graph worth
 * more than a clever one: everything here is copied once per tick.
 *
 * Fields are `readonly` for the same reason — a mutation in place would be
 * invisible to the interpolator, which would simply render the new position
 * twice and judder.
 */

import type { Side } from "../protocol.ts";

/** Metres, in the frame `court.ts` documents. */
export interface Vec3 {
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

export interface Ball {
	/** Position of the ball's centre. */
	readonly p: Vec3;
	/** Velocity, m/s. */
	readonly v: Vec3;
}

/**
 * v1 has no manual movement: the sim places each player itself (phase 4).
 * Only `x` moves — a player stays on their own baseline, so the rest of the
 * position is derived from `side` rather than stored and kept in sync.
 */
export interface Player {
	readonly side: Side;
	readonly x: number;
}
