/**
 * Body poses and the clips made of them, as plain numbers. No Three.js here:
 * the rig (`athlete.ts`) reads a `Pose` and turns it into joint rotations,
 * and everything about *which* pose, blended how, is arithmetic that can be
 * tested without a GPU (`poses.test.ts`).
 *
 * ## The frame every angle is written in
 *
 * A right-handed player standing at the near baseline: facing -z (the net),
 * right hand at +x, up +y. The far player's whole rig is yawed by PI, so
 * nothing here is ever mirrored per side.
 *
 * - `x` on a limb swings it **forward** (toward -z) from hanging straight
 *   down; on the torso and head a positive `x` leans **back**.
 * - `y` turns about the vertical. On the torso, positive turns the right
 *   shoulder forward (a forehand opening up); on a raised arm it sweeps the
 *   arm toward the player's left.
 * - `z` on the right arm or leg lifts it **out** to the right; on the left
 *   limbs, out is negative.
 * - Knees bend with a negative `x`; elbows with a positive one.
 *
 * Feet are put on the ground by the rig, not here: `lift` is only ever a
 * jump.
 */

export const JOINTS = [
	"pelvis",
	"torso",
	"head",
	"shoulderR",
	"elbowR",
	"wristR",
	"shoulderL",
	"elbowL",
	"wristL",
	"hipR",
	"kneeR",
	"hipL",
	"kneeL",
] as const;

export type Joint = (typeof JOINTS)[number];

/** Index of each joint's first angle in a `Pose` array. */
export const JOINT_INDEX: Readonly<Record<Joint, number>> = Object.fromEntries(
	JOINTS.map((joint, i) => [joint, 1 + i * 3]),
) as Record<Joint, number>;

/** `[lift, pelvis.xyz, torso.xyz, …]`. A flat typed array so a frame of
 * blending allocates nothing. */
export type Pose = Float32Array;
export const POSE_LENGTH = 1 + JOINTS.length * 3;

type Angles = readonly [number, number, number];
export type PoseSpec = Partial<Record<Joint, Angles>> & { lift?: number };

export function makePose(spec: PoseSpec, base?: Pose): Pose {
	const pose = base ? Float32Array.from(base) : new Float32Array(POSE_LENGTH);
	if (spec.lift !== undefined) pose[0] = spec.lift;
	for (const joint of JOINTS) {
		const angles = spec[joint];
		if (!angles) continue;
		pose.set(angles, JOINT_INDEX[joint]);
	}
	return pose;
}

/** `out = a + (b - a) * t`. `out` may be `a`. */
export function mix(out: Pose, a: Pose, b: Pose, t: number): Pose {
	for (let i = 0; i < POSE_LENGTH; i++) {
		const from = a[i] ?? 0;
		out[i] = from + ((b[i] ?? 0) - from) * t;
	}
	return out;
}

/** First array index belonging to the legs. Everything from here on is
 * hips and knees. */
const LEGS_FROM = JOINT_INDEX.hipR;

/** Like `mix`, but the legs only take `legs` of the blend: a player who
 * swings while running keeps running. `lift` counts as upper body. */
