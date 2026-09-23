/**
 * A tennis player, built from primitives: pelvis, torso, head, two arms with
 * elbows and wrists, two legs with knees and shoes, and a racket. Cel-shaded
 * and ink-outlined (`toon.ts`), in the player's side colour.
 *
 * Every joint is a `Group` whose rotation is written straight from a `Pose`
 * (`poses.ts` documents the frame). Nothing here decides what pose to take;
 * `players.ts` does. After a pose is applied the rig puts its own lower foot
 * on the ground, so no pose ever has to know how long a leg is.
 *
 * Built once per player. `apply` mutates rotations and one position and
 * allocates nothing, per renderer rule 2 (`llm-knowledge/modules/host.md`).
 */

import * as THREE from "three";
import { JOINT_INDEX, type Joint, type Pose } from "./poses.ts";
import { outline, toon } from "./toon.ts";

export interface Look {
	readonly shirt: string;
	readonly trim: string;
	readonly shorts: string;
	readonly skin: string;
	readonly hair: string;
	/** A headband, a cap, or nothing. */
	readonly headwear: "band" | "cap" | "none";
	/** Officials and ball kids carry no racket. */
	readonly racket?: boolean;
	/** Spikes on top, a ponytail out the back, or neither. */
	readonly hairStyle?: "spikes" | "ponytail";
}

/** Metres, before `SCALE`. */
const THIGH = 0.44;
const SHIN = 0.44;
const ANKLE_HEIGHT = 0.085;
const UPPER_ARM = 0.29;
const FOREARM = 0.26;

/** Drawn a little larger than life, like the ball: a player 45m away has to
 * read as a person, not a pin. */
export const SCALE = 1.14;

const LINE = 0.016;

export interface Athlete {
	readonly root: THREE.Group;
	/** Where the strings are, for the swing smear. */
	readonly racketHead: THREE.Object3D;
	readonly racketThroat: THREE.Object3D;
	/** The ponytail's pivot, swung by `players.ts`; `null` without one. */
	readonly ponytail: THREE.Object3D | null;
	apply(pose: Pose): void;
}

type Order = "YXZ" | "ZYX";

function joint(
	parent: THREE.Object3D,
	x: number,
	y: number,
	z: number,
	order: Order,
): THREE.Group {
	const g = new THREE.Group();
	g.position.set(x, y, z);
	g.rotation.order = order;
	parent.add(g);
	return g;
}

function part(
	parent: THREE.Object3D,
	geometry: THREE.BufferGeometry,
	material: THREE.Material,
	y: number,
	ink = true,
): THREE.Mesh {
	const mesh = new THREE.Mesh(geometry, material);
	mesh.position.y = y;
	mesh.castShadow = true;
	if (ink) outline(mesh, LINE);
	parent.add(mesh);
	return mesh;
}

/** The racket: grip, open throat, an oval head and translucent strings. It
 * continues the forearm's line from the hand. */
function buildRacket(
	hand: THREE.Object3D,
	frameColor: string,
): { head: THREE.Object3D; throat: THREE.Object3D } {
	const racket = new THREE.Group();
	racket.position.y = -0.06;
	hand.add(racket);

	const grip = toon("#1b222c", { rimStrength: 0.2 });
	const frame = toon(frameColor, { rimStrength: 0.4 });

	part(racket, new THREE.CylinderGeometry(0.019, 0.017, 0.2, 8), grip, -0.06);
	for (const side of [-1, 1]) {
		const arm = new THREE.Mesh(
			new THREE.CylinderGeometry(0.009, 0.009, 0.15, 6),
			frame,
		);
		arm.position.set(side * 0.035, -0.22, 0);
		arm.rotation.z = side * 0.32;
		arm.castShadow = true;
		racket.add(arm);
	}

	const headGroup = new THREE.Group();
	headGroup.position.y = -0.43;
	racket.add(headGroup);
	const ring = new THREE.Mesh(
		new THREE.TorusGeometry(0.13, 0.014, 6, 28),
		frame,
	);
	ring.scale.set(1, 1.28, 1);
	ring.castShadow = true;
	outline(ring, 0.01);
	headGroup.add(ring);

	const strings = new THREE.Mesh(
		new THREE.CircleGeometry(0.128, 20),
		new THREE.MeshBasicMaterial({
			color: "#e9f6ff",
			transparent: true,
			opacity: 0.28,
			side: THREE.DoubleSide,
			depthWrite: false,
		}),
	);
	strings.scale.set(1, 1.28, 1);
	headGroup.add(strings);

	const throat = new THREE.Object3D();
	throat.position.y = -0.24;
	racket.add(throat);
	const tip = new THREE.Object3D();
	tip.position.y = -0.58;
	racket.add(tip);
	return { head: tip, throat };
}

