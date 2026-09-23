/**
 * The crowd: a few thousand spectators in one draw call, and camera flashes
 * in a second. Each spectator is a body, a head and two arms merged into one
 * geometry; the animation is in the vertex shader, so a stadium of people
 * costs the CPU one uniform write a frame.
 *
 * They fidget while a point is played, jump and throw their arms up when one
 * is won (`excite`), and in the lobby a wave runs round the bowl (`wave`).
 * Every spectator has a seed, so no two move together.
 */

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export interface Seat {
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

/** Body, head and two arms hanging from shoulders at `SHOULDER`. An `aArm`
 * attribute marks the arm vertices, which the shader swings up. */
const SHOULDER = 0.46;

function spectator(): THREE.BufferGeometry {
	const tag = (g: THREE.BufferGeometry, arm: number) => {
		const count = g.getAttribute("position").count;
		g.setAttribute(
			"aArm",
			new THREE.Float32BufferAttribute(new Float32Array(count).fill(arm), 1),
		);
		return g;
	};
	const body = new THREE.BoxGeometry(0.34, 0.46, 0.22);
	body.translate(0, 0.23, 0);
	const head = new THREE.SphereGeometry(0.105, 8, 6);
	head.translate(0, 0.58, 0);
	const armL = new THREE.BoxGeometry(0.08, 0.36, 0.08);
	armL.translate(-0.21, SHOULDER - 0.18, 0);
	const armR = armL.clone();
	armR.translate(0.42, 0, 0);
	const merged = mergeGeometries([
		tag(body.toNonIndexed(), 0),
		tag(head.toNonIndexed(), 0),
		tag(armL.toNonIndexed(), 1),
		tag(armR.toNonIndexed(), 1),
	]);
	if (!merged) throw new Error("crowd: could not merge the spectator");
	return merged;
}

/** Mostly dark, the way a crowd under floodlights is: lit from above and
 * behind, the colour is in the few white shirts and in the supporters
 * wearing their player's colour. Weighted by repetition. */
const CROWD_COLORS = [
	"#1d2a38",
	"#232f3d",
	"#2a3444",
	"#1a2531",
	"#2e3848",
	"#252a36",
	"#1f2d3b",
	"#323b49",
	"#6b7788",
	"#8793a3",
	"#9b3c4c",
	"#2f6f90",
];

export interface Crowd {
	readonly group: THREE.Group;
	/** `excite` 0..1 (a point was just won), `wave` 0..1 (the lobby), and
	 * `flashes` 0..1 (how many cameras are going off). */
	update(dt: number, excite: number, wave: number, flashes: number): void;
}

const hash = (i: number, n: number) => {
	const x = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453;
	return x - Math.floor(x);
};

export function buildCrowd(seats: readonly Seat[]): Crowd {
	const group = new THREE.Group();
	const uniforms = {
		time: { value: 0 },
		excite: { value: 0 },
		wave: { value: 0 },
	};

	const material = new THREE.MeshLambertMaterial();
	material.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, uniforms);
		shader.vertexShader = shader.vertexShader
			.replace(
				"#include <common>",
				`#include <common>
				uniform float time;
				uniform float excite;
				uniform float wave;
				attribute float aArm;
				attribute float aSeed;`,
			)
			.replace(
				"#include <begin_vertex>",
				`#include <begin_vertex>
				vec3 seat = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
				float around = atan(seat.z, seat.x);
				// The wave: a crest running round the bowl every 9 seconds.
				float crest = pow(max(0.0, cos(around - time * 0.7)), 18.0) * wave;
				float jumper = step(0.3, fract(aSeed * 7.13));
				float hop = abs(sin(time * (7.0 + aSeed * 4.0) + aSeed * 40.0));
				float lift = excite * jumper * hop * 0.22 + crest * 0.35
					+ sin(time * (1.3 + aSeed) + aSeed * 30.0) * 0.012;
				float armsUp = clamp(excite * jumper * 1.4 + crest * 1.2, 0.0, 1.0);
				if (aArm > 0.5) {
					float up = ${SHOULDER.toFixed(3)} * 2.0 + 0.08 - transformed.y;
					transformed.y = mix(transformed.y, up, armsUp);
				}
				transformed.y += lift;`,
			);
	};
	material.customProgramCacheKey = () => "crowd";

	const geometry = spectator();
	const mesh = new THREE.InstancedMesh(geometry, material, seats.length);
	const seeds = new Float32Array(seats.length);
	const matrix = new THREE.Matrix4();
	const position = new THREE.Vector3();
	const quaternion = new THREE.Quaternion();
	const scale = new THREE.Vector3();
	const color = new THREE.Color();
	const up = new THREE.Vector3(0, 1, 0);
	seats.forEach((seat, i) => {
		const size = 0.9 + hash(i, 4) * 0.25;
		position.set(
			seat.x + (hash(i, 1) - 0.5) * 0.3,
			seat.y,
			seat.z + (hash(i, 3) - 0.5) * 0.3,
		);
		// Everyone faces the court.
		quaternion.setFromAxisAngle(up, Math.atan2(-seat.x, -seat.z));
		scale.setScalar(size);
		matrix.compose(position, quaternion, scale);
		mesh.setMatrixAt(i, matrix);
		const swatch = CROWD_COLORS[Math.floor(hash(i, 5) * CROWD_COLORS.length)];
		mesh.setColorAt(i, color.set(swatch ?? "#3b5a72"));
		seeds[i] = hash(i, 6);
	});
	geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 1));
	mesh.instanceMatrix.needsUpdate = true;
	if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
	// Bounds are the bowl, not one spectator: never culled wrongly.
	mesh.frustumCulled = false;
	group.add(mesh);

	const flashes = buildFlashes(seats);
	group.add(flashes.points);

	return {
		group,
		update(dt, excite, wave, flash) {
			uniforms.time.value += dt;
			uniforms.excite.value = excite;
			uniforms.wave.value = wave;
			flashes.update(uniforms.time.value, flash);
		},
	};
}

