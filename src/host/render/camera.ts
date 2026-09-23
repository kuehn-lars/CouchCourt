/**
 * Where the camera is and what it looks at, as plain numbers. No Three.js
 * here on purpose: this is the one part of the visual stack that is real
 * geometry, it is the part that was wrong, and it is therefore the part
 * worth testing (`CLAUDE.md` §3).
 *
 * `scene.ts` eases toward whatever this returns and hands it to a
 * `PerspectiveCamera`. Nothing else reads it.
 *
 * ## Why this file exists
 *
 * The original camera sat 4.4m up, 7.5m behind the near baseline, looking at
 * a point a third of the way down the court. `llm-knowledge/modules/host.md`
 * rule 7 defended it as deliberate. It is: it is also a camera from which
 * the far player is a speck at the top of frame and the near player is
 * mostly off the bottom, which is the complaint that started this session.
 *
 * The fix is not a different constant, it is framing the thing the game is
 * about: **both baselines, both players, and the ball between them.**
 */

import { BASELINE_Z, NET_POST_X } from "../../shared/sim/court.ts";

export type CameraMode = "broadcast" | "follow" | "side";

export const CAMERA_MODES: readonly CameraMode[] = [
	"broadcast",
	"follow",
	"side",
];

export interface Vec3Mutable {
	x: number;
	y: number;
	z: number;
}

export interface CameraPose {
	readonly position: Vec3Mutable;
	readonly target: Vec3Mutable;
	/** Vertical field of view, degrees. Per mode: the broadcast view is a
	 * long lens and the others are not, and that difference is most of why
	 * it looks like tennis. */
	readonly fov: number;
}

export interface CameraInput {
	/** Interpolated ball position, metres. Height is not read: no mode
	 * follows the ball upward, because a camera that tilts with a lob is a
	 * camera that loses the court. */
	readonly ballX: number;
	readonly ballZ: number;
}

/**
 * Broadcast: a **long lens from a long way back**, which is the actual
 * reason tennis on television looks the way it does, and the fix for the
 * complaint that started this.
 *
 * The old camera was 7.5m behind the baseline with a 55° field of view. The
 * near player was 7.9m away and the far player 31.5m, so the far player
 * rendered at **0.25x** the near player's apparent height — one character
 * filling the bottom of the frame and a dot at the top. Moving back and
 * narrowing the lens compresses that ratio without changing how much court
 * is in frame: at 26m back with a 28° lens the distances are 27.7m and
 * 50.7m, a ratio of **0.55**. Both players read at the same scale.
 *
 * `camera.test.ts` holds that ratio as a regression guard — it is the one
 * number that describes the bug.
 *
 * The 19° lens (rather than the 28° first tried) is what makes the court
 * fill the frame: at 28° the court spanned barely a third of the picture
 * height with empty sky above and below it. At 19° the near baseline sits at
 * 0.89 of the way to the bottom edge, the far baseline at 0.21 above centre,
 * and a 7m lob still clears the top with room. Measured, not eyeballed.
 *
 * `BROADCAST_BACK` went from 26 to 28 on 2026-09-21, for a reason that did
 * not exist when it was 26: players stopped standing on their baselines
 * ([[0014-players-run-to-the-ball]]) and can now be `RUN_BACK` behind them.
 * At 26 the near baseline was already 0.89 of the way to the bottom edge, so
 * a player who had run back for a deep ball had their legs off the screen —
 * seen in a screenshot, not derived. Swept height × distance × lens against
 * the frustum for every position a player can now occupy, feet and head,
 * across the camera's full lateral drift: 26 fails at every height and lens,
 * 28 is the nearest that holds, and it nudges the both-players-in-scale
 * ratio from 0.55 to 0.564 rather than costing anything.
 */
const BROADCAST_HEIGHT = 11;
const BROADCAST_BACK = 28;
const BROADCAST_FOV = 19;
const BROADCAST_TARGET_Z = 0;
const BROADCAST_TARGET_Y = 1.2;
/** How far the camera slides sideways with the ball, as a fraction of the
 * ball's own x. A nudge for parallax, not a follow. */
const BROADCAST_DRIFT = 0.28;

/**
 * Follow: tracks the ball down the court. More dramatic, and it is the one
 * mode that does **not** promise both players in frame — a camera that
 * always frames both players is the broadcast camera, so asking follow for
 * that is asking for a second copy of it. What it does promise is the ball
 * and whoever is about to hit it (`camera.test.ts`).
 */
const FOLLOW_HEIGHT = 6.0;
const FOLLOW_BACK = 11.5;
const FOLLOW_FOV = 52;
const FOLLOW_TRACK_Z = 0.25;
const FOLLOW_DRIFT = 0.55;
/** How far past the ball the follow camera looks. */
const FOLLOW_LEAD = 10;

