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

// A real tennis ball is 3.35cm — invisible from a broadcast camera. "Feel
// beats fidelity" (`PRODUCT.md`): render it bigger than physics. Raised from
// 2.6x when the camera moved back to 26m with a 19° lens: at that distance
// the old size was two pixels across, which is not a ball anyone can track.
const BALL_VISUAL_RADIUS = BALL_RADIUS * 4.2;
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

	// Rotation axis for the ball's spin, reused every frame — building a
	// Vector3 per frame is the allocation renderer rule 2 forbids.
	const spinAxis = new THREE.Vector3();
	const lastPos = { x: 0, y: 0, z: 0 };
	let seeded = false;

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

			// Roll the ball along its own path: axis perpendicular to travel,
			// angle = distance / radius, so it looks like it is gripping the
			// air rather than sliding through it. Purely cosmetic — the sim
			// has no angular state and does not want one.
			if (seeded) {
				const dx = p.x - lastPos.x;
				const dy = p.y - lastPos.y;
				const dz = p.z - lastPos.z;
				const travelled = Math.hypot(dx, dy, dz);
				if (travelled > 1e-5) {
					spinAxis.set(dz, 0, -dx).normalize();
					mesh.rotateOnWorldAxis(spinAxis, travelled / BALL_VISUAL_RADIUS);
				}
			}
			lastPos.x = p.x;
			lastPos.y = p.y;
			lastPos.z = p.z;
			seeded = true;

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

const PLAYER_RADIUS = 0.26;
const PLAYER_LENGTH = 0.66;
const HEAD_RADIUS = 0.2;
const LEG_RADIUS = 0.11;
const LEG_LENGTH = 0.62;
const ARM_RADIUS = 0.085;
const ARM_LENGTH = 0.46;
const SHADOW_RADIUS = 0.42;
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

/**
 * A player: legs, torso, head, a free arm and a racket arm, plus a blob
 * shadow. Still procedural primitives (renderer rule 5) and still built once
 * — but a capsule with a ball on top reads as a skittle at this camera
 * distance, and legs are most of what makes it read as a person instead.
 */
function buildPlayer(side: Side, baseZ: number): PlayerRig {
	const group = new THREE.Group();
	group.position.z = baseZ;
	group.rotation.y = side === "near" ? 0 : Math.PI;

	const shirt = new THREE.MeshStandardMaterial({
		color: SIDE_COLOR[side],
		roughness: 0.65,
	});
	const skin = new THREE.MeshStandardMaterial({
		color: "#e8c49a",
		roughness: 0.75,
	});
	const shorts = new THREE.MeshStandardMaterial({
		color: "#f2f6f8",
		roughness: 0.85,
	});

	const hipHeight = LEG_LENGTH + LEG_RADIUS;
	const torsoCentre = hipHeight + PLAYER_LENGTH / 2;

	for (const dx of [-0.13, 0.13]) {
		const leg = new THREE.Mesh(
			new THREE.CapsuleGeometry(LEG_RADIUS, LEG_LENGTH, 3, 8),
			skin,
		);
		leg.position.set(dx, LEG_RADIUS + LEG_LENGTH / 2, 0);
		group.add(leg);
	}

	const skirt = new THREE.Mesh(
		new THREE.CylinderGeometry(0.28, 0.24, 0.26, 12),
		shorts,
	);
	skirt.position.y = hipHeight;
	group.add(skirt);

	const body = new THREE.Mesh(
		new THREE.CapsuleGeometry(PLAYER_RADIUS, PLAYER_LENGTH, 4, 12),
		shirt,
	);
	body.position.y = torsoCentre;
	group.add(body);

	const shoulderHeight = torsoCentre + PLAYER_LENGTH / 2;

	const freeArm = new THREE.Mesh(
		new THREE.CapsuleGeometry(ARM_RADIUS, ARM_LENGTH, 3, 8),
		skin,
	);
	freeArm.position.set(-0.32, shoulderHeight - ARM_LENGTH / 2, 0);
	freeArm.rotation.z = 0.25;
	group.add(freeArm);

	const head = new THREE.Mesh(
		new THREE.SphereGeometry(HEAD_RADIUS, 12, 12),
		skin,
	);
	head.position.y = shoulderHeight + PLAYER_RADIUS + HEAD_RADIUS * 0.7;
	group.add(head);

	// The racket arm and the racket rotate together, from the shoulder.
	const racketPivot = new THREE.Group();
	racketPivot.position.set(0.3, shoulderHeight - 0.05, 0);
	racketPivot.rotation.x = RACKET_REST_ANGLE;

	const arm = new THREE.Mesh(
		new THREE.CapsuleGeometry(ARM_RADIUS, ARM_LENGTH, 3, 8),
		skin,
	);
	arm.position.y = -ARM_LENGTH / 2;
	racketPivot.add(arm);

	const grip = new THREE.Mesh(
		new THREE.CylinderGeometry(0.035, 0.035, 0.28, 8),
		new THREE.MeshStandardMaterial({ color: "#1d2630", roughness: 0.6 }),
	);
	grip.position.y = -ARM_LENGTH - 0.14;
	racketPivot.add(grip);

	const head_ = new THREE.Mesh(
		new THREE.TorusGeometry(0.17, 0.022, 6, 18),
		new THREE.MeshStandardMaterial({ color: "#e8f5ec", roughness: 0.35 }),
	);
	head_.position.y = -ARM_LENGTH - 0.44;
	head_.rotation.y = Math.PI / 2;
	racketPivot.add(head_);

	const strings = new THREE.Mesh(
		new THREE.CircleGeometry(0.16, 16),
		new THREE.MeshBasicMaterial({
			color: "#cfe6ff",
			transparent: true,
			opacity: 0.18,
			side: THREE.DoubleSide,
			depthWrite: false,
		}),
	);
	strings.position.copy(head_.position);
	strings.rotation.y = Math.PI / 2;
	racketPivot.add(strings);

	group.add(racketPivot);

	// The same trick the ball uses: a flat dark disc, not a shadow map. It is
	// what stops a player looking like they are hovering.
	const shadow = new THREE.Mesh(
		new THREE.CircleGeometry(SHADOW_RADIUS, 20),
		new THREE.MeshBasicMaterial({
			color: "#000000",
			transparent: true,
			opacity: 0.32,
			depthWrite: false,
		}),
	);
	shadow.rotation.x = -Math.PI / 2;
	shadow.position.y = 0.006;
	group.add(shadow);

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
