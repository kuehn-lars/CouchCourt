/**
 * Post-processing: the scene is drawn into a multisampled HDR target — once,
 * or twice side by side on a split screen — then bloomed, tone mapped and
 * graded. Bloom is what turns emissive floodlights, the ball and the court
 * lines into light rather than into bright paint.
 *
 * Supersedes renderer rule 6 ("no post-processing",
 * `llm-knowledge/decisions/0018-stylised-stadium-renderer.md`). The passes are
 * the ones that ship inside `three` — no new dependency.
 *
 * The grade runs after tone mapping, in display space: vignette, a touch of
 * chromatic fringe toward the corners, and film grain that moves, so flat
 * dark areas do not band. It is the last 5% and it is most of why a frame
 * reads as a broadcast rather than as a render.
 */

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { Pass } from "three/addons/postprocessing/Pass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

/** A camera and the part of the frame it owns, as fractions of the width. */
export interface View {
	readonly camera: THREE.PerspectiveCamera;
	readonly left: number;
	readonly width: number;
}

/** Draws every view into the composer's buffer. The shadow map is rendered
 * once for the first view and reused by the second: the light has not moved
 * between them. */
class ViewsPass extends Pass {
	views: readonly View[] = [];
	readonly scene: THREE.Scene;
	constructor(scene: THREE.Scene) {
		super();
		this.scene = scene;
		this.needsSwap = false;
	}
	override render(
		renderer: THREE.WebGLRenderer,
		_write: THREE.WebGLRenderTarget,
		read: THREE.WebGLRenderTarget,
	): void {
		renderer.setRenderTarget(read);
		renderer.setScissorTest(false);
		renderer.clear();
		const w = read.width;
		const h = read.height;
		renderer.shadowMap.needsUpdate = true;
		for (const view of this.views) {
			const x = Math.round(view.left * w);
			const vw = Math.round(view.width * w);
			read.viewport.set(x, 0, vw, h);
			read.scissor.set(x, 0, vw, h);
			read.scissorTest = true;
			renderer.setRenderTarget(read);
			renderer.render(this.scene, view.camera);
		}
		read.viewport.set(0, 0, w, h);
		read.scissor.set(0, 0, w, h);
		read.scissorTest = false;
	}
}

const GradeShader = {
	uniforms: {
		tDiffuse: { value: null as THREE.Texture | null },
		time: { value: 0 },
		split: { value: 0 },
		punch: { value: 0 },
	},
	vertexShader: /* glsl */ `
		varying vec2 vUv;
		void main() {
			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
		}`,
	fragmentShader: /* glsl */ `
		uniform sampler2D tDiffuse;
		uniform float time;
		uniform float split;
		uniform float punch;
		varying vec2 vUv;

		float grain(vec2 uv) {
			return fract(sin(dot(uv * (time + 1.7), vec2(12.9898, 78.233))) * 43758.5453);
		}

		void main() {
			// On a split screen each half is its own picture, with its own
			// corners.
			vec2 uv = vUv;
			vec2 local = uv;
			if (split > 0.5) local.x = fract(uv.x * 2.0);
			vec2 c = local - 0.5;
			float edge = dot(c, c);
			// Chromatic fringe, growing toward the corners and on impact.
			vec2 shift = c * (0.0025 + punch * 0.006) * edge * 4.0;
			vec3 col;
			col.r = texture2D(tDiffuse, uv + shift).r;
			col.g = texture2D(tDiffuse, uv).g;
			col.b = texture2D(tDiffuse, uv - shift).b;
			// Vignette.
			col *= mix(1.0, 0.62, smoothstep(0.12, 0.62, edge * 1.6));
			// A gentle S-curve and a cool lift in the shadows.
			col = mix(col, col * col * (3.0 - 2.0 * col), 0.22);
			col += vec3(0.0, 0.012, 0.024) * (1.0 - col);
			col += (grain(uv) - 0.5) * 0.035;
			gl_FragColor = vec4(col, 1.0);
		}`,
};

export interface Post {
	render(views: readonly View[], dt: number): void;
	resize(width: number, height: number, pixelRatio: number): void;
	/** A hit's kick: 0..1, decays by itself. */
	punch(amount: number): void;
}

export function createPost(
	renderer: THREE.WebGLRenderer,
	scene: THREE.Scene,
): Post {
	const size = renderer.getDrawingBufferSize(new THREE.Vector2());
	const target = new THREE.WebGLRenderTarget(size.x, size.y, {
		type: THREE.HalfFloatType,
		samples: 4,
	});
	const composer = new EffectComposer(renderer, target);
	const views = new ViewsPass(scene);
	composer.addPass(views);
	const bloom = new UnrealBloomPass(
		new THREE.Vector2(size.x / 2, size.y / 2),
		0.5,
		0.5,
		0.92,
	);
	composer.addPass(bloom);
	composer.addPass(new OutputPass());
	const grade = new ShaderPass(GradeShader);
	composer.addPass(grade);

	let time = 0;
	let kick = 0;
	return {
		render(list, dt) {
			time = (time + dt) % 1000;
			kick *= Math.exp(-dt * 9);
			views.views = list;
			const u = grade.uniforms as typeof GradeShader.uniforms;
			u.time.value = time;
			u.split.value = list.length > 1 ? 1 : 0;
			u.punch.value = kick;
			composer.render(dt);
		},
		resize(width, height, pixelRatio) {
			composer.setPixelRatio(pixelRatio);
			composer.setSize(width, height);
			bloom.resolution.set((width * pixelRatio) / 2, (height * pixelRatio) / 2);
		},
		punch(amount) {
			kick = Math.max(kick, amount);
		},
	};
}
