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
 * v1 has no manual movement: the sim places each player itself. Both `x` and
 * `z` move — a player runs in from the baseline for a short ball and stays
 * back for a deep one, which is the whole of `PRODUCT.md`'s "ball physics
 * with automatic player movement".
 *
 * `z` was added on 2026-09-21. Before it, a player slid along their own
 * baseline and their position was decoration: contact was taken at the
 * ball's position wherever the avatar happened to be. It is load-bearing now
 * — `predictStrike` decides where the player stands AND when they can hit,
 * and `rally.ts` times the swing against that same answer.
 */
export interface Player {
	readonly side: Side;
	readonly x: number;
	readonly z: number;
}
