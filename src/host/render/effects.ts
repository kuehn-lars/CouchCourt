/**
 * Hit and bounce effects: a fixed-size particle pool plus a small ring of
 * shockwave meshes, both round-robin-reused rather than created per event so
 * a fast rally never allocates in the render loop
 * (`llm-knowledge/modules/host.md`'s renderer rule 2).
 */

import * as THREE from "three";
import type { Vec3 } from "../../shared/sim/state.ts";

const POOL_SIZE = 48;
const PARTICLES_PER_HIT = 16;
const PARTICLES_PER_BOUNCE = 8;
const PARTICLE_COLOR = "#fff6d8";
const GRAVITY = 3;

interface Particle {
	readonly velocity: THREE.Vector3;
	readonly position: THREE.Vector3;
	life: number;
	maxLife: number;
	baseSize: number;
}

function spawnParticle(
	p: Particle,
	at: Vec3,
	speed: number,
	life: number,
): void {
	const theta = Math.random() * Math.PI * 2;
	const phi = Math.random() * Math.PI * 0.5;
	const r = speed * (0.5 + Math.random() * 0.5);
	p.velocity.set(
		Math.cos(theta) * Math.cos(phi) * r,
		Math.sin(phi) * r,
		Math.sin(theta) * Math.cos(phi) * r,
	);
	p.position.set(at.x, at.y, at.z);
	p.life = life;
	p.maxLife = life;
	p.baseSize = 0.03 + Math.random() * 0.03;
}

const RING_COUNT = 3;
const RING_DURATION = 0.35;
const RING_MAX_RADIUS = 1.1;

interface Ring {
	readonly mesh: THREE.Mesh;
	life: number;
}

export interface Effects {
	hit(at: Vec3): void;
	bounce(at: Vec3): void;
	/** Advances every live particle and ring by `dt` seconds. */
	update(dt: number): void;
}

export function createEffects(scene: THREE.Scene): Effects {
	const particleMesh = new THREE.InstancedMesh(
		new THREE.SphereGeometry(1, 6, 6),
		new THREE.MeshBasicMaterial({
			color: PARTICLE_COLOR,
			transparent: true,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
		}),
		POOL_SIZE,
	);
	scene.add(particleMesh);

	const particles: Particle[] = Array.from({ length: POOL_SIZE }, () => ({
		velocity: new THREE.Vector3(),
		position: new THREE.Vector3(),
		life: 0,
		maxLife: 1,
		baseSize: 0,
	}));
	let particleCursor = 0;

	const ringGeometry = new THREE.RingGeometry(0.75, 1, 32);
	const rings: Ring[] = Array.from({ length: RING_COUNT }, () => ({
		mesh: new THREE.Mesh(
			ringGeometry,
			new THREE.MeshBasicMaterial({
				color: PARTICLE_COLOR,
				transparent: true,
				opacity: 0,
				side: THREE.DoubleSide,
				depthWrite: false,
			}),
		),
		life: 0,
	}));
	for (const ring of rings) {
		ring.mesh.rotation.x = -Math.PI / 2;
		scene.add(ring.mesh);
	}
	let ringCursor = 0;

	function emit(at: Vec3, count: number, speed: number, life: number): void {
		for (let i = 0; i < count; i++) {
			const p = particles[particleCursor];
			particleCursor = (particleCursor + 1) % POOL_SIZE;
			if (p) spawnParticle(p, at, speed, life);
		}
	}

	const scratchPos = new THREE.Vector3();
	const scratchScale = new THREE.Vector3();
	const scratchQuat = new THREE.Quaternion();
	const matrix = new THREE.Matrix4();

	return {
		hit(at) {
			emit(at, PARTICLES_PER_HIT, 3.2, 0.35);
			const ring = rings[ringCursor];
			ringCursor = (ringCursor + 1) % RING_COUNT;
			if (ring) {
				ring.mesh.position.set(at.x, 0.02, at.z);
				ring.life = RING_DURATION;
			}
		},
		bounce(at) {
			emit(at, PARTICLES_PER_BOUNCE, 1.4, 0.25);
		},
		update(dt) {
			for (let i = 0; i < POOL_SIZE; i++) {
				const p = particles[i];
				if (!p) continue;
				if (p.life > 0) {
					p.life -= dt;
					p.velocity.y -= GRAVITY * dt;
					p.position.addScaledVector(p.velocity, dt);
				}
				const scale = p.life > 0 ? p.baseSize * (p.life / p.maxLife) : 0;
				scratchPos.copy(p.position);
				scratchScale.set(scale, scale, scale);
				matrix.compose(scratchPos, scratchQuat, scratchScale);
				particleMesh.setMatrixAt(i, matrix);
			}
			particleMesh.instanceMatrix.needsUpdate = true;

			for (const ring of rings) {
				const material = ring.mesh.material as THREE.MeshBasicMaterial;
				if (ring.life > 0) {
					ring.life -= dt;
					const t = 1 - Math.max(ring.life, 0) / RING_DURATION;
					const radius = 0.15 + RING_MAX_RADIUS * t;
					ring.mesh.scale.set(radius, radius, radius);
					material.opacity = Math.max(0, 1 - t);
				} else {
					material.opacity = 0;
				}
			}
		},
	};
}
