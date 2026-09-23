/**
 * The static court: surface, lines, net and posts. Built once by
 * `buildCourt()` and never touched again.
 *
 * The playing surface is physically shaded, not toon: it is the one big
 * flat thing the floodlights can put a sheen across, and that sheen is most
 * of what makes it read as a surface under lights rather than as a coloured
 * rectangle. The characters on it are the drawn part
 * (`llm-knowledge/decisions/0018-stylised-stadium-renderer.md`).
 *
 * Lines are one `InstancedMesh`, nine segments, one draw call. The net's top
 * edge still calls `netHeightAt(x)` per vertex, so the sag on screen is the
 * sag the physics uses.
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
import { courtTexture, netTexture, wordmarkTexture } from "./textures.ts";
import { outline, toon } from "./toon.ts";

const LINE_WIDTH = 0.06;
const LINE_HEIGHT = 0.008;
const CENTER_MARK_LEN = 0.3;

/** How far the apron runs past the lines. Matches the stands' inner edge in
 * `stadium.ts`. */
export const APRON_X = SINGLES_HALF_WIDTH + 7.6;
export const APRON_Z = BASELINE_Z + 7.2;

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

function surface(
	width: number,
	length: number,
	texture: THREE.Texture,
	y: number,
): THREE.Mesh {
	const mesh = new THREE.Mesh(
		new THREE.PlaneGeometry(width, length),
		new THREE.MeshStandardMaterial({
			map: texture,
			roughness: 0.42,
			metalness: 0,
			envMapIntensity: 1.2,
		}),
	);
	mesh.rotation.x = -Math.PI / 2;
	mesh.position.y = y;
	mesh.receiveShadow = true;
	return mesh;
}

function buildGround(): { group: THREE.Group; marks: THREE.Mesh[] } {
	const group = new THREE.Group();
	const marks: THREE.Mesh[] = [];
	group.add(
		surface(
			APRON_X * 2,
			APRON_Z * 2,
			courtTexture("#08263d", "#12405f", [0.13, 0.87]),
			0,
		),
	);
	group.add(
		surface(
			SINGLES_HALF_WIDTH * 2 + 0.5,
			BASELINE_Z * 2,
			courtTexture("#1a5fa3", "#2f78bb", [0.02, 0.5, 0.98]),
			0.002,
		),
	);

	// The name, painted on the apron behind each baseline. Both read from
	// the near end, where the broadcast camera sits, until a split screen
	// turns the far one round for the far half (`Court.setSplit`).
	const mark = wordmarkTexture();
	for (const z of [-1, 1]) {
		const plane = new THREE.Mesh(
			new THREE.PlaneGeometry(7.2, 1.12),
			new THREE.MeshStandardMaterial({
				map: mark,
				transparent: true,
				opacity: 0.7,
				roughness: 0.5,
				depthWrite: false,
				polygonOffset: true,
				polygonOffsetFactor: -2,
			}),
		);
		plane.rotation.x = -Math.PI / 2;
		plane.position.set(0, 0.004, z * (BASELINE_Z + 3.4));
		plane.receiveShadow = true;
		group.add(plane);
		marks.push(plane);
	}
	return { group, marks };
}

function buildLines(): THREE.InstancedMesh {
	const lines = new THREE.InstancedMesh(
		new THREE.BoxGeometry(1, 1, 1),
		new THREE.MeshStandardMaterial({
			color: "#f6fbff",
			emissive: "#f6fbff",
			emissiveIntensity: 0.05,
			roughness: 0.5,
		}),
		LINE_SEGMENTS.length,
	);
	const matrix = new THREE.Matrix4();
	LINE_SEGMENTS.forEach((seg, i) => {
		matrix.compose(
			new THREE.Vector3(seg.cx, 0.003 + LINE_HEIGHT / 2, seg.cz),
			new THREE.Quaternion(),
			new THREE.Vector3(seg.sx, LINE_HEIGHT, seg.sz),
		);
		lines.setMatrixAt(i, matrix);
	});
	lines.instanceMatrix.needsUpdate = true;
	lines.receiveShadow = true;
	return lines;
}

/** A strip along the net whose top follows `netHeightAt`, from `drop`
 * below the cord to the cord. */
function netStrip(drop: number | null, segments: number): THREE.BufferGeometry {
	const positions: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];
	for (let i = 0; i <= segments; i++) {
		const u = i / segments;
		const x = -NET_POST_X + u * NET_POST_X * 2;
		const top = netHeightAt(x);
		const bottom = drop === null ? 0 : top - drop;
		positions.push(x, bottom, 0, x, top, 0);
		uvs.push(u, 0, u, 1);
		if (i < segments) {
			const a = i * 2;
			indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
		}
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute(
		"position",
		new THREE.Float32BufferAttribute(positions, 3),
	);
	geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
	geometry.setIndex(indices);
	geometry.computeVertexNormals();
	return geometry;
}

function buildNet(): THREE.Group {
	const group = new THREE.Group();

	const mesh = netTexture();
	// A 4.5cm diamond, across the width and up the height.
	mesh.repeat.set((NET_POST_X * 2) / 0.09, NET_HEIGHT_POST / 0.09);
	const net = new THREE.Mesh(
		netStrip(null, 32),
		new THREE.MeshStandardMaterial({
			map: mesh,
			transparent: true,
			alphaTest: 0.05,
			side: THREE.DoubleSide,
			roughness: 1,
			depthWrite: false,
		}),
	);
	group.add(net);

	const band = new THREE.Mesh(
		netStrip(0.065, 32),
		new THREE.MeshStandardMaterial({
			color: "#f7fbff",
			emissive: "#ffffff",
			emissiveIntensity: 0.15,
			side: THREE.DoubleSide,
			roughness: 0.6,
		}),
	);
	band.position.z = 0.004;
	band.castShadow = true;
	group.add(band);

	const strap = new THREE.Mesh(
		new THREE.BoxGeometry(0.05, netHeightAt(0), 0.012),
		new THREE.MeshStandardMaterial({ color: "#f7fbff", roughness: 0.6 }),
	);
	strap.position.y = netHeightAt(0) / 2;
	group.add(strap);

	const post = toon("#10263a", { rimStrength: 0.4 });
	const cap = toon("#dcff4a", {
		rimStrength: 0.3,
		emissive: "#dcff4a",
		emissiveIntensity: 0.25,
	});
	for (const side of [-1, 1] as const) {
		const p = new THREE.Mesh(
			new THREE.CylinderGeometry(0.055, 0.06, NET_HEIGHT_POST + 0.04, 12),
			post,
		);
		p.position.set(side * NET_POST_X, (NET_HEIGHT_POST + 0.04) / 2, 0);
		p.castShadow = true;
		outline(p, 0.014);
		group.add(p);
		const c = new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 8), cap);
		c.position.set(side * NET_POST_X, NET_HEIGHT_POST + 0.05, 0);
		group.add(c);
	}
	return group;
}

export interface Court {
	readonly group: THREE.Group;
	setSplit(split: boolean): void;
}

export function buildCourt(): Court {
	const group = new THREE.Group();
	const ground = buildGround();
	group.add(ground.group);
	group.add(buildLines());
	group.add(buildNet());
	const [far] = ground.marks;
	return {
		group,
		setSplit(split) {
			if (far) far.rotation.z = split ? Math.PI : 0;
		},
	};
}
