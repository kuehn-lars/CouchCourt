/**
 * The two players, moving: where they stand comes from the sim, and how they
 * stand is layered here, lowest first —
 *
 * 1. **Stance.** The ready position while a point is live, standing at ease
 *    between points.
 * 2. **Running.** A run or a side-shuffle, driven by distance covered, so the
 *    feet never skate at any speed the sim moves them.
 * 3. **Readying.** From 0.65s before the ball arrives the racket goes back
 *    into the stroke the sim has set them up for; during a serve toss, the
 *    trophy position.
 * 4. **The stroke**, or after a point a fist pump or a hang of the head.
 *    Strokes join just before their contact frame (`strokeEntry`), because a
 *    stroke is only known once the ball has been struck.
 *
 * The upper layers only take part of the legs (`mixUpper`), so a player who
 * swings on the run keeps running.
 *
 * A racket moving fast leaves a smear behind it: the swing arc, drawn the
 * way an animator draws one, bright enough to bloom.
 */

import * as THREE from "three";
import type { Side } from "../../shared/protocol.ts";
import { PLAYER_SPEED } from "../../shared/sim/players.ts";
import type { Player } from "../../shared/sim/state.ts";
import { type Athlete, buildAthlete, type Look } from "./athlete.ts";
import {
	type ActionName,
	CLIPS,
	type Clip,
	gait,
	mix,
	mixUpper,
	POSE_LENGTH,
	type Pose,
	READY,
	STAND,
	type StrokeAnim,
	sample,
	strokeEntry,
	TROPHY,
} from "./poses.ts";

/** Coral and ice, mirrored in `host.css` (`--near`, `--far`) and on the
 * phone, so a player finds themselves on court by colour (decision 0017). */
export const SIDE_COLOR: Readonly<Record<Side, string>> = {
	near: "#ff5d73",
	far: "#5ac8fa",
};

const LOOKS: Readonly<Record<Side, Look>> = {
	near: {
		shirt: SIDE_COLOR.near,
		trim: "#ffe3e8",
		shorts: "#18202c",
		skin: "#e3a878",
		hair: "#2a1c14",
		headwear: "band",
		hairStyle: "spikes",
	},
	far: {
		shirt: SIDE_COLOR.far,
		trim: "#0e2a44",
		shorts: "#eef3f7",
		skin: "#b97c53",
		hair: "#2b1a12",
		headwear: "cap",
		hairStyle: "ponytail",
	},
};

/** Seconds before contact the racket starts back, and when it is all the
 * way back. */
const READY_FROM = 0.65;
const READY_BY = 0.2;

/** Per-swing variety, cycled rather than random: two identical forehands in
 * a row read as a loop. Scales the stroke's speed. */
const VARIATION: readonly number[] = [1, 0.93, 1.07, 0.96, 1.04, 0.9];

