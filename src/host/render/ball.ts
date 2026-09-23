/**
 * The ball: felt with a seam, a glow that blooms, squash and stretch along
 * its flight, a ribbon trail, and the blob shadow that is still the primary
 * cue for judging where it will land.
 *
 * Squash and stretch is the cartoon half of "comic realism": a ball leaving
 * the strings stretches along its path, and one landing flattens for a few
 * frames. It is drawn on a parent group aligned to the velocity, with the
 * felt spinning inside it, so the stretch never shears the seam.
 *
 * The trail is two ribbons crossed at right angles along the last few
 * positions — one lies flat, one stands up — so it reads from any camera,
 * including both halves of a split screen at once, without being rebuilt
 * per view. Its colour runs from the ball's yellow to white-hot with pace.
 *
 * Built once. Per frame: a few vectors set and one buffer rewritten in
 * place (renderer rule 2).
 */

import * as THREE from "three";
import { BALL_RADIUS } from "../../shared/sim/court.ts";
import type { Ball, Vec3 } from "../../shared/sim/state.ts";
import { ballTexture } from "./textures.ts";

// A real tennis ball is 3.35cm — invisible from a broadcast camera. "Feel
// beats fidelity" (`PRODUCT.md`).
export const BALL_VISUAL_RADIUS = BALL_RADIUS * 4.2;

const SHADOW_MAX_RADIUS = BALL_VISUAL_RADIUS * 1.9;
const SHADOW_MIN_RADIUS = BALL_VISUAL_RADIUS * 0.55;
const SHADOW_FADE_HEIGHT = 4;
const SHADOW_MAX_OPACITY = 0.55;
const SHADOW_MIN_OPACITY = 0.1;

const TRAIL = 22;
const TRAIL_WIDTH = BALL_VISUAL_RADIUS * 0.85;

/** Seconds for the drawn ball to close most of the gap to the sim's after a
 * rewound hit (see `update`). */
const CATCH_UP = 0.06;
/** A jump this far in one frame, with no hit, is a new point: snap. */
const TELEPORT = 3;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (x: number, lo: number, hi: number) =>
	Math.max(lo, Math.min(hi, x));

export interface BallVisual {
	/**
	 * Draws the ball; returns the drawn position (the camera drifts toward
	 * it).
	 *
	 * `struckAt` is the contact point when a hit happened this frame. A late
	 * swing is resolved by rewinding (`sim/rally.ts`): the ball the sim hands
	 * back is already some way down the court. Drawn as-is it teleports, so
	 * the drawn ball starts on the racket and closes on the real one over
	 * ~0.1s — which reads as leaving the strings fast.
	 */
	update(
		previous: Ball,
		current: Ball,
		alpha: number,
		dt: number,
		struckAt: Vec3 | null,
	): Vec3;
	/** A few frames of flattening: `strength` 0..1. */
	squash(strength: number): void;
}

function ribbon(): {
	mesh: THREE.Mesh;
	positions: Float32Array;
	alphas: Float32Array;
} {
	// Two strips of TRAIL points each: (left, right) per point.
	const count = TRAIL * 2 * 2;
	const positions = new Float32Array(count * 3);
	const alphas = new Float32Array(count);
	const indices: number[] = [];
	for (let strip = 0; strip < 2; strip++) {
		const base = strip * TRAIL * 2;
		for (let i = 0; i < TRAIL - 1; i++) {
			const a = base + i * 2;
			indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
		}
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute(
		"position",
		new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage),
	);
	geometry.setAttribute(
		"aAlpha",
		new THREE.BufferAttribute(alphas, 1).setUsage(THREE.DynamicDrawUsage),
	);
	geometry.setIndex(indices);
	const material = new THREE.ShaderMaterial({
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
		side: THREE.DoubleSide,
		uniforms: {
			heat: { value: 0 },
		},
		vertexShader: /* glsl */ `
			attribute float aAlpha;
			varying float vAlpha;
			void main() {
				vAlpha = aAlpha;
				gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
			}`,
		fragmentShader: /* glsl */ `
			uniform float heat;
			varying float vAlpha;
			void main() {
				vec3 ball = vec3(0.86, 1.0, 0.29);
				vec3 hot = vec3(1.0, 1.0, 0.92);
				vec3 col = mix(ball, hot, heat * vAlpha);
				gl_FragColor = vec4(col * vAlpha * (0.45 + heat * 0.5), 1.0);
			}`,
	});
	const mesh = new THREE.Mesh(geometry, material);
	mesh.frustumCulled = false;
	return { mesh, positions, alphas };
}

