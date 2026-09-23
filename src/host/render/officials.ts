/**
 * The people who are not playing: the chair umpire up on their chair at the
 * net, and four ball kids — two crouched at the net, two at the back
 * corners. Built from the same rig as the players (`athlete.ts`), without a
 * racket.
 *
 * They do one thing, and it is the thing that makes a court feel inhabited:
 * **they watch the ball.** Every head turns to follow it. Nobody consciously
 * notices, and a court without it feels like a diorama.
 */

import * as THREE from "three";
import {
	BASELINE_Z,
	NET_POST_X,
	SINGLES_HALF_WIDTH,
} from "../../shared/sim/court.ts";
import { type Athlete, buildAthlete, SCALE } from "./athlete.ts";
import { JOINT_INDEX, makePose, POSE_LENGTH, READY } from "./poses.ts";
import { outline, toon } from "./toon.ts";

const UMPIRE_X = NET_POST_X + 1.5;
const FOOTREST = 1.25;

/** Sitting: thighs level, shins hanging, hands on the knees. */
const SEATED = makePose({
	torso: [-0.05, 0, 0],
	shoulderR: [0.55, 0.15, 0.1],
	elbowR: [0.9, 0, 0],
	shoulderL: [0.55, -0.15, -0.1],
	elbowL: [0.9, 0, 0],
	hipR: [1.5, 0, 0.12],
	kneeR: [-1.45, 0, 0],
	hipL: [1.5, 0, -0.12],
	kneeL: [-1.45, 0, 0],
});

/** A ball kid at the net: down on their haunches, hands on knees. */
const CROUCH = makePose(
	{
		torso: [-0.55, 0, 0],
		head: [0.45, 0, 0],
		shoulderR: [0.75, 0.2, 0.1],
		elbowR: [0.5, 0, 0],
		shoulderL: [0.75, -0.2, -0.1],
		elbowL: [0.5, 0, 0],
		hipR: [1.25, 0, 0.3],
		kneeR: [-2.0, 0, 0],
		hipL: [1.25, 0, -0.3],
		kneeL: [-2.0, 0, 0],
	},
	READY,
);

/** Standing at a back corner, hands behind the back. */
const WAITING = makePose({
	torso: [-0.08, 0, 0],
	shoulderR: [-0.35, 0, 0.1],
	elbowR: [0.7, 0, 0],
	shoulderL: [-0.35, 0, -0.1],
	elbowL: [0.7, 0, 0],
	hipR: [0, 0, 0.08],
	hipL: [0, 0, -0.08],
});

function chair(): THREE.Group {
	const group = new THREE.Group();
	const frame = toon("#0e2233", { rimStrength: 0.35 });
	const accent = toon("#dcff4a", { rimStrength: 0.2 });
	const leg = new THREE.BoxGeometry(0.08, FOOTREST + 0.5, 0.08);
	for (const [x, z] of [
		[-0.32, -0.32],
		[0.32, -0.32],
		[-0.32, 0.32],
		[0.32, 0.32],
	] as const) {
		const m = new THREE.Mesh(leg, frame);
		m.position.set(x, (FOOTREST + 0.5) / 2, z);
		m.castShadow = true;
		outline(m, 0.012);
		group.add(m);
	}
	const seat = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.1, 0.8), frame);
	seat.position.set(0, FOOTREST + 0.5, 0);
	seat.castShadow = true;
	outline(seat, 0.012);
	group.add(seat);
	const back = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.7, 0.8), frame);
	back.position.set(0.38, FOOTREST + 0.9, 0);
	back.castShadow = true;
	outline(back, 0.012);
	group.add(back);
	const rest = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.8), accent);
	rest.position.set(-0.32, FOOTREST, 0);
	group.add(rest);
	const panel = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.9), accent);
	panel.position.set(-0.4, FOOTREST + 0.3, 0);
	group.add(panel);
	return group;
}

interface Watcher {
	readonly athlete: Athlete;
	readonly pose: Float32Array;
	readonly base: Float32Array;
	/** World yaw the rig faces, radians. */
	readonly facing: number;
	yaw: number;
	pitch: number;
}

export interface Officials {
	readonly group: THREE.Group;
	/** Every head turns toward the ball. */
	update(ball: { x: number; y: number; z: number }, dt: number): void;
}

const KID = {
	shirt: "#12344f",
	trim: "#dcff4a",
	shorts: "#12344f",
	skin: "#d59a6a",
	hair: "#1d140e",
	headwear: "cap",
	racket: false,
} as const;

export function buildOfficials(): Officials {
	const group = new THREE.Group();
	const watchers: Watcher[] = [];

	const add = (
		athlete: Athlete,
		base: Float32Array,
		x: number,
		y: number,
		z: number,
		facing: number,
		scale = 1,
	) => {
		athlete.root.position.set(x, y, z);
		athlete.root.rotation.y = facing;
		athlete.root.scale.setScalar(SCALE * scale);
		group.add(athlete.root);
		const pose = new Float32Array(POSE_LENGTH);
		pose.set(base);
		athlete.apply(pose);
		watchers.push({ athlete, pose, base, facing, yaw: 0, pitch: 0 });
	};

	const seat = chair();
	seat.position.set(UMPIRE_X, 0, 0);
	group.add(seat);
	add(
		buildAthlete({
			shirt: "#0c1b2a",
			trim: "#e8eef4",
			shorts: "#26323f",
			skin: "#c98f63",
			hair: "#5a5f66",
			headwear: "none",
			racket: false,
		}),
		SEATED,
		UMPIRE_X - 0.05,
		FOOTREST - 0.02,
		0,
		Math.PI / 2,
	);

	const netX = -(NET_POST_X + 0.9);
	add(buildAthlete(KID), CROUCH, netX, 0, 0.9, -Math.PI / 2, 0.8);
	add(buildAthlete(KID), CROUCH, netX, 0, -0.9, -Math.PI / 2, 0.8);
	const cornerX = SINGLES_HALF_WIDTH + 3.2;
	const cornerZ = BASELINE_Z + 4.8;
	add(buildAthlete(KID), WAITING, cornerX, 0, cornerZ, Math.PI * 0.8, 0.8);
	add(buildAthlete(KID), WAITING, -cornerX, 0, -cornerZ, -Math.PI * 0.2, 0.8);

	const head = JOINT_INDEX.head;
	return {
		group,
		update(ball, dt) {
			const k = 1 - Math.exp(-dt * 6);
			for (const w of watchers) {
				const at = w.athlete.root.position;
				const dx = ball.x - at.x;
				const dz = ball.z - at.z;
				// The rig faces -z in its own frame, turned by `facing`.
				const world = Math.atan2(-dx, -dz);
				let yaw = world - w.facing;
				yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
				yaw = Math.max(-1.2, Math.min(1.2, yaw));
				const pitch = Math.max(
					-0.4,
					Math.min(0.6, Math.atan2(ball.y - at.y - 1.5, Math.hypot(dx, dz))),
				);
				w.yaw += (yaw - w.yaw) * k;
				w.pitch += (pitch - w.pitch) * k;
				w.pose[head] = (w.base[head] ?? 0) + w.pitch;
				w.pose[head + 1] = w.yaw;
				w.athlete.apply(w.pose);
			}
		},
	};
}
