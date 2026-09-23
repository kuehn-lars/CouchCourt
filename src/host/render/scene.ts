/**
 * Renderer, lights, sky and the cameras. Built once; per frame the cameras
 * ease toward what `camera.ts` asks for and `post.ts` draws the result.
 *
 * ## Light
 *
 * One key light standing in for the floodlight rig, high and behind the near
 * end, casting the only real shadows in the scene — the players', the net's
 * and the umpire's. Its shadow camera is fitted to the court, not the
 * stadium, which is what keeps a 2048 map sharp. A cool back light from the
 * far end rims the players; a hemisphere light keeps the stands out of
 * black. The ball keeps its blob shadow: directly under it is the depth cue,
 * and a real shadow from a light at 60° is not under it
 * (`llm-knowledge/decisions/0018-stylised-stadium-renderer.md`).
 *
 * The environment map is a tiny scene of floodlight panels over a dark bowl,
 * prefiltered once. It is what puts a sheen of light across the court.
 *
 * ## Frame rate
 *
 * Feel beats fidelity (`PRODUCT.md`), and a dropped frame is felt. The pixel
 * ratio steps down when frames run long and back up when they are cheap —
 * resolution is the one thing that can be given up without anyone noticing.
 */

import * as THREE from "three";
import {
	attractPose,
	type CameraMode,
	type CameraPose,
	cameraPose,
	splitPose,
	victoryPose,
} from "./camera.ts";
import { createPost, type View } from "./post.ts";
import { buildSky, SKY_HORIZON } from "./sky.ts";

/** A match camera, the lobby's slow crane (`attractPose`), one half of the
 * screen per player, or the orbit round the winner once it is over. */
export type CameraShot = CameraMode | "attract" | "split" | "victory";

/** Exponential smoothing per second. The pose slides; a change of shot is
 * eased through quickly rather than sliding across the stadium. */
const EASE = 3.8;
const EASE_SHOT_CHANGE = 7.5;

/** The fog starts past the far baseline and has swallowed the top of the
 * stands by the far end of the bowl. */
const FOG_NEAR = 60;
const FOG_FAR = 175;

/** Pixel-ratio steps, best first. */
const QUALITY = [1.75, 1.5, 1.25, 1, 0.8] as const;
/** Frame time over which to step down, and under which to step up. */
const SLOW_MS = 19;
const FAST_MS = 12.5;

interface Rig {
	readonly camera: THREE.PerspectiveCamera;
	readonly target: THREE.Vector3;
	shot: CameraShot | null;
}

function environment(renderer: THREE.WebGLRenderer): THREE.Texture {
	const env = new THREE.Scene();
	env.background = new THREE.Color("#0a1622");
	const panel = new THREE.MeshBasicMaterial({ color: "#fff3dc" });
	panel.color.multiplyScalar(6);
	for (const [x, z] of [
		[-1, -1],
		[1, -1],
		[-1, 1],
		[1, 1],
	] as const) {
		const light = new THREE.Mesh(new THREE.PlaneGeometry(10, 4), panel);
		light.position.set(x * 26, 24, z * 34);
		light.lookAt(0, 0, 0);
		env.add(light);
	}
	const ring = new THREE.Mesh(
		new THREE.CylinderGeometry(60, 60, 18, 24, 1, true),
		new THREE.MeshBasicMaterial({ color: "#16324a", side: THREE.BackSide }),
	);
	ring.position.y = 4;
	env.add(ring);
	const pmrem = new THREE.PMREMGenerator(renderer);
	const texture = pmrem.fromScene(env, 0.02).texture;
	pmrem.dispose();
	return texture;
}

/** Where each player is drawn, on the ground. */
export type PlayerSpots = Readonly<
	Record<"near" | "far", { readonly x: number; readonly z: number }>
>;

export interface Scene {
	readonly scene: THREE.Scene;
	/** Eases the cameras toward `shot`, and returns what to draw. */
	updateCameras(
		shot: CameraShot,
		ball: { x: number; z: number },
		players: PlayerSpots,
		/** Who won, for the victory shot. */
		winner: "near" | "far" | null,
		dt: number,
	): readonly View[];
	draw(views: readonly View[], dt: number): void;
	/** A shake, 0..1: a smash, not a forehand. */
	shake(amount: number): void;
	/** The screen's own kick on impact, 0..1. */
	punch(amount: number): void;
}

