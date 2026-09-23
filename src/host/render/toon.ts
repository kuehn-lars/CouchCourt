/**
 * The look: cel-shaded materials with a hard rim of light, and ink outlines.
 * Every character and prop that should read as "drawn" is built from these
 * two functions; the world around them (court, stands) stays physically
 * shaded so the floodlights can put a sheen on it. That split is what reads
 * as stylised rather than as cheap: drawn people in a lit place.
 *
 * Both are `onBeforeCompile` patches on stock three.js materials rather than
 * hand-written shaders, so lights, shadows, fog and instancing keep working
 * without a line of our own for any of them.
 */

import * as THREE from "three";

/** Four bands of light: shadow, mid, lit, highlight. Nearest-filtered, or
 * the bands blur back into ordinary shading. */
function gradientMap(): THREE.DataTexture {
	const steps = [70, 150, 215, 255];
	const data = new Uint8Array(steps.length * 4);
	steps.forEach((v, i) => {
		data.set([v, v, v, 255], i * 4);
	});
	const texture = new THREE.DataTexture(data, steps.length, 1);
	texture.minFilter = THREE.NearestFilter;
	texture.magFilter = THREE.NearestFilter;
	texture.generateMipmaps = false;
	texture.needsUpdate = true;
	return texture;
}

let bands: THREE.DataTexture | null = null;

export interface ToonOptions {
	/** Colour of the rim light. Defaults to the floodlights' cool white. */
	readonly rim?: THREE.ColorRepresentation;
	/** 0 turns the rim off. */
	readonly rimStrength?: number;
	readonly emissive?: THREE.ColorRepresentation;
	readonly emissiveIntensity?: number;
	readonly map?: THREE.Texture;
	readonly transparent?: boolean;
	readonly opacity?: number;
	readonly side?: THREE.Side;
}

/**
 * A cel-shaded material with a rim light: the edge of a form facing away
 * from the camera catches a hard line of light, the way a comic inks the
 * back-light on a figure. The rim is stepped, not smooth, so it reads as a
 * drawn highlight rather than as a glow.
 */
export function toon(
	color: THREE.ColorRepresentation,
	options: ToonOptions = {},
): THREE.MeshToonMaterial {
	bands ??= gradientMap();
	const material = new THREE.MeshToonMaterial({
		color,
		gradientMap: bands,
		emissive: options.emissive ?? "#000000",
		emissiveIntensity: options.emissiveIntensity ?? 1,
		map: options.map ?? null,
		transparent: options.transparent ?? false,
		opacity: options.opacity ?? 1,
		side: options.side ?? THREE.FrontSide,
	});
	const rim = {
		rimColor: { value: new THREE.Color(options.rim ?? "#cfe8ff") },
		rimStrength: { value: options.rimStrength ?? 0.55 },
	};
	material.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, rim);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				"#include <common>",
				"#include <common>\nuniform vec3 rimColor;\nuniform float rimStrength;",
			)
			.replace(
				"#include <opaque_fragment>",
				`{
					float facing = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
					float rim = smoothstep(0.62, 0.7, 1.0 - facing);
					outgoingLight += rimColor * rim * rimStrength;
				}
				#include <opaque_fragment>`,
			);
	};
	material.customProgramCacheKey = () => "toon-rim";
	return material;
}

/** Ink. Shared by every outline so there is one of it to tune. */
const INK = "#060a10";

const outlineMaterials = new Map<number, THREE.MeshBasicMaterial>();

/**
 * An ink outline by the inverted-hull trick: the same geometry, drawn
 * back-faces only, pushed out along its normals by `width` metres. Cheap
 * (one extra draw per part, no post pass) and it survives instancing,
 * shadows and split screen, which a screen-space edge pass would not all do.
 *
 * The width is in world metres on purpose: a player far down the court gets
 * a thinner line, which is what depth looks like in a drawing.
 */
export function outline(mesh: THREE.Mesh, width = 0.022): THREE.Mesh {
	let material = outlineMaterials.get(width);
	if (!material) {
		material = new THREE.MeshBasicMaterial({
			color: INK,
			side: THREE.BackSide,
		});
		material.onBeforeCompile = (shader) => {
			shader.vertexShader = shader.vertexShader.replace(
				"#include <begin_vertex>",
				`#include <begin_vertex>\ntransformed += normalize(normal) * ${width.toFixed(4)};`,
			);
		};
		material.customProgramCacheKey = () => `outline-${width}`;
		outlineMaterials.set(width, material);
	}
	const hull = new THREE.Mesh(mesh.geometry, material);
	hull.castShadow = false;
	hull.receiveShadow = false;
	mesh.add(hull);
	return mesh;
}
