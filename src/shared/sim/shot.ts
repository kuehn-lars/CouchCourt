/**
 * Shot resolution: the feel core. `resolveShot` turns a detected swing plus
 * its timing into an outgoing ball velocity.
 *
 * There is no `aim` reading here on purpose
 * (`llm-knowledge/decisions/0008-timing-not-aim-for-shot-direction.md`): a
 * trustworthy compass zero needs a per-player calibration step the product
 * won't spend.
 *
 * **Direction comes from which stroke you played.** A forehand pulls across
 * the body one way, a backhand the other; timing decides how well you hit it,
 * not where it goes. This replaced timing's sign on 2026-09-21 — see
 * `llm-knowledge/decisions/0012-swing-kind-is-the-shot-direction.md`, which
 * supersedes 0008's direction rule and keeps the rest of it.
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

/** Where a serve is struck, metres. Overhead, not at waist height. */
export const SERVE_CONTACT_HEIGHT = 2.6;

/**
 * Serve launch angle, radians, lerped by power: a gentle serve is lofted in,
 * a hard one is hit down. **Measured, not guessed** — for every power from
 * 0.15 to 0.95 there is a band of angles that lands in the service box, the
 * band's midpoint is very nearly linear in power, and these two numbers are
 * that line's ends. See
 * `llm-knowledge/experiments/2026-09-20-serve-that-lands.md`.
 *
 * The effect is that a flat serve lands in the box at EVERY power, instead
 * of only the 0.30-0.45 sliver a fixed angle allowed. That sliver is what
 * made the first serve a coin toss: `PRODUCT.md` asks the game to guess in
 * the player's favour, and a serve nobody can land is the opposite.
 */
export const SERVE_ANGLE_SLOW = 0.11;
export const SERVE_ANGLE_FAST = -0.07;

/** Extra launch angle, radians, for a contact right at ground level. Raised
 * from the phase-5 placeholder (0.3) so a low, well-timed contact reliably
 * clears the net instead of driving it into the band — see
 * `llm-knowledge/experiments/2026-09-20-shot-envelope.md`. Serves are
 * unaffected: their contact height always equals `CONTACT_HEIGHT_REF`, so
 * `heightDeficit` is always 0 for them. */
export const HEIGHT_ANGLE_BOOST = 0.5;

/**
 * Where a cleanly struck groundstroke is aimed, metres from the centre line
 * on the far side. Comfortably inside `SINGLES_HALF_WIDTH` (4.115) so a shot
 * that arrives a little wide of its aim is still in.
 *
 * The shot is aimed at a **place**, not given a fixed sideways speed, and
 * that is not a flourish. A fixed sideways speed works only while both
 * players stand on the centre mark. Measured on 2026-09-21, once the players
 * started running: a full-power forehand struck from x=+3 with a fixed 7 m/s
 * lateral landed out at **every one of 20 powers**, because it was already at
 * the sideline and was pushed further. Aiming instead of pushing puts the
 * clean-landing rate at 150/200 across five contact positions and both
 * strokes. `llm-knowledge/decisions/0012-swing-kind-is-the-shot-direction.md`
 * records why this overturns 0008's "no geometry solve" clause.
 */
export const CROSS_COURT_X = 2.6;

/**
 * Nominal seconds of flight, used only to turn "aim at that x" into a
 * sideways speed. Deliberately a constant rather than solved from the
 * outgoing speed and drag: the real flight is 0.8-1.3s across the power
 * range, and sweeping this over that whole span moved the clean-landing rate
 * by two shots in two hundred. Solving it exactly would buy nothing and
 * couple the aim to the drag model.
 */
export const AIM_FLIGHT_TIME = 1.1;

/** Ceiling on the sideways speed the aim may ask for, m/s. A ball struck from
 * the far corner must not be flung across the court flat. */
export const LATERAL_SPEED_MAX = 7;

/**
 * Sideways speed, m/s, added by a stroke timed at the very edge of the miss
 * window, in the direction the timing erred. Zero inside `CLEAN_WINDOW`.
 *
 * This is what keeps a mishit honest now that timing no longer steers. Before
 * 2026-09-21 a mistimed shot flew wide because timing *was* the direction; the
 * property "a max-power shot deep in the miss window essentially never lands
 * in" was resting on that, and would have been silently lost. Measured back
 * to 0 of 8 landing in at this value; at 8 m/s one of them still lands.
 */
export const MISHIT_SPRAY_MAX = 10;

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
		swing.kind === "serve"
			? lerp(SERVE_ANGLE_SLOW, SERVE_ANGLE_FAST, clamp(swing.power, 0, 1))
			: lerp(LAUNCH_ANGLE_MAX, LAUNCH_ANGLE_MIN, quality) +
				heightDeficit * HEIGHT_ANGLE_BOOST;

	const forwardSpeed = speed * Math.cos(angle);
	const verticalSpeed = speed * Math.sin(angle);

	const forward = side === "near" ? -1 : 1;
	// A right-hander pulls the ball across their body: the near player faces
	// -z so their right side is +x and their forehand sweeps toward -x, and
	// the far player, facing the other way, mirrors it. Both cases are
	// `forward`'s own sign, which is why this is one multiply and not a
	// per-side table. A serve has no stroke side and goes straight.
	const strokeSign =
		swing.kind === "serve" ? 0 : swing.kind === "forehand" ? forward : -forward;
	// Quality pulls the aim back toward the middle: a scruffy contact is not
	// finding the corner, and aiming it there would only send it out.
	const targetX = strokeSign * CROSS_COURT_X * quality;
	const aim = clamp(
		(targetX - contact.x) / AIM_FLIGHT_TIME,
		-LATERAL_SPEED_MAX,
		LATERAL_SPEED_MAX,
	);
	// Outside the clean window the racket face is not where the player
	// thought, and the ball leaves in the direction the timing erred.
	const spray = Math.sign(timingError) * MISHIT_SPRAY_MAX * (1 - quality);

	return { x: aim + spray, y: verticalSpeed, z: forward * forwardSpeed };
}