const FLASH_COUNT = 700;

/** Phone and camera flashes: points that go off for a few frames at random,
 * more of them when something is happening. Additive, and bright enough to
 * bloom. */
function buildFlashes(seats: readonly Seat[]): {
	points: THREE.Points;
	update(time: number, amount: number): void;
} {
	const positions = new Float32Array(FLASH_COUNT * 3);
	const seeds = new Float32Array(FLASH_COUNT);
	for (let i = 0; i < FLASH_COUNT; i++) {
		const seat = seats[Math.floor(hash(i, 9) * seats.length)];
		if (!seat) continue;
		positions.set([seat.x, seat.y + 0.7, seat.z], i * 3);
		seeds[i] = hash(i, 11);
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
	geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
	const uniforms = { time: { value: 0 }, amount: { value: 0 } };
	const material = new THREE.ShaderMaterial({
		uniforms,
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
		vertexShader: /* glsl */ `
			uniform float time;
			uniform float amount;
			attribute float aSeed;
			varying float vFlash;
			void main() {
				float rate = 0.35 + aSeed * 0.5;
				float phase = fract(time * rate + aSeed * 17.0);
				float gate = step(1.0 - (0.06 + amount * 0.5), fract(aSeed * 91.7 + floor(time * rate + aSeed * 17.0) * 0.618));
				vFlash = gate * smoothstep(0.0, 0.02, phase) * (1.0 - smoothstep(0.02, 0.09, phase));
				vec4 mv = modelViewMatrix * vec4(position, 1.0);
				gl_PointSize = vFlash * 260.0 / -mv.z;
				gl_Position = projectionMatrix * mv;
			}`,
		fragmentShader: /* glsl */ `
			varying float vFlash;
			void main() {
				vec2 c = gl_PointCoord - 0.5;
				float d = length(c);
				float core = smoothstep(0.5, 0.0, d);
				float cross = max(smoothstep(0.08, 0.0, abs(c.x)), smoothstep(0.08, 0.0, abs(c.y))) * smoothstep(0.5, 0.1, d);
				gl_FragColor = vec4(vec3(3.0, 3.1, 3.4) * (core * core + cross * 0.6) * vFlash, 1.0);
			}`,
	});
	const points = new THREE.Points(geometry, material);
	points.frustumCulled = false;
	return {
		points,
		update(time, amount) {
			uniforms.time.value = time;
			uniforms.amount.value = amount;
		},
	};
}
