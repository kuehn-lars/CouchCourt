/**
 * Everything that happens for a moment: the comic impact star and sparks on
 * a hit, a dust puff and a skid mark on a bounce, a shockwave on the ground
 * under a hard strike, and confetti in the winner's colour on a point.
 *
 * Every pool is fixed-size and round-robin reused, so a fast rally never
 * allocates in the render loop (`llm-knowledge/modules/host.md`, rule 2).
 */

import * as THREE from "three";
import type { Side } from "../../shared/protocol.ts";
import type { Vec3 } from "../../shared/sim/state.ts";
import { burstTexture, dotTexture } from "./textures.ts";

const SIDE_COLOR: Readonly<Record<Side, string>> = {
	near: "#ff5d73",
	far: "#5ac8fa",
};

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/** A pool of camera-facing quads drawn in one call, each with its own
 * position, size, colour and opacity. The shared shape of sparks, dust and
 * confetti. */
interface Particle {
	readonly p: THREE.Vector3;
	readonly v: THREE.Vector3;
	life: number;
	max: number;
	size: number;
	grow: number;
	gravity: number;
	drag: number;
	spin: number;
	angle: number;
	readonly color: THREE.Color;
}

function pool(
	count: number,
	material: THREE.Material,
): {
	mesh: THREE.InstancedMesh;
	items: Particle[];
	next(): Particle;
} {
	const mesh = new THREE.InstancedMesh(
		new THREE.PlaneGeometry(1, 1),
		material,
		count,
	);
	mesh.frustumCulled = false;
	mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
	const items: Particle[] = Array.from({ length: count }, () => ({
		p: new THREE.Vector3(),
		v: new THREE.Vector3(),
		life: 0,
		max: 1,
		size: 0,
		grow: 0,
		gravity: 0,
		drag: 0,
		spin: 0,
		angle: 0,
		color: new THREE.Color(),
	}));
	const white = new THREE.Color("#ffffff");
	for (let i = 0; i < count; i++) mesh.setColorAt(i, white);
	let cursor = 0;
	return {
		mesh,
		items,
		next() {
			const item = items[cursor] as Particle;
			cursor = (cursor + 1) % count;
			return item;
		},
	};
}

export interface Effects {
	hit(at: Vec3, power: number, side: Side, smash: boolean): void;
	bounce(at: Vec3, velocity: Vec3): void;
	confetti(side: Side): void;
	/** Advances everything by `dt`; `camera` is what the sprites face. */
	update(dt: number, camera: THREE.Camera): void;
}

