/**
 * The camera's job is to show both players. That is a geometry question, so
 * it gets a geometry test: project each player's position into the camera's
 * frustum and check it is inside.
 *
 * The old camera fails this test, which is the whole point of writing it —
 * "you can only see one character" was the complaint, and until now nothing
 * in the repo could have caught it.
 */

import { describe, expect, it } from "vitest";
import { BASELINE_Z, SINGLES_HALF_WIDTH } from "../../shared/sim/court.ts";
import { NET_KEEP_OUT, RUN_BACK } from "../../shared/sim/players.ts";
import {
	ATTRACT_PERIOD,
	attractPose,
	CAMERA_MODES,
	type CameraPose,
	cameraPose,
	nextMode,
	type Vec3Mutable,
} from "./camera.ts";

/** Where a player stands, at chest height — the point that has to be on
 * screen. Lives here rather than in `camera.ts` because nothing but this
 * test needs it, and a production export that exists for a test is just a
 * test in the wrong file. */
const playerAnchor = (
	side: "near" | "far",
	x: number,
	z = side === "near" ? BASELINE_Z : -BASELINE_Z,
): Vec3Mutable => ({
	x: Math.max(-SINGLES_HALF_WIDTH, Math.min(SINGLES_HALF_WIDTH, x)),
	y: 0.9,
	z,
});

/** The avatar is about 1.8m of person standing on the court, and a camera
 * that frames its chest and nothing else still cuts its legs off. */
const PLAYER_FEET = 0.05;
const PLAYER_HEAD = 1.8;

/** 16:9, the shape of nearly every screen this will run on. */
const ASPECT = 16 / 9;

const sub = (a: Vec3Mutable, b: Vec3Mutable): Vec3Mutable => ({
	x: a.x - b.x,
	y: a.y - b.y,
	z: a.z - b.z,
});
const dot = (a: Vec3Mutable, b: Vec3Mutable) =>
	a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a: Vec3Mutable) => Math.sqrt(dot(a, a));
const norm = (a: Vec3Mutable): Vec3Mutable => {
	const l = len(a) || 1;
	return { x: a.x / l, y: a.y / l, z: a.z / l };
};
const cross = (a: Vec3Mutable, b: Vec3Mutable): Vec3Mutable => ({
	x: a.y * b.z - a.z * b.y,
	y: a.z * b.x - a.x * b.z,
	z: a.x * b.y - a.y * b.x,
});

/**
 * Is `point` inside the camera's view? Builds the camera basis the same way
 * a `lookAt` with a Y-up world does, then checks the point's angle from the
 * view axis against the half-FOV vertically and horizontally.
 */
function isVisible(
	pose: CameraPose,
	point: Vec3Mutable,
	aspect = ASPECT,
): boolean {
	const forward = norm(sub(pose.target, pose.position));
	const right = norm(cross(forward, { x: 0, y: 1, z: 0 }));
	const up = cross(right, forward);

	const v = sub(point, pose.position);
	const depth = dot(v, forward);
	if (depth <= 0) return false; // behind the camera

	const halfV = (pose.fov / 2) * (Math.PI / 180);
	const halfH = Math.atan(Math.tan(halfV) * aspect);

	return (
		Math.abs(Math.atan2(dot(v, up), depth)) <= halfV &&
		Math.abs(Math.atan2(dot(v, right), depth)) <= halfH
	);
}

const BALL_AT_NET = { ballX: 0, ballZ: 0 };

