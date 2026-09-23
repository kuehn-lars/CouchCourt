/**
 * Everything round the court: the walls with their LED boards, a tiered
 * bowl, the crowd (`crowd.ts`), a ribbon board between the tiers, a roof
 * ring, and four floodlight towers throwing beams of light down through the
 * haze. Built once; `update` scrolls the boards and drives the crowd.
 *
 * Light is the point of all of it. The court is a stage, and what makes a
 * night stadium read as one is bright sources — lamp grids, LED boards, the
 * lit edge of the roof — against dark mass, with bloom (`post.ts`) turning
 * the sources into light. Everything that glows here is emissive only;
 * nothing but the key light in `scene.ts` actually lights anything.
 */

import * as THREE from "three";
import { APRON_X, APRON_Z } from "./court.ts";
import { buildCrowd, type Seat } from "./crowd.ts";
import { ledTexture } from "./textures.ts";
import { toon } from "./toon.ts";

const WALL_HEIGHT = 1.05;
const TIERS = 12;
const TIER_DEPTH = 1.35;
const TIER_RISE = 0.62;
/** A gap between the wall and the first row, the walkway. */
const WALKWAY = 1.2;
const BOWL_X = APRON_X + WALKWAY;
const BOWL_Z = APRON_Z + WALKWAY;
/** Where the ribbon board runs, in tiers from the front. */
const RIBBON_TIER = 6;
const RIBBON_HEIGHT = 0.9;

const SEATS_PER_METRE = 1.6;

interface Tier {
	readonly y: number;
	readonly x: number;
	readonly z: number;
}

const tier = (i: number): Tier => {
	// The upper deck sits back behind the ribbon board.
	const step = i >= RIBBON_TIER ? 1.6 : 0;
	return {
		y: WALL_HEIGHT + i * TIER_RISE + (i >= RIBBON_TIER ? RIBBON_HEIGHT : 0),
		x: BOWL_X + i * TIER_DEPTH + step,
		z: BOWL_Z + i * TIER_DEPTH + step,
	};
};

/** A rectangular ring of four boxes: inner half-extents `x`, `z`, `depth`
 * deep, `height` tall, top at `top`. */
function ring(
	x: number,
	z: number,
	depth: number,
	height: number,
	top: number,
	material: THREE.Material,
): THREE.Mesh[] {
	const y = top - height / 2;
	const box = (sx: number, sz: number, px: number, pz: number) => {
		const mesh = new THREE.Mesh(
			new THREE.BoxGeometry(sx, height, sz),
			material,
		);
		mesh.position.set(px, y, pz);
		mesh.receiveShadow = true;
		return mesh;
	};
	const outerZ = z + depth;
	return [
		box(depth, outerZ * 2, -(x + depth / 2), 0),
		box(depth, outerZ * 2, x + depth / 2, 0),
		box(x * 2, depth, 0, -(z + depth / 2)),
		box(x * 2, depth, 0, z + depth / 2),
	];
}

/** LED faces for a ring's inner walls: four planes facing the court. */
function ledRing(
	x: number,
	z: number,
	height: number,
	bottom: number,
	material: THREE.Material,
): THREE.Mesh[] {
	const plane = (width: number, px: number, pz: number, ry: number) => {
		const mesh = new THREE.Mesh(
			new THREE.PlaneGeometry(width, height),
			material,
		);
		mesh.position.set(px, bottom + height / 2, pz);
		mesh.rotation.y = ry;
		return mesh;
	};
	return [
		plane(z * 2, -x + 0.01, 0, Math.PI / 2),
		plane(z * 2, x - 0.01, 0, -Math.PI / 2),
		plane(x * 2, 0, -z + 0.01, 0),
		plane(x * 2, 0, z - 0.01, Math.PI),
	];
}

