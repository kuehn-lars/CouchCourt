/**
 * What is around the court: the apron's outer ground, a tiered bowl, a crowd
 * and four floodlight towers. Built once, never touched again — like
 * `court.ts`, none of this is per-frame cost.
 *
 * It exists because of what the camera change exposed. Once the lens was
 * long enough to frame the whole court, the court turned out to be floating
 * in an empty gradient: a blue rectangle, a dark rectangle, and then nothing
 * at all to the horizon. Most of "this looks cheap" was the absence of a
 * world, not the quality of the court.
 *
 * Still procedural primitives only, per
 * `llm-knowledge/decisions/0003-threejs-renderer.md` — boxes, a circle, and
 * one `InstancedMesh` for the entire crowd. The crowd is ~1,400 instances in
 * a single draw call with per-instance colour, which is why it can exist at
 * all without an artist or a frame budget.
 */

import * as THREE from "three";
import { BASELINE_Z, SINGLES_HALF_WIDTH } from "../../shared/sim/court.ts";

/** Where the playing surface stops and the stands begin. */
/**
 * Where the stands begin. Pushed well back from the first attempt: at
 * `SINGLES_HALF_WIDTH + 5.5` the front row was close enough to the tramlines
 * that a spectator and a player rendered at the same size, and the stadium
 * read as shelving rather than as a crowd. Scale is the whole illusion here.
 */
const BOWL_INNER_X = SINGLES_HALF_WIDTH + 8.4;
const BOWL_INNER_Z = BASELINE_Z + 8;

const TIERS = 9;
const TIER_DEPTH = 1.5;
const TIER_RISE = 0.52;

const CROWD_PER_TIER_SIDE = 128;
const CROWD_PER_TIER_END = 62;

const GROUND_RADIUS = 110;

const CONCRETE = "#2b3d4d";
const CONCRETE_EDGE = "#3a4f61";
const GROUND = "#0c1c28";

/** Crowd colours: muted, varied, never saturated enough to pull the eye off
 * the ball. A crowd that reads as texture, not as confetti. */
const CROWD_COLORS = [
	"#5b7fa0",
	"#6f8fae",
	"#7d7f96",
	"#8d7684",
	"#5f8189",
	"#7688a0",
	"#95839f",
	"#4f6d8a",
];

/** Height of a tier slab. Its top surface — where the seats go — is at
 * `tier.y + TIER_RISE`, which is the number that matters and the one that
 * was wrong the first time: seats placed at `tier.y + 0.35` were inside the
 * concrete, and the stadium rendered as an empty bowl. */
const SLAB_HEIGHT = TIER_RISE + 0.5;

/** One tier's footprint: a rectangular ring at height `y`, `depth` deep. */
interface Tier {
	readonly y: number;
	readonly innerX: number;
	readonly innerZ: number;
	readonly depth: number;
}

function tiers(): Tier[] {
	const out: Tier[] = [];
	for (let i = 0; i < TIERS; i++) {
		out.push({
			y: i * TIER_RISE,
			innerX: BOWL_INNER_X + i * TIER_DEPTH,
			innerZ: BOWL_INNER_Z + i * TIER_DEPTH,
			depth: TIER_DEPTH,
		});
	}
	return out;
}

/** The four slabs making up one rectangular tier. Boxes, not an extruded
 * ring: four `BoxGeometry` instances merged into one group is fewer lines
 * than a shape with a hole in it, and reads identically from 30m away. */
function tierSlabs(tier: Tier, material: THREE.Material): THREE.Mesh[] {
	const { y, innerX, innerZ, depth } = tier;
	const outerZ = innerZ + depth;
	const height = SLAB_HEIGHT;
	const slab = (sx: number, sz: number, x: number, z: number): THREE.Mesh => {
		const mesh = new THREE.Mesh(
			new THREE.BoxGeometry(sx, height, sz),
			material,
		);
		mesh.position.set(x, y + height / 2 - 0.5, z);
		return mesh;
	};
	return [
		slab(depth, outerZ * 2, -(innerX + depth / 2), 0),
		slab(depth, outerZ * 2, innerX + depth / 2, 0),
		slab(innerX * 2, depth, 0, -(innerZ + depth / 2)),
		slab(innerX * 2, depth, 0, innerZ + depth / 2),
	];
}

/** Every seat position in the bowl, in order, as a flat list. `y` is the
 * tier's top SURFACE; the instance builder adds half a body height so the
 * seats stand on it rather than in it. */
