/**
 * The night over the stadium: a dome with a gradient that glows teal toward
 * the horizon where the floodlight haze sits, and a field of stars above it.
 * One mesh, one shader, no texture; drawn behind everything and untouched by
 * fog, so the fog can fade the stands *into* it.
 */

import * as THREE from "three";

export const SKY_TOP = "#02050a";
export const SKY_HORIZON = "#12324a";

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
	vDir = normalize(position);
	vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
	gl_Position = p.xyww;
}`;

const fragmentShader = /* glsl */ `
uniform vec3 top;
uniform vec3 horizon;
uniform vec3 haze;
varying vec3 vDir;

float hash(vec3 p) {
	p = fract(p * 0.3183099 + 0.1);
	p *= 17.0;
	return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

void main() {
	float h = clamp(vDir.y, -0.2, 1.0);
	vec3 col = mix(horizon, top, pow(smoothstep(-0.05, 0.75, h), 0.7));
	// Floodlight haze: a warm-teal band hugging the horizon.
	col += haze * exp(-max(h, 0.0) * 9.0) * 0.55;
	// Stars, only well above the stands, twinkle-free (nothing here moves).
	vec3 cell = floor(vDir * 420.0);
	float star = step(0.9965, hash(cell)) * smoothstep(0.18, 0.5, h);
	float bright = hash(cell + 7.0);
	col += vec3(0.75, 0.85, 1.0) * star * (0.35 + bright * 0.9);
	gl_FragColor = vec4(col, 1.0);
	#include <colorspace_fragment>
}`;

export function buildSky(): THREE.Mesh {
	const material = new THREE.ShaderMaterial({
		vertexShader,
		fragmentShader,
		uniforms: {
			top: { value: new THREE.Color(SKY_TOP) },
			horizon: { value: new THREE.Color(SKY_HORIZON) },
			haze: { value: new THREE.Color("#2e6b7d") },
		},
		side: THREE.BackSide,
		depthWrite: false,
		fog: false,
	});
	const sky = new THREE.Mesh(new THREE.SphereGeometry(200, 32, 16), material);
	sky.renderOrder = -1;
	sky.frustumCulled = false;
	return sky;
}