function seats(): Seat[] {
	const out: Seat[] = [];
	for (let i = 0; i < TIERS; i++) {
		const t = tier(i);
		const x = t.x + TIER_DEPTH * 0.5;
		const z = t.z + TIER_DEPTH * 0.5;
		const y = t.y;
		const alongZ = Math.floor(z * 2 * SEATS_PER_METRE);
		const alongX = Math.floor(x * 2 * SEATS_PER_METRE);
		for (let k = 0; k < alongZ; k++) {
			const along = ((k + 0.5) / alongZ) * 2 - 1;
			out.push({ x: -x, y, z: along * z }, { x, y, z: along * z });
		}
		for (let k = 0; k < alongX; k++) {
			const along = ((k + 0.5) / alongX) * 2 - 1;
			// Leave the aisles behind each baseline empty: a tunnel mouth.
			if (Math.abs(along * x) < 1.4 && i < 4) continue;
			out.push({ x: along * x, y, z: -z }, { x: along * x, y, z });
		}
	}
	return out;
}

/** A floodlight tower: a lattice mast and a lamp head of 4x6 lamps, turned
 * to the court, plus the beam it throws. */
function floodlight(
	x: number,
	z: number,
	lamp: THREE.Material,
	steel: THREE.Material,
	beam: THREE.Material,
): THREE.Group {
	const group = new THREE.Group();
	const height = 30;
	const mast = new THREE.Mesh(
		new THREE.CylinderGeometry(0.28, 0.6, height, 8),
		steel,
	);
	mast.position.set(x, height / 2, z);
	group.add(mast);

	const head = new THREE.Group();
	head.position.set(x, height, z);
	head.lookAt(0, 0, 0);
	group.add(head);
	const frame = new THREE.Mesh(new THREE.BoxGeometry(5.6, 3.6, 0.4), steel);
	head.add(frame);
	const lamps = new THREE.InstancedMesh(
		new THREE.BoxGeometry(0.75, 0.65, 0.12),
		lamp,
		24,
	);
	const m = new THREE.Matrix4();
	for (let r = 0; r < 4; r++) {
		for (let c = 0; c < 6; c++) {
			m.makeTranslation(-2.2 + c * 0.88, -1.2 + r * 0.8, 0.24);
			lamps.setMatrixAt(r * 6 + c, m);
		}
	}
	head.add(lamps);

	// The beam: an open cone from the lamp head to the court, lit only by
	// its own shader. It fades along its length and toward its edges.
	const length = Math.hypot(x, height, z) * 0.92;
	const cone = new THREE.Mesh(
		new THREE.CylinderGeometry(11, 2.4, length, 32, 1, true),
		beam,
	);
	cone.position.set(0, 0, length / 2);
	cone.rotation.x = Math.PI / 2;
	head.add(cone);
	return group;
}

function beamMaterial(): THREE.ShaderMaterial {
	return new THREE.ShaderMaterial({
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
		side: THREE.DoubleSide,
		fog: false,
		uniforms: { color: { value: new THREE.Color("#ffe6c4") } },
		vertexShader: /* glsl */ `
			varying float vAlong;
			varying float vEdge;
			void main() {
				vAlong = uv.y;
				vec3 n = normalize(normalMatrix * normal);
				vec4 mv = modelViewMatrix * vec4(position, 1.0);
				vEdge = abs(dot(n, normalize(-mv.xyz)));
				gl_Position = projectionMatrix * mv;
			}`,
		fragmentShader: /* glsl */ `
			uniform vec3 color;
			varying float vAlong;
			varying float vEdge;
			void main() {
				// uv.y is 1 at the court end: brightest at the lamp, gone by the floor.
				// Clamped: interpolation overshoots 1 at the court end, and pow
				// of a negative is NaN on Metal, which bloom smears into blocks.
				float a = pow(max(1.0 - vAlong, 0.0), 1.3) * vEdge * vEdge * 0.075;
				gl_FragColor = vec4(color * a, 1.0);
			}`,
	});
}