describe("cameraPose", () => {
	/** Follow is excluded on purpose — see the note on it in camera.ts. */
	const BOTH_PLAYER_MODES = CAMERA_MODES.filter((m) => m !== "follow");

	it.each(BOTH_PLAYER_MODES)("frames both players in %s mode", (mode) => {
		const pose = cameraPose(mode, BALL_AT_NET);
		expect(isVisible(pose, playerAnchor("near", 0))).toBe(true);
		expect(isVisible(pose, playerAnchor("far", 0))).toBe(true);
	});

	it.each(BOTH_PLAYER_MODES)(
		"keeps both players in frame in %s mode even out at the sidelines",
		(mode) => {
			const pose = cameraPose(mode, { ballX: SINGLES_HALF_WIDTH, ballZ: 0 });
			expect(isVisible(pose, playerAnchor("near", SINGLES_HALF_WIDTH))).toBe(
				true,
			);
			expect(isVisible(pose, playerAnchor("far", -SINGLES_HALF_WIDTH))).toBe(
				true,
			);
		},
	);

	it("keeps the hitter in frame while following the ball to their end", () => {
		// The one promise follow does make: you can see who is about to hit.
		for (const z of [-BASELINE_Z, -6, 0, 6, BASELINE_Z]) {
			const pose = cameraPose("follow", { ballX: 0, ballZ: z });
			const hitter = z < 0 ? "far" : "near";
			expect(isVisible(pose, playerAnchor(hitter, 0))).toBe(true);
		}
	});

	// Players stopped living on their baselines on 2026-09-21
	// (llm-knowledge/decisions/0014-players-run-to-the-ball.md): they run in
	// for a short ball and back for a deep one, anywhere from NET_KEEP_OUT to
	// BASELINE_Z + RUN_BACK. Watched in a screenshot: the near player, having
	// run back for a deep ball, was cut off at the bottom of the frame with
	// their legs off screen. Nothing was wrong with the camera — it was
	// framing a range that no longer matched where players go.
	it.each(BOTH_PLAYER_MODES)(
		"frames a player whole, anywhere they can actually stand, in %s mode",
		(mode) => {
			const pose = cameraPose(mode, BALL_AT_NET);
			for (const depth of [
				NET_KEEP_OUT,
				4,
				8,
				BASELINE_Z,
				BASELINE_Z + RUN_BACK,
			]) {
				for (const side of ["near", "far"] as const) {
					const z = side === "near" ? depth : -depth;
					// Feet AND head. Checking chest height alone passes while
					// the legs hang off the bottom of the screen, which is
					// exactly what the screenshot showed.
					for (const y of [PLAYER_FEET, PLAYER_HEAD]) {
						const at = { ...playerAnchor(side, 0, z), y };
						expect(isVisible(pose, at), `${side} at z=${z}, y=${y}`).toBe(true);
					}
				}
			}
		},
	);

	it("keeps the ball in frame all the way down the court in every mode", () => {
		for (const mode of CAMERA_MODES) {
			for (let z = -BASELINE_Z; z <= BASELINE_Z; z += 1) {
				const pose = cameraPose(mode, { ballX: 0, ballZ: z });
				expect(isVisible(pose, { x: 0, y: 1.5, z })).toBe(true);
			}
		}
	});

	/**
	 * The bug this file exists for, as a number. Apparent size goes as 1/distance,
	 * so the ratio of the two players' distances IS the ratio of their heights on
	 * screen. The old camera scored 0.25: the far player was a quarter the size of
	 * the near one, which is what "you can only see one character" looks like from
	 * behind a baseline.
	 */
	it("renders both players at comparable size in broadcast mode", () => {
		const pose = cameraPose("broadcast", BALL_AT_NET);
		const distance = (side: "near" | "far") =>
			len(sub(playerAnchor(side, 0), pose.position));
		expect(distance("near") / distance("far")).toBeGreaterThan(0.5);
		// And the guard actually bites: the camera this replaced scored 0.25.
		const old = {
			position: { x: 0, y: 4.4, z: BASELINE_Z + 7.5 },
			target: { x: 0, y: 1.2, z: -BASELINE_Z * 0.35 },
			fov: 55,
		};
		const oldDistance = (side: "near" | "far") =>
			len(sub(playerAnchor(side, 0), old.position));
		expect(oldDistance("near") / oldDistance("far")).toBeLessThan(0.3);
	});

	it("never puts the camera under the court", () => {
		for (const mode of CAMERA_MODES) {
			expect(cameraPose(mode, BALL_AT_NET).position.y).toBeGreaterThan(1);
		}
	});

	it("cycles modes and comes back round", () => {
		let mode = CAMERA_MODES[0] ?? "broadcast";
		for (let i = 0; i < CAMERA_MODES.length; i++) mode = nextMode(mode);
		expect(mode).toBe(CAMERA_MODES[0]);
	});
});