function buildArm(
	chest: THREE.Object3D,
	side: 1 | -1,
	mats: { skin: THREE.Material; shirt: THREE.Material; trim: THREE.Material },
): { shoulder: THREE.Group; elbow: THREE.Group; wrist: THREE.Group } {
	const shoulder = joint(chest, side * 0.25, 0.39, 0, "ZYX");
	part(shoulder, new THREE.SphereGeometry(0.088, 14, 10), mats.shirt, 0);
	part(
		shoulder,
		new THREE.CylinderGeometry(0.08, 0.07, 0.14, 12),
		mats.shirt,
		-0.06,
	);
	// A bicep: wider at the top, like an arm rather than a pipe.
	const upper = part(
		shoulder,
		new THREE.CapsuleGeometry(0.062, UPPER_ARM - 0.12, 4, 12),
		mats.skin,
		-UPPER_ARM / 2,
	);
	upper.scale.set(1, 1, 1.08);
	const elbow = joint(shoulder, 0, -UPPER_ARM, 0, "ZYX");
	part(
		elbow,
		new THREE.CylinderGeometry(0.058, 0.045, FOREARM - 0.02, 12),
		mats.skin,
		-FOREARM / 2,
	);
	part(elbow, new THREE.SphereGeometry(0.058, 10, 8), mats.skin, 0);
	part(
		elbow,
		new THREE.CylinderGeometry(0.056, 0.056, 0.07, 12),
		mats.trim,
		-FOREARM + 0.06,
		false,
	);
	const wrist = joint(elbow, 0, -FOREARM, 0, "ZYX");
	const hand = part(
		wrist,
		new THREE.SphereGeometry(0.07, 12, 10),
		mats.skin,
		-0.04,
	);
	hand.scale.set(0.85, 1, 1.05);
	return { shoulder, elbow, wrist };
}

function buildLeg(
	pelvis: THREE.Object3D,
	side: 1 | -1,
	mats: {
		skin: THREE.Material;
		shorts: THREE.Material;
		shoe: THREE.Material;
		sole: THREE.Material;
		sock: THREE.Material;
	},
): { hip: THREE.Group; knee: THREE.Group; ankle: THREE.Group } {
	const hip = joint(pelvis, side * 0.105, -0.02, 0, "ZYX");
	part(
		hip,
		new THREE.CylinderGeometry(0.115, 0.1, 0.24, 12),
		mats.shorts,
		-0.1,
	);
	part(
		hip,
		new THREE.CylinderGeometry(0.095, 0.068, THIGH, 12),
		mats.skin,
		-THIGH / 2,
	);
	const knee = joint(hip, 0, -THIGH, 0, "ZYX");
	part(knee, new THREE.SphereGeometry(0.07, 10, 8), mats.skin, 0);
	// A calf: full just under the knee, thin at the ankle.
	const calf = part(
		knee,
		new THREE.CapsuleGeometry(0.068, SHIN * 0.4, 4, 12),
		mats.skin,
		-SHIN * 0.32,
	);
	calf.scale.set(1, 1, 1.12);
	part(
		knee,
		new THREE.CylinderGeometry(0.05, 0.045, SHIN * 0.6, 10),
		mats.skin,
		-SHIN * 0.62,
	);
	part(
		knee,
		new THREE.CylinderGeometry(0.056, 0.052, 0.12, 12),
		mats.sock,
		-SHIN + 0.08,
		false,
	);
	const ankle = joint(knee, 0, -SHIN, 0, "ZYX");
	const shoe = new THREE.Mesh(
		new THREE.CapsuleGeometry(0.068, 0.17, 4, 12),
		mats.shoe,
	);
	shoe.rotation.x = Math.PI / 2;
	shoe.scale.set(1, 1, 0.72);
	shoe.position.set(0, -0.04, -0.05);
	shoe.castShadow = true;
	outline(shoe, LINE);
	ankle.add(shoe);
	const sole = new THREE.Mesh(
		new THREE.BoxGeometry(0.125, 0.028, 0.3),
		mats.sole,
	);
	sole.position.set(0, -0.082, -0.055);
	ankle.add(sole);
	return { hip, knee, ankle };
}