function crowdPositions(): { x: number; y: number; z: number }[] {
	const out: { x: number; y: number; z: number }[] = [];
	for (const tier of tiers()) {
		const x = tier.innerX + tier.depth * 0.5;
		const z = tier.innerZ + tier.depth * 0.5;
		const y = tier.y + TIER_RISE;
		for (let i = 0; i < CROWD_PER_TIER_SIDE; i++) {
			const t = (i + 0.5) / CROWD_PER_TIER_SIDE;
			const along = (t * 2 - 1) * z;
			out.push({ x: -x, y, z: along }, { x, y, z: along });
		}
		for (let i = 0; i < CROWD_PER_TIER_END; i++) {
			const t = (i + 0.5) / CROWD_PER_TIER_END;
			const along = (t * 2 - 1) * x;
			out.push({ x: along, y, z: -z }, { x: along, y, z });
		}
	}
	return out;
}

/**
 * The crowd. One `InstancedMesh`, one draw call, per-instance colour, and a
 * deterministic pseudo-random jitter so it is not a grid — `Math.random()`
 * would do here (nothing replays this), but a hash keeps two host screens
 * showing the same stadium, which matters the first time two people compare
 * screenshots of the same bug.
 */
function buildCrowd(): THREE.InstancedMesh {
	const positions = crowdPositions();
	const mesh = new THREE.InstancedMesh(
		new THREE.BoxGeometry(0.3, 0.52, 0.3),
		new THREE.MeshStandardMaterial({ roughness: 0.95 }),
		positions.length,
	);

	const matrix = new THREE.Matrix4();
	const position = new THREE.Vector3();
	const quaternion = new THREE.Quaternion();
	const scale = new THREE.Vector3();
	const color = new THREE.Color();

	positions.forEach((seat, i) => {
		// Cheap deterministic hash in [0, 1).
		const h = (n: number) => {
			const x = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453;
			return x - Math.floor(x);
		};
		const height = 0.85 + h(4) * 0.4;
		position.set(
			seat.x + (h(1) - 0.5) * 0.35,
			// BoxGeometry is centred, so half the scaled body height puts the
			// feet on the step rather than through it.
			seat.y + (0.52 * height) / 2 + (h(2) - 0.5) * 0.06,
			seat.z + (h(3) - 0.5) * 0.35,
		);
		scale.set(1, height, 1);
		matrix.compose(position, quaternion, scale);
		mesh.setMatrixAt(i, matrix);
		const swatch = CROWD_COLORS[Math.floor(h(5) * CROWD_COLORS.length)];
		mesh.setColorAt(i, color.set(swatch ?? "#3b5a72"));
	});
	mesh.instanceMatrix.needsUpdate = true;
	if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
	return mesh;
}

/** A floodlight tower: a mast and a glowing panel. The panel is emissive
 * only — it does not light anything. Four real lights would cost four more
 * shader passes to add highlights the tone mapping already implies. */
function buildFloodlight(x: number, z: number): THREE.Group {
	const group = new THREE.Group();
	const height = 15;

	const mast = new THREE.Mesh(
		new THREE.CylinderGeometry(0.22, 0.34, height, 8),
		new THREE.MeshStandardMaterial({ color: "#1b2732", roughness: 0.8 }),
	);
	mast.position.set(x, height / 2, z);
	group.add(mast);

	const panel = new THREE.Mesh(
		new THREE.BoxGeometry(3.4, 1.5, 0.3),
		new THREE.MeshStandardMaterial({
			color: "#ffe9c2",
			emissive: "#ffdca8",
			emissiveIntensity: 2.4,
			roughness: 0.4,
		}),
	);
	panel.position.set(x, height, z);
	panel.lookAt(0, 0, 0);
	group.add(panel);

	return group;
}

export function buildStadium(): THREE.Group {
	const group = new THREE.Group();

	// A ground disc wide enough that the fog, not an edge, is what ends the
	// world. The old apron simply stopped, and the seam was visible from the
	// broadcast camera.
	const ground = new THREE.Mesh(
		new THREE.CircleGeometry(GROUND_RADIUS, 48),
		new THREE.MeshStandardMaterial({ color: GROUND, roughness: 1 }),
	);
	ground.rotation.x = -Math.PI / 2;
	ground.position.y = -0.02;
	group.add(ground);

	const concrete = new THREE.MeshStandardMaterial({
		color: CONCRETE,
		roughness: 0.95,
	});
	const edge = new THREE.MeshStandardMaterial({
		color: CONCRETE_EDGE,
		roughness: 0.9,
	});
	for (const [i, tier] of tiers().entries()) {
		for (const slab of tierSlabs(tier, i === 0 ? edge : concrete)) {
			group.add(slab);
		}
	}

	group.add(buildCrowd());

	const towerX = BOWL_INNER_X + TIERS * TIER_DEPTH + 2;
	const towerZ = BOWL_INNER_Z + TIERS * TIER_DEPTH + 2;
	for (const sx of [-1, 1]) {
		for (const sz of [-1, 1]) {
			group.add(buildFloodlight(sx * towerX, sz * towerZ));
		}
	}

	return group;
}