/** Where `point` lands across the frame, -1 at the left edge to 1 at the
 * right, the same basis `isVisible` builds. */
function screenX(
	pose: CameraPose,
	point: Vec3Mutable,
	aspect = ASPECT,
): number {
	const forward = norm(sub(pose.target, pose.position));
	const right = norm(cross(forward, { x: 0, y: 1, z: 0 }));
	const v = sub(point, pose.position);
	const halfH = Math.atan(Math.tan((pose.fov / 2) * (Math.PI / 180)) * aspect);
	return Math.tan(Math.atan2(dot(v, right), dot(v, forward))) / Math.tan(halfH);
}

describe("attractPose", () => {
	// The lobby is a title screen: the join panel owns the left of the frame
	// and the court plays itself on the right. Sampled across a whole loop.
	const SAMPLES = Array.from(
		{ length: 48 },
		(_, i) => (i / 48) * ATTRACT_PERIOD,
	);
	const CORNERS: Vec3Mutable[] = [
		{ x: -SINGLES_HALF_WIDTH, y: 0, z: -BASELINE_Z },
		{ x: SINGLES_HALF_WIDTH, y: 0, z: -BASELINE_Z },
		{ x: -SINGLES_HALF_WIDTH, y: 0, z: BASELINE_Z },
		{ x: SINGLES_HALF_WIDTH, y: 0, z: BASELINE_Z },
	];

	// 16:10 as well as 16:9: the host is a MacBook, and every MacBook
	// screen is 16:10 — narrower, so the court's far corner went off the
	// right edge in a screenshot while a 16:9 check passed.
	it.each([
		["16:9", 16 / 9],
		["16:10", 16 / 10],
	])("keeps the whole court in frame for the whole loop at %s", (_, aspect) => {
		for (const t of SAMPLES) {
			for (const corner of CORNERS) {
				expect(isVisible(attractPose(t), corner, aspect)).toBe(true);
				expect(screenX(attractPose(t), corner, aspect)).toBeLessThan(0.96);
			}
		}
	});

	// The panel's content is 43.5rem wide, which is 0.48 of a 16:9 frame at
	// the lobby's rem scale — so its right edge sits at -0.04 in these units.
	// Seen: at -0.15 the near player stood behind the seat cards.
	it.each([
		["16:9", 16 / 9],
		["16:10", 16 / 10],
	])("keeps the court clear of the join panel at %s", (_, aspect) => {
		for (const t of SAMPLES) {
			const pose = attractPose(t);
			expect(screenX(pose, { x: 0, y: 0, z: 0 }, aspect)).toBeGreaterThan(0.3);
			for (const corner of CORNERS) {
				expect(screenX(pose, corner, aspect)).toBeGreaterThan(0.02);
			}
		}
	});

	it("loops without a seam", () => {
		const a = attractPose(3);
		const b = attractPose(3 + ATTRACT_PERIOD);
		expect(b.position.x).toBeCloseTo(a.position.x, 6);
		expect(b.position.z).toBeCloseTo(a.position.z, 6);
		expect(b.target.x).toBeCloseTo(a.target.x, 6);
	});

	it("drifts, never lurches", () => {
		// A title-screen camera that moves faster than a slow walk reads as a
		// replay, not as a backdrop.
		for (const t of SAMPLES) {
			const a = attractPose(t).position;
			const b = attractPose(t + 0.1).position;
			expect(len(sub(b, a)) / 0.1).toBeLessThan(1.6);
		}
	});
});