export function mixUpper(
	out: Pose,
	a: Pose,
	b: Pose,
	t: number,
	legs: number,
): Pose {
	for (let i = 0; i < POSE_LENGTH; i++) {
		const from = a[i] ?? 0;
		const w = i >= LEGS_FROM ? t * legs : t;
		out[i] = from + ((b[i] ?? 0) - from) * w;
	}
	return out;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

export interface Key {
	/** 0..1 through the clip. */
	readonly t: number;
	readonly pose: Pose;
}

export interface Clip {
	/** Seconds, start to end. */
	readonly duration: number;
	/** 0..1: the frame where the racket meets the ball. */
	readonly contact: number;
	readonly keys: readonly Key[];
}

/** The pose `t` of the way through `clip`, eased between keys, into `out`.
 * Clamped: before the first key is the first key. */
export function sample(clip: Clip, t: number, out: Pose): Pose {
	const keys = clip.keys;
	const first = keys[0];
	if (!first) return out;
	if (t <= first.t) return mix(out, first.pose, first.pose, 0);
	for (let i = 1; i < keys.length; i++) {
		const to = keys[i];
		const from = keys[i - 1];
		if (!to || !from) break;
		if (t <= to.t) {
			const span = to.t - from.t;
			const u = span > 0 ? (t - from.t) / span : 1;
			return mix(out, from.pose, to.pose, smooth(u));
		}
	}
	const last = keys[keys.length - 1] ?? first;
	return mix(out, last.pose, last.pose, 0);
}

// ------------------------------------------------------------ the poses

/** Standing at ease between points. */
export const STAND = makePose({
	torso: [-0.04, 0, 0],
	shoulderR: [0.35, 0.2, 0.08],
	elbowR: [0.7, 0, 0],
	wristR: [0.5, 0, 0],
	shoulderL: [0.1, 0, -0.1],
	elbowL: [0.25, 0, 0],
	hipR: [0.04, 0, 0.06],
	hipL: [0, 0, -0.06],
	kneeR: [-0.1, 0, 0],
	kneeL: [-0.05, 0, 0],
});

/** The athletic ready position: knees bent, weight forward, racket out in
 * front with the free hand on its throat. */
export const READY = makePose({
	torso: [-0.32, 0, 0],
	head: [0.3, 0, 0],
	shoulderR: [0.85, 0.35, 0.12],
	elbowR: [1.05, 0, 0],
	wristR: [0.8, 0, 0],
	shoulderL: [0.85, -0.45, -0.1],
	elbowL: [1.2, 0, 0],
	hipR: [0.42, 0, 0.16],
	kneeR: [-0.85, 0, 0],
	hipL: [0.42, 0, -0.16],
	kneeL: [-0.85, 0, 0],
});

const LEGS_LOADED = {
	hipR: [0.35, 0, 0.18],
	kneeR: [-0.95, 0, 0],
	hipL: [0.2, 0, -0.12],
	kneeL: [-0.55, 0, 0],
} as const satisfies PoseSpec;

const forehand: Clip = {
	duration: 0.55,
	contact: 0.4,
	keys: [
		{
			t: 0,
			pose: makePose({
				...LEGS_LOADED,
				pelvis: [0, -0.55, 0],
				torso: [-0.2, -0.95, 0],
				head: [0.2, 0.6, 0],
				shoulderR: [0.55, -1.35, 0.35],
				elbowR: [0.55, 0, 0],
				wristR: [1.25, 0, 0.35],
				shoulderL: [1.4, -0.9, 0],
				elbowL: [0.2, 0, 0],
			}),
		},
		{
			t: 0.4,
			pose: makePose({
				pelvis: [0, 0.15, 0],
				torso: [-0.18, 0.05, 0],
				head: [0.15, 0, 0],
				shoulderR: [1.25, -0.35, 0.2],
				elbowR: [0.25, 0, 0],
				wristR: [0.25, 0, 0],
				shoulderL: [0.9, 0.2, 0],
				elbowL: [0.6, 0, 0],
				hipR: [0.2, 0, 0.12],
				kneeR: [-0.55, 0, 0],
				hipL: [0.35, 0, -0.12],
				kneeL: [-0.45, 0, 0],
			}),
		},
		{
			t: 1,
			pose: makePose({
				pelvis: [0, 0.6, 0],
				torso: [-0.12, 1.0, 0],
				head: [0.1, -0.5, 0],
				shoulderR: [2.3, 1.15, 0],
				elbowR: [1.55, 0, 0],
				wristR: [0.5, 0, 0],
				shoulderL: [0.35, 0.3, 0],
				elbowL: [1.4, 0, 0],
				hipR: [-0.15, 0, 0.1],
				kneeR: [-0.6, 0, 0],
				hipL: [0.3, 0, -0.1],
				kneeL: [-0.25, 0, 0],
			}),
		},
	],
};

/** Two-handed: both arms come round together. */
const backhand: Clip = {
	duration: 0.55,
	contact: 0.4,
	keys: [
		{
			t: 0,
			pose: makePose({
				...LEGS_LOADED,
				pelvis: [0, 0.6, 0],
				torso: [-0.22, 1.1, 0],
				head: [0.2, -0.7, 0],
				shoulderR: [0.85, 1.0, 0],
				elbowR: [0.45, 0, 0],
				wristR: [1.2, 0, -0.3],
				shoulderL: [0.6, 1.3, -0.25],
				elbowL: [0.95, 0, 0],
			}),
		},
		{
			t: 0.4,
			pose: makePose({
				pelvis: [0, -0.1, 0],
				torso: [-0.18, -0.1, 0],
				head: [0.15, 0, 0],
				shoulderR: [1.2, 0.45, 0],
				elbowR: [0.2, 0, 0],
				wristR: [0.2, 0, 0],
				shoulderL: [1.2, 0.7, 0],
				elbowL: [0.6, 0, 0],
				hipR: [0.35, 0, 0.12],
				kneeR: [-0.45, 0, 0],
				hipL: [0.2, 0, -0.12],
				kneeL: [-0.55, 0, 0],
			}),
		},
		{
			t: 1,
			pose: makePose({
				pelvis: [0, -0.6, 0],
				torso: [-0.1, -1.05, 0],
				head: [0.1, 0.5, 0],
				shoulderR: [2.3, -0.9, 0],
				elbowR: [1.2, 0, 0],
				wristR: [0.6, 0, 0],
				shoulderL: [2.2, -0.6, 0],
				elbowL: [1.6, 0, 0],
				hipR: [0.3, 0, 0.1],
				kneeR: [-0.25, 0, 0],
				hipL: [-0.15, 0, -0.1],
				kneeL: [-0.6, 0, 0],
			}),
		},
	],
};

/** The trophy position: tossing arm up, racket behind the head, knees
 * loaded. Held while the ball is in the air on a serve. */
export const TROPHY = makePose({
	torso: [0.35, -0.55, 0.12],
	head: [0.45, 0.3, 0],
	shoulderR: [0.5, -1.2, 1.3],
	elbowR: [1.9, 0, 0],
	wristR: [1.4, 0, 0],
	shoulderL: [3.0, 0, 0.1],
	elbowL: [0.05, 0, 0],
	hipR: [0.35, 0, 0.1],
	kneeR: [-0.95, 0, 0],
	hipL: [0.3, 0, -0.1],
	kneeL: [-0.8, 0, 0],
});

function overheadClip(jump: number): Clip {
	return {
		duration: 0.7,
		contact: 0.35,
		keys: [
			{ t: 0, pose: TROPHY },
			{
				t: 0.35,
				pose: makePose({
					lift: jump,
					torso: [-0.2, 0.2, 0],
					head: [0.5, 0, 0],
					shoulderR: [2.9, 0, 0.15],
					elbowR: [0.1, 0, 0],
					wristR: [0.35, 0, 0],
					shoulderL: [1.0, 0, -0.2],
					elbowL: [1.2, 0, 0],
					hipR: [0.05, 0, 0.05],
					kneeR: [-0.15, 0, 0],
					hipL: [0.1, 0, -0.05],
					kneeL: [-0.25, 0, 0],
				}),
			},
			{
				t: 1,
				pose: makePose({
					torso: [-0.6, 0.7, 0],
					head: [0, 0, 0],
					shoulderR: [0.5, 1.0, 0],
					elbowR: [0.4, 0, 0],
					wristR: [0.3, 0, 0],
					shoulderL: [0.3, 0, -0.1],
					elbowL: [0.8, 0, 0],
					hipR: [-0.35, 0, 0.1],
					kneeR: [-0.65, 0, 0],
					hipL: [0.55, 0, -0.1],
					kneeL: [-0.45, 0, 0],
				}),
			},
		],
	};
}

/** A block, not a swing: a short punch with a step in. */
const volley: Clip = {
	duration: 0.32,
	contact: 0.45,
	keys: [
		{
			t: 0,
			pose: makePose(
				{
					torso: [-0.3, -0.3, 0],
					shoulderR: [1.0, -0.55, 0.2],
					elbowR: [1.0, 0, 0],
					wristR: [0.95, 0, 0],
				},
				READY,
			),
		},
		{
			t: 0.45,
			pose: makePose(
				{
					torso: [-0.28, 0.05, 0],
					shoulderR: [1.35, -0.15, 0.1],
					elbowR: [0.5, 0, 0],
					wristR: [0.6, 0, 0],
					hipL: [0.65, 0, -0.12],
					kneeL: [-0.6, 0, 0],
				},
				READY,
			),
		},
		{
			t: 1,
			pose: makePose(
				{
					shoulderR: [1.4, 0.2, 0],
					elbowR: [0.6, 0, 0],
					wristR: [0.7, 0, 0],
				},
				READY,
			),
		},
	],
};

/** A point won: racket up, fist pump, a hop. */
const celebrate: Clip = {
	duration: 1.6,
	contact: 0,
	keys: [
		{ t: 0, pose: STAND },
		{
			t: 0.14,
			pose: makePose({
				lift: 0.28,
				torso: [0.15, 0.2, 0],
				head: [0.4, 0, 0],
				shoulderR: [2.9, 0, 0.45],
				elbowR: [0.5, 0, 0],
				wristR: [0.4, 0, 0],
				shoulderL: [1.3, -0.9, -0.2],
				elbowL: [2.3, 0, 0],
				hipR: [0.5, 0, 0.1],
				kneeR: [-1.0, 0, 0],
				hipL: [0.1, 0, -0.1],
				kneeL: [-0.3, 0, 0],
			}),
		},
		{
			t: 0.32,
			pose: makePose({
				torso: [-0.35, -0.2, 0],
				head: [0.1, 0, 0],
				shoulderR: [0.6, 0.3, 0.3],
				elbowR: [0.8, 0, 0],
				wristR: [0.4, 0, 0],
				shoulderL: [0.9, -0.7, -0.35],
				elbowL: [2.4, 0, 0],
				hipR: [0.5, 0, 0.2],
				kneeR: [-1.0, 0, 0],
				hipL: [0.5, 0, -0.2],
				kneeL: [-1.0, 0, 0],
			}),
		},
		{
			t: 0.5,
			pose: makePose({
				torso: [-0.2, 0, 0],
				shoulderR: [0.6, 0.3, 0.3],
				elbowR: [0.8, 0, 0],
				wristR: [0.4, 0, 0],
				shoulderL: [1.5, -0.7, -0.35],
				elbowL: [2.4, 0, 0],
				hipR: [0.3, 0, 0.15],
				kneeR: [-0.6, 0, 0],
				hipL: [0.3, 0, -0.15],
				kneeL: [-0.6, 0, 0],
			}),
		},
		{ t: 1, pose: STAND },
	],
};

/** A point lost: head down, racket hanging. */
const deject: Clip = {
	duration: 1.6,
	contact: 0,
	keys: [
		{ t: 0, pose: STAND },
		{
			t: 0.25,
			pose: makePose({
				torso: [-0.25, 0.3, 0],
				head: [-0.6, 0.2, 0],
				shoulderR: [0.05, 0, 0.05],
				elbowR: [0.15, 0, 0],
				wristR: [-0.2, 0, 0],
				shoulderL: [0.1, 0, 0.3],
				elbowL: [1.6, 0, 0],
				hipR: [0.05, 0, 0.05],
				kneeR: [-0.1, 0, 0],
				hipL: [-0.05, 0, -0.05],
				kneeL: [-0.05, 0, 0],
			}),
		},
		{
			t: 0.8,
			pose: makePose({
				torso: [-0.2, 0.3, 0],
				head: [-0.5, -0.1, 0],
				shoulderR: [0.05, 0, 0.05],
				elbowR: [0.15, 0, 0],
				wristR: [-0.2, 0, 0],
				shoulderL: [0.1, 0, 0.3],
				elbowL: [1.6, 0, 0],
			}),
		},
		{ t: 1, pose: STAND },
	],
};

/** The strokes, as animations: what `events.ts` asks `players.ts` to play. */
export type StrokeAnim = "forehand" | "backhand" | "serve" | "smash" | "volley";

export type ActionName =
	| "forehand"
	| "backhand"
	| "serve"
	| "smash"
	| "volley"
	| "celebrate"
	| "deject";

export const CLIPS: Readonly<Record<ActionName, Clip>> = {
	forehand,
	backhand,
	serve: overheadClip(0.1),
	smash: overheadClip(0.45),
	volley,
	celebrate,
	deject,
};

/**
 * How far into a stroke to start it, 0..1. A stroke is only known once the
 * ball has been struck, so the take-back has already been drawn by the
 * readying pose (`players.ts`) and playback joins just before the contact
 * frame: the racket visibly meets the ball within a frame or two, then
 * follows through.
 */
export function strokeEntry(clip: Clip): number {
	return Math.max(0, clip.contact - 0.12);
}

// -------------------------------------------------------------- running

/**
 * The running legs and arms at stride `phase` (radians), blended by how hard
 * the player is running (`speed`, 0..1) and how much of it is sideways
 * (`lateral`, 0 straight, 1 a side-shuffle). Pure; writes into `out`.
 *
 * A side-shuffle is not a run turned sideways: the legs open and close
 * rather than swing, which is how a tennis player crosses a baseline while
 * still facing the net.
 */
export function gait(
	phase: number,
	speed: number,
	lateral: number,
	out: Pose,
): Pose {
	const s = Math.sin(phase);
	const c = Math.cos(phase);
	const run = speed * (1 - lateral);
	const side = speed * lateral;
	out.fill(0);
	out[0] = Math.abs(s) * 0.05 * speed;
	const at = JOINT_INDEX;
	// Run: thighs swing, the knee of the leg coming through folds.
	out[at.hipR] = 0.35 + 0.85 * s * run + 0.3 * side;
	out[at.hipL] = 0.35 - 0.85 * s * run + 0.3 * side;
	out[at.kneeR] = -(0.6 + 0.9 * Math.max(0, c) * run + 0.35 * side);
	out[at.kneeL] = -(0.6 + 0.9 * Math.max(0, -c) * run + 0.35 * side);
	// Shuffle: legs open and close.
	out[at.hipR + 2] = 0.12 + 0.28 * Math.max(0, s) * side;
	out[at.hipL + 2] = -(0.12 + 0.28 * Math.max(0, s) * side);
	// Arms pump against the legs; the racket arm less, it is carrying.
	out[at.torso] = -0.3 * run - 0.25 * side;
	out[at.torso + 1] = 0.12 * s * run;
	out[at.head] = 0.25;
	out[at.shoulderL] = 0.5 - 0.7 * s * run + 0.6 * side;
	out[at.shoulderL + 2] = -0.15 - 0.2 * side;
	out[at.elbowL] = 1.5;
	out[at.shoulderR] = 0.65 + 0.35 * s * run + 0.2 * side;
	out[at.shoulderR + 1] = 0.3;
	out[at.shoulderR + 2] = 0.12;
	out[at.elbowR] = 1.1;
	out[at.wristR] = 0.8;
	return out;
}