export function createEffects(scene: THREE.Scene): Effects {
	const dot = dotTexture();
	const additive = new THREE.MeshBasicMaterial({
		map: dot,
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
	});
	const sparks = pool(96, additive);
	const dustMaterial = new THREE.MeshBasicMaterial({
		map: dot,
		transparent: true,
		depthWrite: false,
		opacity: 0.5,
	});
	const dust = pool(64, dustMaterial);
	const paper = new THREE.MeshBasicMaterial({
		side: THREE.DoubleSide,
		transparent: true,
		depthWrite: false,
	});
	const confettiPool = pool(220, paper);
	scene.add(sparks.mesh, dust.mesh, confettiPool.mesh);

	// The impact star: a few sprites, cycled.
	const burstMap = burstTexture();
	const bursts = Array.from({ length: 4 }, () => {
		const sprite = new THREE.Sprite(
			new THREE.SpriteMaterial({
				map: burstMap,
				transparent: true,
				depthWrite: false,
			}),
		);
		sprite.visible = false;
		scene.add(sprite);
		return { sprite, life: 0, size: 1 };
	});
	let burstCursor = 0;

	// Ground rings under a hard strike and skid marks where the ball lands.
	const ringGeometry = new THREE.RingGeometry(0.8, 1, 48);
	const rings = Array.from({ length: 4 }, () => {
		const mesh = new THREE.Mesh(
			ringGeometry,
			new THREE.MeshBasicMaterial({
				color: "#eaffb0",
				transparent: true,
				opacity: 0,
				depthWrite: false,
				blending: THREE.AdditiveBlending,
			}),
		);
		mesh.rotation.x = -Math.PI / 2;
		scene.add(mesh);
		return { mesh, life: 0, max: 0.4, size: 1 };
	});
	let ringCursor = 0;

	const skidGeometry = new THREE.CircleGeometry(1, 20);
	const skids = Array.from({ length: 8 }, () => {
		const mesh = new THREE.Mesh(
			skidGeometry,
			new THREE.MeshBasicMaterial({
				color: "#dff2ff",
				transparent: true,
				opacity: 0,
				depthWrite: false,
				polygonOffset: true,
				polygonOffsetFactor: -3,
			}),
		);
		mesh.rotation.order = "YXZ";
		scene.add(mesh);
		return { mesh, life: 0 };
	});
	let skidCursor = 0;

	const matrix = new THREE.Matrix4();
	const quat = new THREE.Quaternion();
	const roll = new THREE.Quaternion();
	const scale = new THREE.Vector3();
	const zAxis = new THREE.Vector3(0, 0, 1);
	const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

	function step(
		target: ReturnType<typeof pool>,
		dt: number,
		camera: THREE.Camera,
		fade: (p: Particle) => number,
	): void {
		const { mesh, items } = target;
		for (let i = 0; i < items.length; i++) {
			const p = items[i] as Particle;
			if (p.life <= 0) {
				mesh.setMatrixAt(i, hidden);
				continue;
			}
			p.life -= dt;
			p.v.y -= p.gravity * dt;
			p.v.multiplyScalar(Math.exp(-p.drag * dt));
			p.p.addScaledVector(p.v, dt);
			if (p.p.y < 0.02) {
				p.p.y = 0.02;
				p.v.y = Math.abs(p.v.y) * 0.2;
				p.v.x *= 0.6;
				p.v.z *= 0.6;
			}
			p.angle += p.spin * dt;
			const t = 1 - Math.max(p.life, 0) / p.max;
			const s = (p.size + p.grow * t) * fade(p);
			roll.setFromAxisAngle(zAxis, p.angle);
			quat.copy(camera.quaternion).multiply(roll);
			scale.set(s, s, s);
			matrix.compose(p.p, quat, scale);
			mesh.setMatrixAt(i, matrix);
			mesh.setColorAt(i, p.color);
		}
		mesh.instanceMatrix.needsUpdate = true;
		if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
	}

	return {
		hit(at, power, side, smash) {
			const n = Math.round(10 + power * 18 + (smash ? 12 : 0));
			for (let i = 0; i < n; i++) {
				const s = sparks.next();
				const speed = rand(2.5, 7) * (0.6 + power);
				const theta = rand(0, Math.PI * 2);
				const phi = rand(-0.3, 1.1);
				s.p.set(at.x, at.y, at.z);
				s.v.set(
					Math.cos(theta) * Math.cos(phi) * speed,
					Math.sin(phi) * speed,
					Math.sin(theta) * Math.cos(phi) * speed,
				);
				s.life = s.max = rand(0.18, 0.42);
				s.size = rand(0.05, 0.12);
				s.grow = -s.size * 0.7;
				s.gravity = 9;
				s.drag = 3;
				s.spin = 0;
				s.angle = 0;
				s.color.set(i % 4 === 0 ? SIDE_COLOR[side] : "#fff8d0");
			}
			const b = bursts[burstCursor];
			burstCursor = (burstCursor + 1) % bursts.length;
			if (b) {
				b.sprite.position.set(at.x, at.y, at.z);
				b.sprite.material.rotation = rand(0, Math.PI);
				b.life = 0.16;
				b.size = 0.9 + power * 0.9 + (smash ? 0.8 : 0);
				b.sprite.visible = true;
			}
			if (power > 0.55 || smash) {
				const r = rings[ringCursor];
				ringCursor = (ringCursor + 1) % rings.length;
				if (r) {
					r.mesh.position.set(at.x, 0.02, at.z);
					r.life = r.max = smash ? 0.55 : 0.4;
					r.size = smash ? 3.2 : 1.8;
				}
			}
		},
		bounce(at, velocity) {
			for (let i = 0; i < 7; i++) {
				const d = dust.next();
				d.p.set(at.x + rand(-0.1, 0.1), 0.06, at.z + rand(-0.1, 0.1));
				d.v.set(
					velocity.x * 0.12 + rand(-0.6, 0.6),
					rand(0.2, 0.7),
					velocity.z * 0.12 + rand(-0.6, 0.6),
				);
				d.life = d.max = rand(0.35, 0.6);
				d.size = rand(0.12, 0.2);
				d.grow = rand(0.35, 0.6);
				d.gravity = 0.4;
				d.drag = 4;
				d.spin = rand(-2, 2);
				d.angle = rand(0, 6);
				d.color.set("#bfe3ff");
			}
			const skid = skids[skidCursor];
			skidCursor = (skidCursor + 1) % skids.length;
			if (skid) {
				skid.mesh.position.set(at.x, 0.006, at.z);
				skid.mesh.rotation.set(
					-Math.PI / 2,
					Math.atan2(velocity.x, velocity.z),
					0,
					"YXZ",
				);
				skid.mesh.scale.set(0.07, 0.26, 1);
				skid.life = 3;
			}
		},
		confetti(side) {
			const z = side === "near" ? 8 : -8;
			const palette = [
				SIDE_COLOR[side],
				"#ffffff",
				"#dcff4a",
				SIDE_COLOR[side],
			];
			for (let i = 0; i < 90; i++) {
				const c = confettiPool.next();
				c.p.set(rand(-5, 5), rand(6, 9), z + rand(-4, 4));
				c.v.set(rand(-1.5, 1.5), rand(-0.5, 2.5), rand(-1.5, 1.5));
				c.life = c.max = rand(2.2, 3.4);
				c.size = rand(0.1, 0.16);
				c.grow = 0;
				c.gravity = 2.2;
				c.drag = 1.6;
				c.spin = rand(-9, 9);
				c.angle = rand(0, 6);
				c.color.set(palette[i % palette.length] ?? "#ffffff");
			}
		},
		update(dt, camera) {
			step(sparks, dt, camera, () => 1);
			step(dust, dt, camera, (p) => Math.min(1, (p.life / p.max) * 2));
			// Confetti flutters: its width swings with its spin.
			step(
				confettiPool,
				dt,
				camera,
				(p) => 0.4 + Math.abs(Math.sin(p.angle)) * 0.6,
			);

			for (const b of bursts) {
				if (b.life <= 0) {
					b.sprite.visible = false;
					continue;
				}
				b.life -= dt;
				const t = 1 - b.life / 0.16;
				// Snaps out in two frames, then shrinks away.
				const s = b.size * (t < 0.25 ? t / 0.25 : 1 - (t - 0.25) * 0.8);
				b.sprite.scale.set(s, s, s);
				b.sprite.material.opacity = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
			}
			for (const r of rings) {
				const material = r.mesh.material as THREE.MeshBasicMaterial;
				if (r.life <= 0) {
					material.opacity = 0;
					continue;
				}
				r.life -= dt;
				const t = 1 - Math.max(r.life, 0) / r.max;
				const s = 0.2 + r.size * (1 - (1 - t) ** 3);
				r.mesh.scale.set(s, s, s);
				material.opacity = (1 - t) * 0.8;
			}
			for (const skid of skids) {
				const material = skid.mesh.material as THREE.MeshBasicMaterial;
				skid.life = Math.max(0, skid.life - dt);
				material.opacity = Math.min(0.35, skid.life * 0.2);
			}
		},
	};
}