export function createBallVisual(scene: THREE.Scene): BallVisual {
	const holder = new THREE.Group();
	const felt = new THREE.Mesh(
		new THREE.SphereGeometry(BALL_VISUAL_RADIUS, 20, 14),
		new THREE.MeshStandardMaterial({
			map: ballTexture(),
			emissive: "#cfff3a",
			emissiveIntensity: 0.55,
			roughness: 0.75,
		}),
	);
	holder.add(felt);

	const shadow = new THREE.Mesh(
		new THREE.CircleGeometry(1, 24),
		new THREE.MeshBasicMaterial({
			color: "#000000",
			transparent: true,
			depthWrite: false,
		}),
	);
	shadow.rotation.x = -Math.PI / 2;

	const trail = ribbon();
	scene.add(holder, shadow, trail.mesh);
	const trailPositions = trail.mesh.geometry.getAttribute("position");
	const trailAlphas = trail.mesh.geometry.getAttribute("aAlpha");
	const heat = (trail.mesh.material as THREE.ShaderMaterial).uniforms.heat as {
		value: number;
	};

	const history = Array.from({ length: TRAIL }, () => new THREE.Vector3());
	let head = 0;
	let filled = 0;

	const offset = new THREE.Vector3();
	const drawn = new THREE.Vector3();
	const last = new THREE.Vector3();
	const velocity = new THREE.Vector3();
	const along = new THREE.Vector3();
	const flat = new THREE.Vector3();
	const upright = new THREE.Vector3();
	const spinAxis = new THREE.Vector3();
	const yAxis = new THREE.Vector3(0, 1, 0);
	let seeded = false;
	let squashT = 0;
	let squashAmount = 0;

	function writeStrip(
		strip: number,
		i: number,
		side: THREE.Vector3,
		p: THREE.Vector3,
		w: number,
		alpha: number,
	): void {
		const v = (strip * TRAIL + i) * 2;
		trailPositions.setXYZ(
			v,
			p.x - side.x * w,
			p.y - side.y * w,
			p.z - side.z * w,
		);
		trailPositions.setXYZ(
			v + 1,
			p.x + side.x * w,
			p.y + side.y * w,
			p.z + side.z * w,
		);
		trailAlphas.setX(v, alpha);
		trailAlphas.setX(v + 1, alpha);
	}

	function writeTrail(speed: number): void {
		heat.value = lerp(heat.value, clamp((speed - 12) / 22, 0, 1), 0.2);
		for (let i = 0; i < TRAIL; i++) {
			const idx = (head - i + TRAIL) % TRAIL;
			const prev = history[(idx - 1 + TRAIL) % TRAIL];
			const p = history[idx];
			if (!p || !prev) continue;
			const age = i < filled ? 1 - i / TRAIL : 0;
			along.subVectors(p, prev);
			if (along.lengthSq() < 1e-8) along.set(0, 0, 1);
			along.normalize();
			flat.crossVectors(along, yAxis);
			if (flat.lengthSq() < 1e-6) flat.set(1, 0, 0);
			flat.normalize();
			upright.crossVectors(flat, along).normalize();
			const w = TRAIL_WIDTH * age;
			const alpha = age * age * 0.9;
			writeStrip(0, i, flat, p, w, alpha);
			writeStrip(1, i, upright, p, w, alpha);
		}
		trailPositions.needsUpdate = true;
		trailAlphas.needsUpdate = true;
	}

	return {
		squash(strength) {
			squashT = 0.09;
			squashAmount = Math.max(squashAmount * (squashT > 0 ? 1 : 0), strength);
		},
		update(previous, current, alpha, dt, struckAt) {
			const t = struckAt ? 1 : alpha;
			const sx = lerp(previous.p.x, current.p.x, t);
			const sy = lerp(previous.p.y, current.p.y, t);
			const sz = lerp(previous.p.z, current.p.z, t);
			if (struckAt) {
				offset.set(struckAt.x - sx, struckAt.y - sy, struckAt.z - sz);
			} else if (
				seeded &&
				Math.hypot(sx - last.x, sy - last.y, sz - last.z) > TELEPORT
			) {
				offset.set(0, 0, 0);
				filled = 0;
			}
			offset.multiplyScalar(Math.exp(-dt / CATCH_UP));
			const px = sx + offset.x;
			const py = sy + offset.y;
			const pz = sz + offset.z;
			holder.position.set(px, py, pz);

			velocity.set(current.v.x, current.v.y, current.v.z);
			const speed = velocity.length();

			// Stretch along the flight, flatten on impact; volume kept.
			squashT = Math.max(0, squashT - dt);
			const flatten = squashT > 0 ? squashAmount * (squashT / 0.09) : 0;
			if (flatten === 0) squashAmount = 0;
			const stretch = 1 + clamp(speed / 55, 0, 0.45) - flatten * 0.45;
			const girth = 1 / Math.sqrt(Math.max(stretch, 0.3));
			if (speed > 0.5 && flatten === 0) {
				holder.quaternion.setFromUnitVectors(
					yAxis,
					along.copy(velocity).normalize(),
				);
				holder.scale.set(girth, stretch, girth);
			} else {
				holder.quaternion.identity();
				holder.scale.set(girth, stretch, girth);
			}

			// Roll along the path, so it grips the air rather than sliding.
			if (seeded) {
				const dx = px - last.x;
				const dz = pz - last.z;
				const dy = py - last.y;
				const moved = Math.hypot(dx, dy, dz);
				if (moved > 1e-5) {
					spinAxis.set(dz, 0, -dx);
					if (spinAxis.lengthSq() > 1e-10) {
						felt.rotateOnWorldAxis(
							spinAxis.normalize(),
							moved / BALL_VISUAL_RADIUS,
						);
					}
				}
			}
			last.set(px, py, pz);
			seeded = true;

			const heightT = clamp(py / SHADOW_FADE_HEIGHT, 0, 1);
			const radius = lerp(SHADOW_MAX_RADIUS, SHADOW_MIN_RADIUS, heightT);
			shadow.position.set(px, 0.012, pz);
			shadow.scale.set(radius, radius, 1);
			(shadow.material as THREE.MeshBasicMaterial).opacity = lerp(
				SHADOW_MAX_OPACITY,
				SHADOW_MIN_OPACITY,
				heightT,
			);

			head = (head + 1) % TRAIL;
			history[head]?.set(px, py, pz);
			filled = Math.min(filled + 1, TRAIL);
			writeTrail(speed);
			return drawn.set(px, py, pz);
		},
	};
}
