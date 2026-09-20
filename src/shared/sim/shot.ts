/**
 * Shot resolution: the feel core. `resolveShot` turns a detected swing plus
 * its timing into an outgoing ball velocity.
 *
 * There is no `aim` reading here on purpose
 * (`llm-knowledge/plans/2026-09-19-simulation.md`, "Shot direction"): a
 * trustworthy compass zero needs a per-player calibration step the product
 * won't spend, so **direction comes from timing's sign alone** — early is
 * cross-court, late is down the line, and that is one lerp, not a geometry
 * solve against where the player is standing.
 *
 * `src/shared/**` is compiled under both a DOM-only and a Node-only tsconfig,
 * so this file names no DOM type and no Node global — see
 * `llm-knowledge/decisions/0002-host-authoritative-simulation.md`.
 */

import type { Side, Swing } from "../protocol.ts";
import type { Vec3 } from "./state.ts";

/** Timing error inside this many seconds either side of ideal is full-quality
 * contact — deliberately wide, both because "generous input" is the product's
 * bar and because the swing detector's own latency already eats into it. */
export const CLEAN_WINDOW = 0.12;

/** Beyond this many seconds either side, the racket meets nothing. */
export const MISS_WINDOW = 0.28;

/** Groundstroke launch speed range, m/s, weakest to full power. Lowered from
 * the phase-5 placeholder (30) against `sim/playability.test.ts`'s envelope
 * — see `llm-knowledge/experiments/2026-09-20-shot-envelope.md`. */
export const GROUND_SPEED_MIN = 15;
export const GROUND_SPEED_MAX = 28;

/** Serve launch speed range, m/s — hit from overhead, so a higher ceiling. */
export const SERVE_SPEED_MIN = 18;
export const SERVE_SPEED_MAX = 35;

/** Speed kept at the ragged edge of the miss window, on top of power — a bad
 * mishit is slower than a good one at the same power. */
export const MISHIT_SPEED_FACTOR = 0.45;

/** Launch angle above horizontal for a clean, full-quality hit, radians. */
export const LAUNCH_ANGLE_MIN = 0.12;

/**
 * Launch angle at the ragged edge of the miss window, radians. Higher and
 * slower than a clean hit, but not so high that the extra hang time lets a
 * weak shot outrun a fast flat one — measured against `stepBall` directly
 * (a lofted-but-slow trajectory can otherwise travel *further* than a flat
 * fast one, which is the opposite of "lands short").
 */
export const LAUNCH_ANGLE_MAX = 0.44;

/** A contact at or above this height needs no extra elevation to clear the
 * net; below it, the launch angle steepens the lower it gets. */
export const CONTACT_HEIGHT_REF = 1.1;

/** Extra launch angle, radians, for a contact right at ground level. Raised
 * from the phase-5 placeholder (0.3) so a low, well-timed contact reliably
 * clears the net instead of driving it into the band — see
 * `llm-knowledge/experiments/2026-09-20-shot-envelope.md`. Serves are
 * unaffected: their contact height always equals `CONTACT_HEIGHT_REF`, so
 * `heightDeficit` is always 0 for them. */
export const HEIGHT_ANGLE_BOOST = 0.5;

/** Sideways speed, m/s, at the very edge of the miss window. Timing error's
 * sign and magnitude scale linearly into this — the direction decision. */
export const LATERAL_SPEED_MAX = 7;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (x: number, lo: number, hi: number) =>
	Math.max(lo, Math.min(hi, x));

/**
 * `swing` and its `timingError` (host arrival minus ideal contact, seconds,
 * signed) resolve to an outgoing velocity for a ball met at `contact` by the
 * player on `side`. `undefined` past `MISS_WINDOW` — the racket found nothing.
 */
export function resolveShot(
	swing: Swing,
	timingError: number,
	contact: Vec3,
	side: Side,
): Vec3 | undefined {
	const absError = Math.abs(timingError);
	if (absError > MISS_WINDOW) return undefined;

	const quality =
		absError <= CLEAN_WINDOW
			? 1
			: 1 - (absError - CLEAN_WINDOW) / (MISS_WINDOW - CLEAN_WINDOW);

	const [speedMin, speedMax] =
		swing.kind === "serve"
			? [SERVE_SPEED_MIN, SERVE_SPEED_MAX]
			: [GROUND_SPEED_MIN, GROUND_SPEED_MAX];
	const speed =
		lerp(speedMin, speedMax, clamp(swing.power, 0, 1)) *
		lerp(MISHIT_SPEED_FACTOR, 1, quality);

	const heightDeficit = clamp(1 - contact.y / CONTACT_HEIGHT_REF, 0, 1);
	const angle =
		lerp(LAUNCH_ANGLE_MAX, LAUNCH_ANGLE_MIN, quality) +
		heightDeficit * HEIGHT_ANGLE_BOOST;

	const forwardSpeed = speed * Math.cos(angle);
	const verticalSpeed = speed * Math.sin(angle);
	const lateralSpeed =
		clamp(timingError / MISS_WINDOW, -1, 1) * LATERAL_SPEED_MAX;

	const forward = side === "near" ? -1 : 1;
	return { x: lateralSpeed, y: verticalSpeed, z: forward * forwardSpeed };
}