/** Side: square on from the umpire's side. Fair to both players and the
 * easiest view for judging the ball's height over the net, at the cost of
 * the depth cue the game is built on. */
const SIDE_DISTANCE = 20;
const SIDE_HEIGHT = 6.0;
/** Wide enough to fit baseline to baseline at that distance: the court is
 * 23.77m long and the camera is 20m away, so the horizontal half-angle has
 * to clear 31°. */
const SIDE_FOV = 46;

const clamp = (x: number, lo: number, hi: number) =>
	Math.max(lo, Math.min(hi, x));

/** The pose for `mode`, given where the ball is. Pure. */
export function cameraPose(mode: CameraMode, input: CameraInput): CameraPose {
	const ballX = clamp(input.ballX, -NET_POST_X, NET_POST_X);

	if (mode === "side") {
		return {
			position: { x: SIDE_DISTANCE, y: SIDE_HEIGHT, z: 0 },
			target: { x: 0, y: 1.1, z: clamp(input.ballZ, -6, 6) * 0.25 },
			fov: SIDE_FOV,
		};
	}

	if (mode === "follow") {
		// Sits behind the ball's own end of the court, so a rally sweeps the
		// camera up and down rather than teleporting it between hitters.
		const z = clamp(input.ballZ, -BASELINE_Z, BASELINE_Z);
		return {
			position: {
				x: ballX * FOLLOW_DRIFT,
				y: FOLLOW_HEIGHT,
				z: BASELINE_Z + FOLLOW_BACK - (BASELINE_Z - z) * FOLLOW_TRACK_Z,
			},
			target: {
				x: ballX * 0.5,
				y: 1.2,
				z: clamp(z - FOLLOW_LEAD, -BASELINE_Z, 2),
			},
			fov: FOLLOW_FOV,
		};
	}

	return {
		position: {
			x: ballX * BROADCAST_DRIFT,
			y: BROADCAST_HEIGHT,
			z: BASELINE_Z + BROADCAST_BACK,
		},
		target: {
			// The SAME x as the camera: a pure lateral dolly, no pan. Tracking
			// the target at half the camera's drift turns the dolly into a
			// slight inward rotation, and the court visibly skews across the
			// frame on a wide rally — seen happening, then fixed.
			x: ballX * BROADCAST_DRIFT,
			y: BROADCAST_TARGET_Y,
			z: BROADCAST_TARGET_Z,
		},
		fov: BROADCAST_FOV,
	};
}

/**
 * Attract: the lobby's title-screen camera. The court plays itself behind
 * the join panel, so this is a slow crane round the corner of the court —
 * swinging gently either side of a high three-quarter view — rather than any
 * of the match cameras. The target is pushed off to the camera's left by
 * `ATTRACT_OFFSET`, which puts the court in the right of the frame and leaves
 * the left to the panel (`ui/lobby.ts`).
 *
 * Seconds in, pose out, and a whole number of loops per `ATTRACT_PERIOD`, so
 * the lobby can sit for an hour without the move ever snapping back.
 */
export const ATTRACT_PERIOD = 64;
const ATTRACT_RADIUS = 44;
const ATTRACT_HEIGHT = 22;
const ATTRACT_FOV = 40;
/** Centre of the swing and how far it goes either way, radians from
 * straight behind the near baseline. */
const ATTRACT_MID = (30 * Math.PI) / 180;
const ATTRACT_SWING = (14 * Math.PI) / 180;
const ATTRACT_OFFSET = 15;
/** Looking at a point below the floor lifts the court to the middle of the
 * frame instead of the bottom third. All seven numbers were swept together
 * against the same projection `camera.test.ts` uses, then picked by eye. */
const ATTRACT_LOOK_Y = -3;

export function attractPose(seconds: number): CameraPose {
	const phase = (seconds / ATTRACT_PERIOD) * Math.PI * 2;
	const angle = ATTRACT_MID + ATTRACT_SWING * Math.sin(phase);
	const sin = Math.sin(angle);
	const cos = Math.cos(angle);
	// The camera's own right, level with the ground, while it looks at the
	// middle of the court.
	return {
		position: {
			x: ATTRACT_RADIUS * sin,
			y: ATTRACT_HEIGHT,
			z: ATTRACT_RADIUS * cos,
		},
		target: {
			x: -ATTRACT_OFFSET * cos,
			y: ATTRACT_LOOK_Y,
			z: ATTRACT_OFFSET * sin,
		},
		fov: ATTRACT_FOV,
	};
}

/** The next mode in the cycle, for the key handler in `main.ts`. */
export function nextMode(mode: CameraMode): CameraMode {
	const i = CAMERA_MODES.indexOf(mode);
	return CAMERA_MODES[(i + 1) % CAMERA_MODES.length] ?? "broadcast";
}
