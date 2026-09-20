/**
 * Renderer, camera, lights and background. Built once; `resize()` is the only
 * thing called again after setup, from a `window` "resize" listener.
 *
 * No shadow map (`WebGLRenderer.shadowMap` is left off): the blob shadow
 * (`entities.ts`) is the primary depth cue at this ball size and costs
 * nothing, per `llm-knowledge/modules/host.md`'s renderer rule 3. No
 * post-processing, per rule 6 — the gradient background and fog do the
 * atmospheric work a bloom pass would otherwise buy.
 */

import * as THREE from "three";
import { BASELINE_Z } from "../../shared/sim/court.ts";

/** Height of the camera above the court, metres. */
const CAMERA_HEIGHT = 4.4;
/** Distance behind the near baseline, metres. */
const CAMERA_BACK = 7.5;
/** Where the camera looks, in front of the near baseline. */
const LOOK_AT = new THREE.Vector3(0, 1.2, -BASELINE_Z * 0.35);

/** How far the camera drifts sideways toward the ball, fraction of the ball's
 * own `x`. Small on purpose — a nudge, not a follow-cam. */
const CAMERA_DRIFT = 0.35;
/** Exponential smoothing per frame. Higher eases faster; tuned by eye. */
const CAMERA_EASE = 0.05;

const SKY_TOP = "#0a1a2e";
const SKY_HORIZON = "#2f5d7a";

function gradientBackground(): THREE.Texture {
	const canvas = document.createElement("canvas");
	canvas.width = 1;
	canvas.height = 256;
	const ctx = canvas.getContext("2d");
	if (ctx) {
		const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
		gradient.addColorStop(0, SKY_TOP);
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
	/** Eases the camera toward `ballX`. Call once per rendered frame. */
	updateCamera(ballX: number): void;
	resize(): void;
}

export function createScene(canvas: HTMLCanvasElement): Scene {
	const scene = new THREE.Scene();
	scene.background = gradientBackground();
	scene.fog = new THREE.Fog(SKY_HORIZON, 20, 55);

	const camera = new THREE.PerspectiveCamera(
		55,
		window.innerWidth / window.innerHeight,
		0.1,
		100,
	);
	camera.position.set(0, CAMERA_HEIGHT, BASELINE_Z + CAMERA_BACK);
	camera.lookAt(LOOK_AT);

	const hemi = new THREE.HemisphereLight(SKY_TOP, "#12331f", 1.1);
	scene.add(hemi);
	const sun = new THREE.DirectionalLight("#fff4e0", 1.6);
	sun.position.set(-6, 10, 4);
	scene.add(sun);

	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.05;
	renderer.outputColorSpace = THREE.SRGBColorSpace;

	function resize(): void {
		const { innerWidth, innerHeight } = window;
		camera.aspect = innerWidth / innerHeight;
		camera.updateProjectionMatrix();
		renderer.setSize(innerWidth, innerHeight, false);
	}
	resize();
	window.addEventListener("resize", resize);

	function updateCamera(ballX: number): void {
		const target = ballX * CAMERA_DRIFT;
		camera.position.x += (target - camera.position.x) * CAMERA_EASE;
		camera.lookAt(LOOK_AT.x + camera.position.x * 0.3, LOOK_AT.y, LOOK_AT.z);
	}

	return { scene, camera, renderer, updateCamera, resize };
}
