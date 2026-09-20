/**
 * Court geometry. Every constant here is an ITF rulebook figure in metres —
 * **cited, not tuned.** The numbers that get measured and adjusted live with
 * the ball physics and the shot feel; nothing in this file is one of them.
 *
 * The frame, stated once in `llm-knowledge/reference/coordinate-frame.md`:
 * `x` across the court with 0 at the centre, `y` up, `z` along the court with
 * the net at 0, the near baseline at `+BASELINE_Z` and the far one at
 * `-BASELINE_Z`. Metres, seconds, radians, so no unit suffixes on names.
 *
 * `src/shared/**` is compiled under both a DOM-only and a Node-only tsconfig,
 * so this file names no DOM type and no Node global — see
 * `llm-knowledge/decisions/0002-host-authoritative-simulation.md`.
 */

import type { Side } from "../protocol.ts";

/** Baseline to baseline. */
export const COURT_LENGTH = 23.77;

/** `|z|` of each baseline. The net is at `z = 0`, so this is half the length. */
export const BASELINE_Z = COURT_LENGTH / 2;

/** Centre to singles sideline. Doubles alleys are not modelled: v1 is singles. */
export const SINGLES_HALF_WIDTH = 4.115;

/** `|z|` of each service line — measured from the **net**, not the baseline. */
export const SERVICE_LINE_Z = 6.4;

/**
 * `|x|` of the net posts. ITF puts the centre of a singles post 0.914 outside
 * the singles sideline, which is also why that figure appears twice here and
 * means two different things.
 */
export const NET_POST_X = SINGLES_HALF_WIDTH + 0.914;

/** Net height at the centre strap. */
export const NET_HEIGHT_CENTRE = 0.914;

/** Net height at the posts. */
export const NET_HEIGHT_POST = 1.07;

/** ITF allows a 6.54-6.86 diameter; this is the middle of that range. */
export const BALL_RADIUS = 0.0335;

/**
 * Net height at a given `x`. A function, not a constant: the cord sags
 * linearly from the posts to the centre strap, so a ball that clips the band
 * out near a post meets ~15cm more net than one clipping it at the centre.
 * A flat net would silently make wide shots easier than they are.
 *
 * Clamped at the posts — past them there is no net, and a ball out there is
 * being judged by the sideline, not by this.
 */
export function netHeightAt(x: number): number {
	const t = Math.min(Math.abs(x) / NET_POST_X, 1);
	return NET_HEIGHT_CENTRE + t * (NET_HEIGHT_POST - NET_HEIGHT_CENTRE);
}

/**
 * Whether `(x, z)` is inside the singles court. Deliberately does not check
 * which side of the net it is on — a rally shot can only land wide or long
 * of the correct side already (the ball's own direction guarantees the
 * sign), the one exception being a net rebound, which `rally.ts` catches
 * from the crossing event itself rather than from where it lands.
 */
export function isInBounds(x: number, z: number): boolean {
	return Math.abs(x) <= SINGLES_HALF_WIDTH && Math.abs(z) <= BASELINE_Z;
}

/**
 * Whether `(x, z)` is inside `side`'s service box: between the net and the
 * service line, within the singles sidelines. Deuce/ad court is not
 * modelled — that needs a server `x` position `Player` does not carry, and
 * nothing asks for it — so a serve landing anywhere in the correct half
 * counts, not just the diagonal box.
 */
export function isInServiceBox(x: number, z: number, side: Side): boolean {
	const withinDepth =
		side === "near"
			? z >= 0 && z <= SERVICE_LINE_Z
			: z <= 0 && z >= -SERVICE_LINE_Z;
	return withinDepth && Math.abs(x) <= SINGLES_HALF_WIDTH;
}
