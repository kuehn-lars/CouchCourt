/**
 * Renderer, camera, lights and background. Built once; `resize()` and
 * `updateCamera()` are the only things called again after setup.
 *
 * No shadow map (`WebGLRenderer.shadowMap` is left off): the blob shadow
 * (`entities.ts`) is the primary depth cue at this ball size and costs
 * nothing, per `llm-knowledge/modules/host.md`'s renderer rule 3. No
 * post-processing, per rule 6 — the gradient background and fog do the
 * atmospheric work a bloom pass would otherwise buy.
 *
 * Where the camera goes is not decided here: that is `camera.ts`, which is
 * pure and tested. This file only eases toward what it returns.
 */

import * as THREE from "three";
import { attractPose, type CameraMode, cameraPose } from "./camera.ts";

/** A match camera, or the lobby's slow crane (`attractPose`). */
export type CameraShot = CameraMode | "attract";

/** Exponential smoothing per frame. Higher eases faster; tuned by eye. Two
 * rates: the pose slides, but a mode change is a cut worth easing through
 * quickly rather than sliding across the stadium for a second. */
const EASE = 0.06;
const EASE_MODE_CHANGE = 0.12;

const SKY_TOP = "#03080f";
const SKY_HORIZON = "#27526d";

/** The camera now sits ~28m from the near player and ~50m from the far one
 * ([[camera]]), so fog that started at 20m would swallow the whole far
 * court. These are set past the far baseline, not in front of it. */
const FOG_NEAR = 55;
const FOG_FAR = 135;

function gradientBackground(): THREE.Texture {
	const canvas = document.createElement("canvas");
	canvas.width = 1;
	canvas.height = 256;
	const ctx = canvas.getContext("2d");
	if (ctx) {
		const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
		gradient.addColorStop(0, SKY_TOP);
		gradient.addColorStop(0.55, "#0d2436");
		gradient.addColorStop(1, SKY_HORIZON);
		ctx.fillStyle = gradient;
		ctx.fillRect(0, 0, canvas.width, canvas.height);
	}
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	return texture;
}

export interface Scene {
	readonly scene: THREE.Scene;
	readonly camera: THREE.PerspectiveCamera;
	readonly renderer: THREE.WebGLRenderer;
	/** Eases the camera toward the pose `camera.ts` wants for `mode` and the
	 * ball's current position. Call once per rendered frame. */
	updateCamera(mode: CameraShot, ball: THREE.Vector3 | Ball3): void;
	resize(): void;
}

interface Ball3 {
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

export function createScene(canvas: HTMLCanvasElement): Scene {
	const scene = new THREE.Scene();
	scene.background = gradientBackground();
	scene.fog = new THREE.Fog(SKY_HORIZON, FOG_NEAR, FOG_FAR);

	const start = cameraPose("broadcast", { ballX: 0, ballZ: 0 });
	const camera = new THREE.PerspectiveCamera(
		start.fov,
		window.innerWidth / window.innerHeight,
		// 1m, not 0.1: no camera comes within 6m of anything, and the court
		// sits 1mm above the apron. At 0.1 the depth buffer's precision at
		// the lobby crane's 45m was ~1.2mm and the two planes striped;
		// depth precision scales with the near plane.
		1,
		// Far plane past the fog, or the stadium behind the far court would be
		// clipped away before the fog ever got to fade it.
		260,
	);
	camera.position.set(start.position.x, start.position.y, start.position.z);

	const target = new THREE.Vector3(
		start.target.x,
		start.target.y,
		start.target.z,
	);
	let lastMode: CameraShot = "broadcast";

	// The sky half of this lights the stands, which face upward and catch
	// almost nothing from the sun. Raised from 1.0 with a much lighter ground
	// colour once the bowl existed: at the old values the whole stadium read
	// as a black wall behind the court.
	const hemi = new THREE.HemisphereLight("#a8cdff", "#2d4356", 1.35);
	scene.add(hemi);
	const sun = new THREE.DirectionalLight("#fff4e0", 1.9);
	sun.position.set(-14, 22, 10);
	scene.add(sun);
	// A cool fill from the opposite side so the far player is not a silhouette
	// — at 50m the only thing separating them from the court is their own
	// shading.
	const fill = new THREE.DirectionalLight("#7fd0ff", 0.55);
	fill.position.set(16, 9, -18);
	scene.add(fill);

	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.1;
	renderer.outputColorSpace = THREE.SRGBColorSpace;

	function resize(): void {
		const { innerWidth, innerHeight } = window;
		camera.aspect = innerWidth / innerHeight;
		camera.updateProjectionMatrix();
		renderer.setSize(innerWidth, innerHeight, false);
	}
	resize();
	window.addEventListener("resize", resize);

	function updateCamera(mode: CameraShot, ball: Ball3): void {
		const pose =
			mode === "attract"
				? attractPose(performance.now() / 1000)
				: cameraPose(mode, { ballX: ball.x, ballZ: ball.z });
		const ease = mode === lastMode ? EASE : EASE_MODE_CHANGE;
		lastMode = mode;

		camera.position.x += (pose.position.x - camera.position.x) * ease;
		camera.position.y += (pose.position.y - camera.position.y) * ease;
		camera.position.z += (pose.position.z - camera.position.z) * ease;
		target.x += (pose.target.x - target.x) * ease;
		target.y += (pose.target.y - target.y) * ease;
		target.z += (pose.target.z - target.z) * ease;
		camera.lookAt(target);

		// `updateProjectionMatrix` is not free, and the fov only moves when
		// the mode does.
		if (Math.abs(camera.fov - pose.fov) > 0.01) {
			camera.fov += (pose.fov - camera.fov) * ease;
			camera.updateProjectionMatrix();
		}
	}

	return { scene, camera, renderer, updateCamera, resize };
}
