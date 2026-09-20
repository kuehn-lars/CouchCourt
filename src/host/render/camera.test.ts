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
import {
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
const playerAnchor = (side: "near" | "far", x: number): Vec3Mutable => ({
	x: Math.max(-SINGLES_HALF_WIDTH, Math.min(SINGLES_HALF_WIDTH, x)),
	y: 0.9,
	z: side === "near" ? BASELINE_Z : -BASELINE_Z,
});

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
function isVisible(pose: CameraPose, point: Vec3Mutable): boolean {
	const forward = norm(sub(pose.target, pose.position));
	const right = norm(cross(forward, { x: 0, y: 1, z: 0 }));
	const up = cross(right, forward);

	const v = sub(point, pose.position);
	const depth = dot(v, forward);
	if (depth <= 0) return false; // behind the camera

	const halfV = (pose.fov / 2) * (Math.PI / 180);
	const halfH = Math.atan(Math.tan(halfV) * ASPECT);

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
