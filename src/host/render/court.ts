/**
 * The static court: ground, lines and net. Built once by `buildCourt()` and
 * never touched again — nothing here moves, so none of it is per-frame cost.
 *
 * All geometry is procedural primitives, per
 * `llm-knowledge/decisions/0003-threejs-renderer.md` (no artist, no sprites,
 * which is also what keeps this "own assets only" for free). Lines are one
 * `InstancedMesh` — nine segments, one draw call — per
 * `llm-knowledge/plans/2026-09-19-simulation.md` phase 8, rule 5.
 */

import * as THREE from "three";
import {
	BASELINE_Z,
	NET_HEIGHT_POST,
	NET_POST_X,
	netHeightAt,
	SERVICE_LINE_Z,
	SINGLES_HALF_WIDTH,
} from "../../shared/sim/court.ts";

const LINE_WIDTH = 0.06;
const LINE_HEIGHT = 0.015;
const CENTER_MARK_LEN = 0.3;

const COURT_BLUE = "#1f6fa8";
const APRON_TEAL = "#0d3550";
const LINE_WHITE = "#f4f8fb";
const NET_TOP_COLOR = new THREE.Color("#f4f8fb");
const NET_BOTTOM_COLOR = new THREE.Color("#7f97a3");
const POST_COLOR = "#1a1a1a";

interface LineSegment {
	readonly cx: number;
	readonly cz: number;
	readonly sx: number;
	readonly sz: number;
}

const LINE_SEGMENTS: readonly LineSegment[] = [
	{ cx: 0, cz: BASELINE_Z, sx: SINGLES_HALF_WIDTH * 2, sz: LINE_WIDTH },
	{ cx: 0, cz: -BASELINE_Z, sx: SINGLES_HALF_WIDTH * 2, sz: LINE_WIDTH },
	{ cx: -SINGLES_HALF_WIDTH, cz: 0, sx: LINE_WIDTH, sz: BASELINE_Z * 2 },
	{ cx: SINGLES_HALF_WIDTH, cz: 0, sx: LINE_WIDTH, sz: BASELINE_Z * 2 },
	{ cx: 0, cz: SERVICE_LINE_Z, sx: SINGLES_HALF_WIDTH * 2, sz: LINE_WIDTH },
	{ cx: 0, cz: -SERVICE_LINE_Z, sx: SINGLES_HALF_WIDTH * 2, sz: LINE_WIDTH },
	{ cx: 0, cz: 0, sx: LINE_WIDTH, sz: SERVICE_LINE_Z * 2 },
	{
		cx: 0,
		cz: BASELINE_Z - CENTER_MARK_LEN / 2,
		sx: LINE_WIDTH,
		sz: CENTER_MARK_LEN,
	},
	{
		cx: 0,
		cz: -BASELINE_Z + CENTER_MARK_LEN / 2,
		sx: LINE_WIDTH,
		sz: CENTER_MARK_LEN,
	},
];

function buildGround(): THREE.Group {
	const group = new THREE.Group();

	const apron = new THREE.Mesh(
		new THREE.PlaneGeometry(SINGLES_HALF_WIDTH * 2 + 7, BASELINE_Z * 2 + 8),
		new THREE.MeshStandardMaterial({ color: APRON_TEAL, roughness: 1 }),
	);
	apron.rotation.x = -Math.PI / 2;
	group.add(apron);

	const inCourt = new THREE.Mesh(
		new THREE.PlaneGeometry(SINGLES_HALF_WIDTH * 2, BASELINE_Z * 2),
		new THREE.MeshStandardMaterial({ color: COURT_BLUE, roughness: 0.9 }),
	);
	inCourt.rotation.x = -Math.PI / 2;
	inCourt.position.y = 0.001;
	group.add(inCourt);

	return group;
}

function buildLines(): THREE.InstancedMesh {
	const lines = new THREE.InstancedMesh(
		new THREE.BoxGeometry(1, 1, 1),
		new THREE.MeshBasicMaterial({ color: LINE_WHITE }),
		LINE_SEGMENTS.length,
	);
	const matrix = new THREE.Matrix4();
	LINE_SEGMENTS.forEach((seg, i) => {
		matrix.compose(
			new THREE.Vector3(seg.cx, 0.002 + LINE_HEIGHT / 2, seg.cz),
			new THREE.Quaternion(),
			new THREE.Vector3(seg.sx, LINE_HEIGHT, seg.sz),
		);
		lines.setMatrixAt(i, matrix);
	});
	lines.instanceMatrix.needsUpdate = true;
	return lines;
}

/** Sagging net mesh: a triangle strip whose top edge follows `netHeightAt`,
 * so a ball clipping the band near a post genuinely meets more net than one
 * clipping it at the centre — see `court.ts`. */
function buildNet(): THREE.Group {
	const group = new THREE.Group();
	const segments = 32;
	const positions = new Float32Array((segments + 1) * 2 * 3);
	const colors = new Float32Array((segments + 1) * 2 * 3);
	const indices: number[] = [];

	for (let i = 0; i <= segments; i++) {
		const x = -NET_POST_X + (i / segments) * NET_POST_X * 2;
		const top = netHeightAt(x);
		const base = i * 6;
		positions[base] = x;
		positions[base + 1] = 0;
		positions[base + 2] = 0;
		positions[base + 3] = x;
		positions[base + 4] = top;
		positions[base + 5] = 0;
		NET_BOTTOM_COLOR.toArray(colors, base);
		NET_TOP_COLOR.toArray(colors, base + 3);

		if (i < segments) {
			const a = i * 2;
			const b = a + 1;
			const c = a + 2;
			const d = a + 3;
			indices.push(a, b, c, b, d, c);
		}
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
	geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
	geometry.setIndex(indices);
	geometry.computeVertexNormals();

	const mesh = new THREE.Mesh(
		geometry,
		new THREE.MeshStandardMaterial({
			vertexColors: true,
			transparent: true,
			opacity: 0.6,
			side: THREE.DoubleSide,
			roughness: 1,
		}),
	);
	group.add(mesh);

	const postGeometry = new THREE.CylinderGeometry(
		0.04,
		0.04,
		NET_HEIGHT_POST,
		8,
	);
	const postMaterial = new THREE.MeshStandardMaterial({ color: POST_COLOR });
	for (const side of [-1, 1] as const) {
		const post = new THREE.Mesh(postGeometry, postMaterial);
		post.position.set(side * NET_POST_X, NET_HEIGHT_POST / 2, 0);
		group.add(post);
	}

	return group;
}

export function buildCourt(): THREE.Group {
	const group = new THREE.Group();
	group.add(buildGround());
	group.add(buildLines());
	group.add(buildNet());
	return group;
}