const smooth = (t: number) => {
	const c = Math.min(1, Math.max(0, t));
	return c * c * (3 - 2 * c);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** What the players are doing this frame, beyond where they are. */
export interface PlayersCue {
	/** The side about to hit, the stroke they are set for, and seconds
	 * until the ball reaches them. */
	readonly ready: {
		readonly side: Side;
		readonly stroke: StrokeAnim;
		readonly inSeconds: number;
	} | null;
	/** The server, while the ball is up on the toss. */
	readonly tossing: Side | null;
	/** The server, while they still have the ball in hand: they stand at
	 * ease until they toss, and everyone else is in the ready position. */
	readonly serving: Side | null;
}

interface Playing {
	readonly clip: Clip;
	/** Seconds into the clip. */
	t: number;
	readonly rate: number;
	/** How much of the legs the clip takes. */
	readonly legs: number;
}

const SMEAR = 12;

interface Rig {
	readonly athlete: Athlete;
	readonly baseYaw: number;
	readonly out: Pose;
	readonly scratch: Pose;
	readonly running: Pose;
	playing: Playing | null;
	phase: number;
	speed: number;
	lateral: number;
	lastX: number;
	lastZ: number;
	seeded: boolean;
	coil: number;
	toss: number;
	live: number;
	swings: number;
	bob: number;
	/** The ponytail as a damped spring: angle and angular velocity, about
	 * the pivot's x (back and forth) and z (side to side). */
	readonly tail: { x: number; z: number; vx: number; vz: number };
	readonly smear: {
		readonly mesh: THREE.Mesh;
		readonly head: THREE.Vector3[];
		readonly throat: THREE.Vector3[];
		cursor: number;
		energy: number;
	};
}

function smearMesh(color: string): THREE.Mesh {
	const positions = new Float32Array(SMEAR * 2 * 3);
	const alphas = new Float32Array(SMEAR * 2);
	const indices: number[] = [];
	for (let i = 0; i < SMEAR - 1; i++) {
		const a = i * 2;
		indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
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
	const mesh = new THREE.Mesh(
		geometry,
		new THREE.ShaderMaterial({
			transparent: true,
			depthWrite: false,
			side: THREE.DoubleSide,
			blending: THREE.AdditiveBlending,
			uniforms: { tint: { value: new THREE.Color(color) } },
			vertexShader: /* glsl */ `
				attribute float aAlpha;
				varying float vAlpha;
				void main() {
					vAlpha = aAlpha;
					gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
				}`,
			fragmentShader: /* glsl */ `
				uniform vec3 tint;
				varying float vAlpha;
				void main() {
					vec3 col = mix(tint, vec3(1.6), vAlpha);
					gl_FragColor = vec4(col * vAlpha, 1.0);
				}`,
		}),
	);
	mesh.frustumCulled = false;
	return mesh;
}

export interface PlayersVisual {
	update(
		previous: Readonly<Record<Side, Player>>,
		current: Readonly<Record<Side, Player>>,
		alpha: number,
		dt: number,
		cue: PlayersCue,
	): void;
	/** Plays `stroke` on `side`, harder for more `power`. */
	swing(side: Side, stroke: StrokeAnim, power: number): void;
	/** The point is over: `winner` celebrates, the other hangs their head. */
	react(winner: Side): void;
	/** Where each player is drawn, for the cameras. */
	readonly at: Readonly<Record<Side, { x: number; z: number }>>;
	/** Keep celebrating: the winner pumps a fist again whenever the last
	 * one has finished. For the end of a match. */
	celebrate(winner: Side): void;
}

export function createPlayersVisual(scene: THREE.Scene): PlayersVisual {
	const make = (side: Side): Rig => {
		const athlete = buildAthlete(LOOKS[side]);
		const baseYaw = side === "near" ? 0 : Math.PI;
		athlete.root.rotation.y = baseYaw;
		scene.add(athlete.root);
		const mesh = smearMesh(SIDE_COLOR[side]);
		scene.add(mesh);
		return {
			athlete,
			baseYaw,
			out: new Float32Array(POSE_LENGTH),
			scratch: new Float32Array(POSE_LENGTH),
			running: new Float32Array(POSE_LENGTH),
			playing: null,
			phase: 0,
			speed: 0,
			lateral: 0,
			lastX: 0,
			lastZ: 0,
			seeded: false,
			coil: 0,
			toss: 0,
			live: 0,
			swings: 0,
			bob: 0,
			tail: { x: -0.35, z: 0, vx: 0, vz: 0 },
			smear: {
				mesh,
				head: Array.from({ length: SMEAR }, () => new THREE.Vector3()),
				throat: Array.from({ length: SMEAR }, () => new THREE.Vector3()),
				cursor: 0,
				energy: 0,
			},
		};
	};
	const rigs: Readonly<Record<Side, Rig>> = {
		near: make("near"),
		far: make("far"),
	};
	const drawnAt: Record<Side, { x: number; z: number }> = {
		near: { x: 0, z: 0 },
		far: { x: 0, z: 0 },
	};

	function play(
		rig: Rig,
		name: ActionName,
		rate: number,
		legs: number,
		from = 0,
	) {
		const clip = CLIPS[name];
		rig.playing = { clip, t: from * clip.duration, rate, legs };
	}

	const tip = new THREE.Vector3();
	const neck = new THREE.Vector3();

	function updateSmear(rig: Rig, dt: number): void {
		const s = rig.smear;
		rig.athlete.racketHead.getWorldPosition(tip);
		rig.athlete.racketThroat.getWorldPosition(neck);
		const last = s.head[s.cursor] ?? tip;
		const speed = dt > 0 ? tip.distanceTo(last) / dt : 0;
		s.cursor = (s.cursor + 1) % SMEAR;
		s.head[s.cursor]?.copy(tip);
		s.throat[s.cursor]?.copy(neck);
		// Only a real swing smears: a racket carried on a run does not.
		const target = Math.min(1, Math.max(0, (speed - 4) / 6));
		s.energy = Math.max(target, s.energy * Math.exp(-dt * 10));

		const position = s.mesh.geometry.getAttribute("position");
		const alpha = s.mesh.geometry.getAttribute("aAlpha");
		for (let i = 0; i < SMEAR; i++) {
			const idx = (s.cursor - i + SMEAR) % SMEAR;
			const h = s.head[idx];
			const n = s.throat[idx];
			if (!h || !n) continue;
			const age = 1 - i / (SMEAR - 1);
			// Tapers toward the tail, and toward the throat.
			position.setXYZ(
				i * 2,
				lerp(h.x, n.x, 0.55 + 0.45 * (1 - age)),
				lerp(h.y, n.y, 0.55 + 0.45 * (1 - age)),
				lerp(h.z, n.z, 0.55 + 0.45 * (1 - age)),
			);
			position.setXYZ(i * 2 + 1, h.x, h.y, h.z);
			const a = age * age * s.energy * 0.85;
			alpha.setX(i * 2, a * 0.2);
			alpha.setX(i * 2 + 1, a);
		}
		position.needsUpdate = true;
		alpha.needsUpdate = true;
	}

	function animate(
		side: Side,
		rig: Rig,
		x: number,
		z: number,
		dt: number,
		cue: PlayersCue,
	) {
		const athlete = rig.athlete;
		athlete.root.position.x = x;
		athlete.root.position.z = z;
		drawnAt[side].x = x;
		drawnAt[side].z = z;

		// Running, from distance covered.
		const dx = rig.seeded ? x - rig.lastX : 0;
		const dz = rig.seeded ? z - rig.lastZ : 0;
		rig.lastX = x;
		rig.lastZ = z;
		rig.seeded = true;
		const moved = Math.hypot(dx, dz);
		const teleport = moved > 1;
		const k = 1 - Math.exp(-dt * 10);
		const speed =
			dt > 0 && !teleport ? Math.min(1, moved / dt / PLAYER_SPEED) : 0;
		rig.speed = lerp(rig.speed, speed, k);
		if (moved > 1e-4 && !teleport) {
			rig.lateral = lerp(
				rig.lateral,
				Math.abs(dx) / (Math.abs(dx) + Math.abs(dz)),
				k,
			);
		}
		if (!teleport) rig.phase += moved * 3.3;

		rig.live = lerp(
			rig.live,
			cue.serving === side ? 0 : 1,
			1 - Math.exp(-dt * 4),
		);
		rig.bob += dt;

		// 1. Stance, with a bounce on the toes while waiting for the ball.
		const out = rig.out;
		mix(out, STAND, READY, rig.live);
		out[0] =
			(out[0] ?? 0) +
			Math.abs(Math.sin(rig.bob * 5.2)) * 0.025 * rig.live * (1 - rig.speed);

		// 2. Running.
		if (rig.speed > 0.02) {
			gait(rig.phase, rig.speed, rig.lateral, rig.running);
			mix(out, out, rig.running, Math.min(1, rig.speed * 1.6));
		}

		// 3. Readying and the toss.
		const r = cue.ready;
		const coilTarget =
			r !== null && r.side === side
				? smooth((READY_FROM - r.inSeconds) / (READY_FROM - READY_BY))
				: 0;
		rig.coil = lerp(rig.coil, coilTarget, 1 - Math.exp(-dt * 14));
		if (rig.coil > 0.01 && r) {
			sample(CLIPS[r.stroke], 0, rig.scratch);
			mixUpper(out, out, rig.scratch, rig.coil, 0.35);
		}
		rig.toss = lerp(
			rig.toss,
			cue.tossing === side ? 1 : 0,
			1 - Math.exp(-dt * 8),
		);
		if (rig.toss > 0.01) mixUpper(out, out, TROPHY, rig.toss, 1);

		// A serve toss ends any reaction to the last point: the server is
		// getting on with it.
		if (cue.tossing === side && rig.playing && rig.playing.clip.contact === 0) {
			rig.playing = null;
		}

		// 4. The stroke or the reaction, faded in fast and out at the end.
		const p = rig.playing;
		if (p) {
			p.t += dt * p.rate;
			const u = p.t / p.clip.duration;
			if (u >= 1) {
				rig.playing = null;
			} else {
				sample(p.clip, u, rig.scratch);
				const w = Math.min(1, u * 12, (1 - u) * 4);
				mixUpper(out, out, rig.scratch, w, p.legs);
			}
		}

		athlete.apply(out);
		swingTail(side, rig, dx, dz, dt);
		updateSmear(rig, dt);
	}

	/** Secondary motion: the ponytail trails the run and flops as the player
	 * stops, bounces with the stride, and is flung by a swing. A spring
	 * under-damped on purpose — the overshoot is the point. */
	function swingTail(side: Side, rig: Rig, dx: number, dz: number, dt: number) {
		const pivot = rig.athlete.ponytail;
		if (!pivot || dt <= 0) return;
		const facing = side === "near" ? 1 : -1;
		const forward = (-dz * facing) / dt;
		const right = (dx * facing) / dt;
		const t = rig.tail;
		const goalX =
			-0.35 -
			Math.max(-1, Math.min(2, forward)) * 0.22 -
			Math.abs(Math.sin(rig.phase)) * 0.25 * rig.speed;
		const goalZ = -Math.max(-2, Math.min(2, right)) * 0.12;
		const stiffness = 160;
		const damping = 7;
		t.vx += ((goalX - t.x) * stiffness - t.vx * damping) * dt;
		t.vz += ((goalZ - t.z) * stiffness - t.vz * damping) * dt;
		t.x += t.vx * dt;
		t.z += t.vz * dt;
		pivot.rotation.set(t.x, 0, t.z);
	}

	return {
		at: drawnAt,
		celebrate(winner) {
			for (const side of ["near", "far"] as const) {
				const rig = rigs[side];
				if (rig.playing === null) {
					play(rig, side === winner ? "celebrate" : "deject", 1, 1, 0);
				}
			}
		},
		update(previous, current, alpha, dt, cue) {
			for (const side of ["near", "far"] as const) {
				const x = lerp(previous[side].x, current[side].x, alpha);
				const z = lerp(previous[side].z, current[side].z, alpha);
				animate(side, rigs[side], x, z, dt, cue);
			}
		},
		swing(side, stroke, power) {
			const rig = rigs[side];
			const vary = VARIATION[rig.swings % VARIATION.length] ?? 1;
			rig.swings += 1;
			const clip = CLIPS[stroke];
			rig.coil = 0;
			// A swing flings the ponytail across.
			rig.tail.vz += (stroke === "backhand" ? 1 : -1) * 6 * (0.5 + power);
			play(
				rig,
				stroke,
				vary * (0.85 + 0.35 * Math.min(1, Math.max(0, power))),
				0.6,
				strokeEntry(clip),
			);
		},
		react(winner) {
			for (const side of ["near", "far"] as const) {
				const rig = rigs[side];
				play(rig, side === winner ? "celebrate" : "deject", 1, 1, 0);
			}
		},
	};
}
