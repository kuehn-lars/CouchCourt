/**
 * The moving pieces: the ball (plus its blob shadow and trail) and the two
 * players. Everything here is built once; per frame only `.position`,
 * `.rotation` and `.scale` are mutated — no `new THREE.*` inside the render
 * loop, per `llm-knowledge/modules/host.md`'s renderer rule 2.
 *
 * Every visual reads the interpolated position (`lerp(prev, cur, alpha)`),
 * never the raw sim state directly, per the same note's rule 1 — that is
 * what makes a fixed-step sim look smooth on a variable-rate display.
 */

import * as THREE from "three";
import type { Side } from "../../shared/protocol.ts";
import { BALL_RADIUS } from "../../shared/sim/court.ts";
import type { Ball, Player, Vec3 } from "../../shared/sim/state.ts";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpVec = (a: Vec3, b: Vec3, t: number): Vec3 => ({
	x: lerp(a.x, b.x, t),
	y: lerp(a.y, b.y, t),
	z: lerp(a.z, b.z, t),
});
const clamp = (x: number, lo: number, hi: number) =>
	Math.max(lo, Math.min(hi, x));

// A real tennis ball is 3.35cm — invisible from a broadcast-height camera 20m
// away. "Feel beats fidelity" (`PRODUCT.md`): render it bigger than physics.
const BALL_VISUAL_RADIUS = BALL_RADIUS * 2.6;
const BALL_COLOR = "#d7ff3f";

const SHADOW_MAX_RADIUS = BALL_VISUAL_RADIUS * 1.8;
const SHADOW_MIN_RADIUS = BALL_VISUAL_RADIUS * 0.5;
const SHADOW_FADE_HEIGHT = 4;
const SHADOW_MAX_OPACITY = 0.45;
const SHADOW_MIN_OPACITY = 0.08;

const TRAIL_LENGTH = 14;
const TRAIL_MAX_RADIUS = BALL_VISUAL_RADIUS * 0.8;

function buildBall(): { mesh: THREE.Mesh; shadow: THREE.Mesh } {
	const mesh = new THREE.Mesh(
		new THREE.SphereGeometry(BALL_VISUAL_RADIUS, 16, 16),
		new THREE.MeshStandardMaterial({
			color: BALL_COLOR,
			emissive: BALL_COLOR,
			emissiveIntensity: 0.25,
			roughness: 0.5,
		}),
	);
	const shadow = new THREE.Mesh(
		new THREE.CircleGeometry(1, 24),
		new THREE.MeshBasicMaterial({
			color: "#000000",
			transparent: true,
			depthWrite: false,
		}),
	);
	shadow.rotation.x = -Math.PI / 2;
	return { mesh, shadow };
}

function buildTrail(): THREE.InstancedMesh {
	return new THREE.InstancedMesh(
		new THREE.SphereGeometry(1, 8, 8),
		new THREE.MeshBasicMaterial({
			color: BALL_COLOR,
			transparent: true,
			opacity: 0.5,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
		}),
		TRAIL_LENGTH,
	);
}

export interface BallVisual {
	/** Updates the ball, its shadow and its trail; returns the interpolated
	 * position so the camera can drift toward it. */
	update(previous: Ball, current: Ball, alpha: number): Vec3;
}

export function createBallVisual(scene: THREE.Scene): BallVisual {
	const { mesh, shadow } = buildBall();
	const trail = buildTrail();
	scene.add(mesh, shadow, trail);

	const history: { x: number; y: number; z: number }[] = Array.from(
		{ length: TRAIL_LENGTH },
		() => ({ x: 0, y: 0, z: 0 }),
	);
	let head = 0;
	let filled = 0;

	const scratchPos = new THREE.Vector3();
	const scratchScale = new THREE.Vector3();
	const scratchQuat = new THREE.Quaternion();
	const matrix = new THREE.Matrix4();

	function updateTrail(): void {
		head = (head + 1) % TRAIL_LENGTH;
		const slot = history[head];
		if (slot) {
			slot.x = mesh.position.x;
			slot.y = mesh.position.y;
			slot.z = mesh.position.z;
		}
		filled = Math.min(filled + 1, TRAIL_LENGTH);

		for (let i = 0; i < TRAIL_LENGTH; i++) {
			const age = (head - i + TRAIL_LENGTH) % TRAIL_LENGTH;
			const t = age < filled ? 1 - age / TRAIL_LENGTH : 0;
			const radius = TRAIL_MAX_RADIUS * t;
			const point = history[i];
			if (!point) continue;
			scratchPos.set(point.x, point.y, point.z);
			scratchScale.set(radius, radius, radius);
			matrix.compose(scratchPos, scratchQuat, scratchScale);
			trail.setMatrixAt(i, matrix);
		}
		trail.instanceMatrix.needsUpdate = true;
	}

	return {
		update(previous, current, alpha) {
			const p = lerpVec(previous.p, current.p, alpha);
			mesh.position.set(p.x, p.y, p.z);

			const heightT = clamp(p.y / SHADOW_FADE_HEIGHT, 0, 1);
			const radius = lerp(SHADOW_MAX_RADIUS, SHADOW_MIN_RADIUS, heightT);
			shadow.position.set(p.x, 0.004, p.z);
			shadow.scale.set(radius, radius, 1);
			const material = shadow.material as THREE.MeshBasicMaterial;
			material.opacity = lerp(SHADOW_MAX_OPACITY, SHADOW_MIN_OPACITY, heightT);

			updateTrail();
			return p;
		},
	};
}

