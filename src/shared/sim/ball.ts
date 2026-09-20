/**
 * Ball flight: one fixed-step integration, plus the two plane crossings that
 * make it a tennis ball rather than a projectile.
 *
 * **Why the segment test matters.** At the sim's 120Hz step a 30 m/s ball
 * moves 25cm per tick. The net and the court surface are planes of zero
 * thickness, so testing the *endpoint* of a tick against them misses most
 * contacts entirely — the ball is on one side before the step and the other
 * side after it, and nothing in between is ever looked at. So: integrate, then
 * test the **segment** from the old position to the new one against `z = 0`
 * and `y = BALL_RADIUS`, solve for the fraction of the step at which it
 * crossed, and resolve there. Two analytic plane tests, no substepping.
 *
 * `src/shared/**` is compiled under both a DOM-only and a Node-only tsconfig,
 * so this file names no DOM type and no Node global — see
 * `llm-knowledge/decisions/0002-host-authoritative-simulation.md`.
 */

import { BALL_RADIUS, NET_POST_X, netHeightAt } from "./court.ts";
import type { Ball, Vec3 } from "./state.ts";

export const GRAVITY = 9.81;

/**
 * Quadratic drag coefficient, 1/m, from the ball's own numbers:
 * `k = ½·ρ·Cd·A / m = ½·1.21·0.55·3.53e-3 / 0.057`. At 30 m/s that is
 * ~18.5 m/s² — **drag dominates this trajectory.** Leaving it out is not a
 * simplification, it is a different game.
 */
export const DRAG_K = 0.0206;

/** Fraction of vertical speed kept in a bounce. Phase 9 tunes this. */
export const COURT_RESTITUTION = 0.75;

/** Speed kept when the ball meets the band and drops back. */
export const NET_REBOUND = 0.2;

/** Speed kept when the ball clips the cord and carries on over. */
export const NET_CLIP_DAMPING = 0.6;

export interface BallEnv {
	/**
	 * Multiplies gravity. 1.0 is a flat ball; up to ~2.0 stands in for topspin,
	 * which is why there is no spin vector and no Magnus force anywhere here.
	 */
	readonly gravityScale: number;
	/** Usually `DRAG_K`; a parameter so the tests can sweep it. */
	readonly drag: number;
}

export interface NetCrossing {
	/** Where the ball's centre crossed `z = 0`. */
	readonly x: number;
	readonly y: number;
	/** True when the band stopped it. A clip that got through is `false`. */
	readonly hit: boolean;
}

export interface BallStep {
	readonly ball: Ball;
	/** Set on any step whose segment crossed the net plane. */
	readonly net?: NetCrossing;
	/** Where the ball touched the surface, if it did this step. */
	readonly bounce?: { readonly x: number; readonly z: number };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Position after `t` seconds of constant acceleration `a`. */
const at = (p: Vec3, v: Vec3, a: Vec3, t: number): Vec3 => ({
	x: p.x + v.x * t + 0.5 * a.x * t * t,
	y: p.y + v.y * t + 0.5 * a.y * t * t,
	z: p.z + v.z * t + 0.5 * a.z * t * t,
});

const after = (v: Vec3, a: Vec3, t: number): Vec3 => ({
	x: v.x + a.x * t,
	y: v.y + a.y * t,
	z: v.z + a.z * t,
});

/**
 * Advance the ball one step, resolving whichever plane it crossed first.
 *
 * Only the **first** crossing of a step is resolved: a tick that both bounces
 * and reaches the net reports the bounce, and the net contact lands on the
 * next tick 8ms later. At 120Hz that is invisible, and the alternative is the
 * substepping loop the plan rules out.
 */
export function stepBall(ball: Ball, dt: number, env: BallEnv): BallStep {
	const { p, v } = ball;

	// Acceleration is held constant across the step. In a vacuum that is exact,
	// which is what lets a drag-free launch match the closed-form parabola to
	// the centimetre; with drag it is a sub-millimetre error per tick.
	const speed = Math.hypot(v.x, v.y, v.z);
	const d = -env.drag * speed;
	const a: Vec3 = {
		x: d * v.x,
		y: d * v.y - GRAVITY * env.gravityScale,
		z: d * v.z,
	};

	const end = at(p, v, a, dt);

	// Fractions of the step at which the segment meets each plane, or 1 (never).
	const netAt =
		p.z > 0 !== end.z > 0 ? p.z / (p.z - end.z) : Number.POSITIVE_INFINITY;
	const floorAt =
		p.y > BALL_RADIUS && end.y <= BALL_RADIUS
			? (p.y - BALL_RADIUS) / (p.y - end.y)
			: Number.POSITIVE_INFINITY;

	if (netAt <= floorAt && netAt <= 1) {
		return resolveNet(ball, a, dt, netAt, end);
	}
	if (floorAt <= 1) {
		return resolveBounce(ball, a, dt, floorAt, end);
	}
	return { ball: { p: end, v: after(v, a, dt) } };
}

function resolveNet(
	ball: Ball,
	a: Vec3,
	dt: number,
	f: number,
	end: Vec3,
): BallStep {
	const { p, v } = ball;
	const contact: Vec3 = {
		x: lerp(p.x, end.x, f),
		y: lerp(p.y, end.y, f),
		z: 0,
	};
	const vc = after(v, a, f * dt);
	const rest = (1 - f) * dt;

	const band = netHeightAt(contact.x);
	const inPlay = Math.abs(contact.x) <= NET_POST_X;
	const clear = !inPlay || contact.y - BALL_RADIUS >= band;
	const blocked = inPlay && contact.y < band;

	if (blocked) {
		// Dead against the band: it drops on the side it came from.
		return {
			ball: {
				p: contact,
				v: {
					x: vc.x * NET_REBOUND,
					y: vc.y * NET_REBOUND,
					z: -vc.z * NET_REBOUND,
				},
			},
			net: { x: contact.x, y: contact.y, hit: true },
		};
	}

	// Either clean over, or a clip: the ball's centre is above the cord but
	// within a radius of it, so it grazes and carries on slower. A clip that
	// lands in plays on — that is what the damping is for.
	const damp = clear ? 1 : NET_CLIP_DAMPING;
	const vd: Vec3 = { x: vc.x * damp, y: vc.y * damp, z: vc.z * damp };
	return {
		ball: { p: at(contact, vd, a, rest), v: after(vd, a, rest) },
		net: { x: contact.x, y: contact.y, hit: false },
	};
}

function resolveBounce(
	ball: Ball,
	a: Vec3,
	dt: number,
	f: number,
	end: Vec3,
): BallStep {
	const { p, v } = ball;
	const contact: Vec3 = {
		x: lerp(p.x, end.x, f),
		y: BALL_RADIUS,
		z: lerp(p.z, end.z, f),
	};
	const vc = after(v, a, f * dt);
	const bounced: Vec3 = { x: vc.x, y: -vc.y * COURT_RESTITUTION, z: vc.z };
	const rest = (1 - f) * dt;

	return {
		ball: { p: at(contact, bounced, a, rest), v: after(bounced, a, rest) },
		bounce: { x: contact.x, z: contact.z },
	};
}