export function buildAthlete(look: Look): Athlete {
	const skin = toon(look.skin, { rimStrength: 0.45 });
	const shirt = toon(look.shirt, { rimStrength: 0.42 });
	const trim = toon(look.trim, { rimStrength: 0.3 });
	const shorts = toon(look.shorts, { rimStrength: 0.45 });
	const hair = toon(look.hair, { rimStrength: 0.35 });
	// Off-white, and a weak rim: pure white under the key light blooms, and
	// the feet glow.
	const shoe = toon("#d9e0e7", { rimStrength: 0.12 });
	const sole = toon(look.trim, { rimStrength: 0 });
	const sock = toon("#e2e8ee", { rimStrength: 0.1 });

	const root = new THREE.Group();
	root.scale.setScalar(SCALE);
	const body = new THREE.Group();
	root.add(body);

	const pelvis = joint(body, 0, THIGH + SHIN + ANKLE_HEIGHT, 0, "YXZ");
	part(pelvis, new THREE.CylinderGeometry(0.17, 0.16, 0.2, 12), shorts, 0.02);

	const torso = joint(pelvis, 0, 0.08, 0, "YXZ");
	const chest = part(
		torso,
		new THREE.CylinderGeometry(0.245, 0.16, 0.44, 16),
		shirt,
		0.22,
	);
	chest.scale.z = 0.62;
	// A band of the trim colour across the chest: a kit, not a sock.
	const band = new THREE.Mesh(
		new THREE.CylinderGeometry(0.228, 0.214, 0.07, 16),
		trim,
	);
	band.position.y = 0.3;
	band.scale.z = 0.64;
	torso.add(band);
	part(torso, new THREE.CylinderGeometry(0.05, 0.058, 0.1, 10), skin, 0.47);

	const head = joint(torso, 0, 0.5, 0, "YXZ");
	const skull = part(head, new THREE.SphereGeometry(0.138, 18, 14), skin, 0.12);
	skull.scale.set(0.94, 1.02, 1);
	const hairCap = new THREE.Mesh(
		new THREE.SphereGeometry(0.136, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.52),
		hair,
	);
	hairCap.position.set(0, 0.13, 0.012);
	hairCap.rotation.x = 0.25;
	head.add(hairCap);
	const nose = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), skin);
	nose.position.set(0, 0.1, -0.135);
	head.add(nose);
	// Eyes and brows: invisible from the broadcast camera, and the whole
	// face on the victory close-up.
	const ink = new THREE.MeshBasicMaterial({ color: "#10151c" });
	for (const s of [-1, 1]) {
		const eye = new THREE.Mesh(new THREE.SphereGeometry(0.019, 8, 6), ink);
		eye.scale.set(0.8, 1.25, 0.5);
		eye.position.set(s * 0.046, 0.14, -0.124);
		head.add(eye);
		const brow = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.01), ink);
		brow.position.set(s * 0.048, 0.178, -0.12);
		brow.rotation.z = s * -0.12;
		head.add(brow);
	}
	// Hair that changes the silhouette: that is what tells two players
	// apart from 40m, more than any colour on the face.
	let ponytail: THREE.Object3D | null = null;
	if (look.hairStyle === "spikes") {
		for (let i = 0; i < 7; i++) {
			const a = (i / 7) * Math.PI * 2;
			const spike = new THREE.Mesh(
				new THREE.ConeGeometry(0.045, 0.12, 6),
				hair,
			);
			spike.position.set(Math.cos(a) * 0.07, 0.25, Math.sin(a) * 0.07 + 0.02);
			spike.rotation.set(Math.sin(a) * 0.7 + 0.2, 0, -Math.cos(a) * 0.7);
			outline(spike, 0.008);
			head.add(spike);
		}
	} else if (look.hairStyle === "ponytail") {
		const pivot = new THREE.Group();
		pivot.position.set(0, 0.18, 0.12);
		pivot.rotation.order = "YXZ";
		head.add(pivot);
		const tail = new THREE.Mesh(
			new THREE.CapsuleGeometry(0.045, 0.2, 4, 10),
			hair,
		);
		tail.position.y = -0.13;
		tail.castShadow = true;
		outline(tail, 0.01);
		pivot.add(tail);
		const tie = new THREE.Mesh(
			new THREE.TorusGeometry(0.035, 0.014, 6, 12),
			trim,
		);
		tie.rotation.x = Math.PI / 2;
		pivot.add(tie);
		ponytail = pivot;
	}
	if (look.headwear === "band") {
		const headband = new THREE.Mesh(
			new THREE.TorusGeometry(0.13, 0.022, 6, 20),
			trim,
		);
		headband.rotation.x = Math.PI / 2 + 0.2;
		headband.position.y = 0.16;
		head.add(headband);
	} else if (look.headwear === "cap") {
		const crown = new THREE.Mesh(
			new THREE.SphereGeometry(0.14, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.45),
			trim,
		);
		crown.position.y = 0.14;
		crown.rotation.x = 0.12;
		outline(crown, 0.01);
		head.add(crown);
		const peak = new THREE.Mesh(
			new THREE.CylinderGeometry(
				0.11,
				0.11,
				0.014,
				16,
				1,
				false,
				-Math.PI / 2,
				Math.PI,
			),
			trim,
		);
		peak.position.set(0, 0.17, -0.1);
		peak.rotation.x = -0.12;
		peak.scale.z = 0.9;
		head.add(peak);
	}

	const armMats = { skin, shirt, trim };
	const right = buildArm(torso, 1, armMats);
	const left = buildArm(torso, -1, armMats);
	const racket =
		look.racket === false
			? { head: right.wrist, throat: right.wrist }
			: buildRacket(right.wrist, look.trim);

	const legMats = { skin, shorts, shoe, sole, sock };
	const legR = buildLeg(pelvis, 1, legMats);
	const legL = buildLeg(pelvis, -1, legMats);

	const joints: Readonly<Record<Joint, THREE.Group>> = {
		pelvis,
		torso,
		head,
		shoulderR: right.shoulder,
		elbowR: right.elbow,
		wristR: right.wrist,
		shoulderL: left.shoulder,
		elbowL: left.elbow,
		wristL: left.wrist,
		hipR: legR.hip,
		kneeR: legR.knee,
		hipL: legL.hip,
		kneeL: legL.knee,
	};
	const entries = Object.entries(joints) as [Joint, THREE.Group][];
	const ankle = new THREE.Vector3();

	return {
		root,
		racketHead: racket.head,
		racketThroat: racket.throat,
		ponytail,
		apply(pose) {
			for (const [name, g] of entries) {
				const i = JOINT_INDEX[name];
				g.rotation.set(pose[i] ?? 0, pose[i + 1] ?? 0, pose[i + 2] ?? 0);
			}
			// Put the lower foot on the floor: measure both ankles in the
			// body's frame with the body at zero, then lift it by the
			// difference.
			body.position.y = 0;
			body.updateMatrixWorld(true);
			let low = Number.POSITIVE_INFINITY;
			for (const leg of [legR, legL]) {
				ankle.setFromMatrixPosition(leg.ankle.matrixWorld);
				body.worldToLocal(ankle);
				low = Math.min(low, ankle.y);
			}
			body.position.y = ANKLE_HEIGHT - low + (pose[0] ?? 0);
		},
	};
}