export function createScene(canvas: HTMLCanvasElement): Scene {
	const renderer = new THREE.WebGLRenderer({
		canvas,
		antialias: false,
		powerPreference: "high-performance",
	});
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.05;
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFShadowMap;
	// Rendered once per frame by `post.ts`, however many views there are.
	renderer.shadowMap.autoUpdate = false;

	const scene = new THREE.Scene();
	scene.add(buildSky());
	scene.fog = new THREE.Fog(SKY_HORIZON, FOG_NEAR, FOG_FAR);
	scene.environment = environment(renderer);
	scene.environmentIntensity = 0.55;

	scene.add(new THREE.HemisphereLight("#9cc6ff", "#16283a", 0.7));
	const key = new THREE.DirectionalLight("#fff0da", 2.9);
	key.position.set(-10, 34, 16);
	key.castShadow = true;
	key.shadow.mapSize.set(2048, 2048);
	const box = key.shadow.camera;
	box.left = -15;
	box.right = 15;
	box.top = 20;
	box.bottom = -20;
	box.near = 10;
	box.far = 80;
	key.shadow.bias = -0.0004;
	key.shadow.normalBias = 0.03;
	key.shadow.radius = 3;
	scene.add(key, key.target);
	const back = new THREE.DirectionalLight("#79c8ff", 1.1);
	back.position.set(12, 14, -30);
	scene.add(back);
	const warm = new THREE.DirectionalLight("#ffb98a", 0.45);
	warm.position.set(20, 10, 20);
	scene.add(warm);

	const post = createPost(renderer, scene);

	const makeRig = (): Rig => ({
		camera: new THREE.PerspectiveCamera(19, 1, 1, 320),
		target: new THREE.Vector3(),
		shot: null,
	});
	const rigs = [makeRig(), makeRig()] as const;

	let quality = 1;
	let slowFor = 0;
	let fastFor = 0;
	function resize(): void {
		const ratio = Math.min(window.devicePixelRatio, QUALITY[quality] ?? 1);
		renderer.setPixelRatio(ratio);
		renderer.setSize(window.innerWidth, window.innerHeight, false);
		post.resize(window.innerWidth, window.innerHeight, ratio);
	}
	resize();
	window.addEventListener("resize", resize);

	/** Watches frame time and moves `quality` one step at a time, only
	 * after a sustained run either way. */
	function adapt(dt: number): void {
		const ms = dt * 1000;
		if (ms > 100) return; // a hitch or a restored tab says nothing
		slowFor = ms > SLOW_MS ? slowFor + dt : 0;
		fastFor = ms < FAST_MS ? fastFor + dt : 0;
		if (slowFor > 1.5 && quality < QUALITY.length - 1) {
			quality++;
			slowFor = 0;
			resize();
		} else if (fastFor > 6 && quality > 0) {
			quality--;
			fastFor = 0;
			resize();
		}
	}

	let shakeAmount = 0;
	let clock = 0;

	function ease(rig: Rig, pose: CameraPose, shot: CameraShot, dt: number) {
		const snap = rig.shot === null;
		const rate = rig.shot === shot ? EASE : EASE_SHOT_CHANGE;
		rig.shot = shot;
		const k = snap ? 1 : 1 - Math.exp(-dt * rate);
		const c = rig.camera;
		c.position.x += (pose.position.x - c.position.x) * k;
		c.position.y += (pose.position.y - c.position.y) * k;
		c.position.z += (pose.position.z - c.position.z) * k;
		rig.target.x += (pose.target.x - rig.target.x) * k;
		rig.target.y += (pose.target.y - rig.target.y) * k;
		rig.target.z += (pose.target.z - rig.target.z) * k;
		if (Math.abs(c.fov - pose.fov) > 0.01) c.fov += (pose.fov - c.fov) * k;
	}

	/** Hand-held breathing plus any shake, applied after the ease so it
	 * never accumulates into the camera's resting pose. */
	function finish(rig: Rig, aspect: number, seed: number): void {
		const c = rig.camera;
		const t = clock + seed;
		const s = shakeAmount * shakeAmount;
		const dx = Math.sin(t * 0.7) * 0.05 + Math.sin(t * 31) * 0.18 * s;
		const dy = Math.sin(t * 0.53) * 0.04 + Math.sin(t * 27 + 1) * 0.14 * s;
		c.position.x += dx;
		c.position.y += dy;
		c.lookAt(rig.target);
		c.position.x -= dx;
		c.position.y -= dy;
		if (c.aspect !== aspect) c.aspect = aspect;
		c.updateProjectionMatrix();
	}

	const single: View[] = [{ camera: rigs[0].camera, left: 0, width: 1 }];
	const split: View[] = [
		{ camera: rigs[0].camera, left: 0, width: 0.5 },
		{ camera: rigs[1].camera, left: 0.5, width: 0.5 },
	];

	return {
		scene,
		updateCameras(shot, ball, players, winner, dt) {
			clock += dt;
			shakeAmount *= Math.exp(-dt * 6);
			const aspect = window.innerWidth / window.innerHeight;
			if (shot === "split") {
				ease(rigs[0], splitPose("near", players.near.x), shot, dt);
				ease(rigs[1], splitPose("far", players.far.x), shot, dt);
				finish(rigs[0], aspect / 2, 0);
				finish(rigs[1], aspect / 2, 5.3);
				return split;
			}
			const now = performance.now() / 1000;
			const pose =
				shot === "attract"
					? attractPose(now)
					: shot === "victory"
						? victoryPose(winner ?? "near", players[winner ?? "near"], now)
						: cameraPose(shot, { ballX: ball.x, ballZ: ball.z });
			ease(rigs[0], pose, shot, dt);
			finish(rigs[0], aspect, 0);
			// The idle rig follows along, so a split that starts later eases
			// in from where the match camera was instead of from nowhere.
			rigs[1].shot = null;
			return single;
		},
		draw(views, dt) {
			adapt(dt);
			post.render(views, dt);
		},
		shake(amount) {
			shakeAmount = Math.max(shakeAmount, amount);
		},
		punch(amount) {
			post.punch(amount);
		},
	};
}