const PLAYER_RADIUS = 0.3;
const PLAYER_LENGTH = 1.0;
const HEAD_RADIUS = 0.22;
const RACKET_REST_ANGLE = -0.3;
const SWING_PEAK_ANGLE = 1.9;
const SWING_DURATION = 0.22;

const SIDE_COLOR: Readonly<Record<Side, string>> = {
	near: "#ff5d73",
	far: "#ffd166",
};

interface PlayerRig {
	readonly group: THREE.Group;
	readonly racket: THREE.Object3D;
	readonly baseZ: number;
	/** Seconds elapsed since `swing()` was called, or `undefined` at rest. */
	swingElapsed: number | undefined;
}

function buildPlayer(side: Side, baseZ: number): PlayerRig {
	const group = new THREE.Group();
	group.position.z = baseZ;
	group.rotation.y = side === "near" ? 0 : Math.PI;

	const material = new THREE.MeshStandardMaterial({
		color: SIDE_COLOR[side],
		roughness: 0.6,
	});
	const body = new THREE.Mesh(
		new THREE.CapsuleGeometry(PLAYER_RADIUS, PLAYER_LENGTH, 4, 12),
		material,
	);
	const standHeight = PLAYER_RADIUS + PLAYER_LENGTH / 2;
	body.position.y = standHeight;
	group.add(body);

	const head = new THREE.Mesh(
		new THREE.SphereGeometry(HEAD_RADIUS, 12, 12),
		material,
	);
	head.position.y =
		standHeight + PLAYER_LENGTH / 2 + PLAYER_RADIUS + HEAD_RADIUS;
	group.add(head);

	const racketPivot = new THREE.Group();
	racketPivot.position.set(0.32, standHeight + 0.35, 0);
	racketPivot.rotation.x = RACKET_REST_ANGLE;
	const racket = new THREE.Mesh(
		new THREE.BoxGeometry(0.05, 0.55, 0.32),
		new THREE.MeshStandardMaterial({ color: "#e8f5ec", roughness: 0.4 }),
	);
	racket.position.y = 0.3;
	racketPivot.add(racket);
	group.add(racketPivot);

	return { group, racket: racketPivot, baseZ, swingElapsed: undefined };
}

export interface PlayersVisual {
	update(
		previous: Readonly<Record<Side, Player>>,
		current: Readonly<Record<Side, Player>>,
		alpha: number,
		dt: number,
	): void;
	/** Starts the swing animation on `side`. */
	swing(side: Side): void;
}

export function createPlayersVisual(
	scene: THREE.Scene,
	baseZ: Readonly<Record<Side, number>>,
): PlayersVisual {
	const rigs: Readonly<Record<Side, PlayerRig>> = {
		near: buildPlayer("near", baseZ.near),
		far: buildPlayer("far", baseZ.far),
	};
	scene.add(rigs.near.group, rigs.far.group);

	return {
		update(previous, current, alpha, dt) {
			for (const side of ["near", "far"] as const) {
				const rig = rigs[side];
				const x = lerp(previous[side].x, current[side].x, alpha);
				rig.group.position.x = x;

				if (rig.swingElapsed !== undefined) {
					const elapsed = rig.swingElapsed + dt;
					const t = elapsed / SWING_DURATION;
					if (t >= 1) {
						rig.swingElapsed = undefined;
						rig.racket.rotation.x = RACKET_REST_ANGLE;
					} else {
						rig.swingElapsed = elapsed;
						rig.racket.rotation.x =
							RACKET_REST_ANGLE + SWING_PEAK_ANGLE * Math.sin(t * Math.PI);
					}
				}
			}
		},
		swing(side) {
			rigs[side].swingElapsed = 0;
		},
	};
}