export interface Stadium {
	readonly group: THREE.Group;
	update(dt: number, excite: number, wave: number, flashes: number): void;
}

export function buildStadium(): Stadium {
	const group = new THREE.Group();

	const ground = new THREE.Mesh(
		new THREE.CircleGeometry(140, 48),
		new THREE.MeshStandardMaterial({ color: "#070f17", roughness: 1 }),
	);
	ground.rotation.x = -Math.PI / 2;
	ground.position.y = -0.03;
	group.add(ground);

	// The wall round the court, and its LED boards.
	const wall = toon("#0a1826", { rimStrength: 0.15 });
	for (const mesh of ring(
		APRON_X,
		APRON_Z,
		0.4,
		WALL_HEIGHT,
		WALL_HEIGHT,
		wall,
	)) {
		group.add(mesh);
	}
	const led = ledTexture();
	led.repeat.set(6, 1);
	const board = new THREE.MeshBasicMaterial({ map: led, toneMapped: true });
	board.color.setScalar(1.8);
	for (const mesh of ledRing(
		APRON_X,
		APRON_Z,
		WALL_HEIGHT * 0.8,
		0.12,
		board,
	)) {
		group.add(mesh);
	}

	// The bowl.
	const concrete = new THREE.MeshStandardMaterial({
		color: "#1a2a3a",
		roughness: 0.9,
	});
	const lip = new THREE.MeshStandardMaterial({
		color: "#26394c",
		roughness: 0.7,
	});
	for (let i = 0; i < TIERS; i++) {
		const t = tier(i);
		for (const mesh of ring(
			t.x,
			t.z,
			TIER_DEPTH,
			t.y + 0.1,
			t.y,
			i === 0 ? lip : concrete,
		)) {
			group.add(mesh);
		}
	}

	// The ribbon board: an LED band round the whole bowl between the decks.
	const ribbonTex = ledTexture();
	ribbonTex.repeat.set(10, 1);
	const ribbon = new THREE.MeshBasicMaterial({ map: ribbonTex });
	ribbon.color.setScalar(2.2);
	const r = tier(RIBBON_TIER);
	const ribbonBottom = r.y - RIBBON_HEIGHT - 0.05;
	for (const mesh of ledRing(
		r.x,
		r.z,
		RIBBON_HEIGHT * 0.85,
		ribbonBottom,
		ribbon,
	)) {
		group.add(mesh);
	}

	const crowd = buildCrowd(seats());
	group.add(crowd.group);

	// The roof ring, with a strip of light along its inner edge.
	const top = tier(TIERS - 1);
	const roofY = top.y + 7;
	const roof = toon("#0b1520", { rimStrength: 0.1 });
	for (const mesh of ring(top.x - 3, top.z - 3, 11, 1.2, roofY, roof)) {
		group.add(mesh);
	}
	const strip = new THREE.MeshBasicMaterial({ color: "#bfe6ff" });
	strip.color.multiplyScalar(2.6);
	for (const mesh of ledRing(top.x - 3, top.z - 3, 0.18, roofY - 1.25, strip)) {
		group.add(mesh);
	}

	const lamp = new THREE.MeshBasicMaterial({ color: "#fff4df" });
	lamp.color.multiplyScalar(9);
	const steel = new THREE.MeshStandardMaterial({
		color: "#1b2733",
		roughness: 0.7,
	});
	const beam = beamMaterial();
	const towerX = top.x + 6;
	const towerZ = top.z + 6;
	for (const sx of [-1, 1]) {
		for (const sz of [-1, 1]) {
			group.add(floodlight(sx * towerX, sz * towerZ, lamp, steel, beam));
		}
	}

	let scroll = 0;
	return {
		group,
		update(dt, excite, wave, flashes) {
			scroll = (scroll + dt * 0.035) % 1;
			led.offset.x = scroll;
			ribbonTex.offset.x = -scroll * 0.6;
			crowd.update(dt, excite, wave, flashes);
		},
	};
}
