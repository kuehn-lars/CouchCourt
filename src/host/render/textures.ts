/**
 * Every texture in the scene, drawn at startup on a 2D canvas. No image
 * files: nothing to license, and nothing to fetch on a party's Wi-Fi. Each
 * is drawn once; only the LED boards are scrolled, and that is a texture
 * offset, not a redraw.
 */

import * as THREE from "three";

function canvas(
	width: number,
	height: number,
	draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): THREE.CanvasTexture {
	const c = document.createElement("canvas");
	c.width = width;
	c.height = height;
	const ctx = c.getContext("2d");
	if (ctx) draw(ctx, width, height);
	const texture = new THREE.CanvasTexture(c);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.anisotropy = 8;
	return texture;
}

/** A deterministic hash, so every host draws the same court. */
function hash(i: number): number {
	const x = Math.sin(i * 12.9898) * 43758.5453;
	return x - Math.floor(x);
}

/**
 * Hard-court acrylic: a flat colour with a fine sand grain, lighter scuffs
 * where players stand (behind the baseline and at the centre mark), and a
 * faint sheen falloff toward the edges. `wear` is where along the texture's
 * v (0..1) the scuffing concentrates.
 */
export function courtTexture(
	base: string,
	light: string,
	wear: readonly number[],
): THREE.CanvasTexture {
	return canvas(512, 1024, (ctx, w, h) => {
		ctx.fillStyle = base;
		ctx.fillRect(0, 0, w, h);
		for (const v of wear) {
			const g = ctx.createRadialGradient(
				w / 2,
				v * h,
				0,
				w / 2,
				v * h,
				w * 0.55,
			);
			g.addColorStop(0, light);
			g.addColorStop(1, "rgba(0,0,0,0)");
			ctx.globalAlpha = 0.35;
			ctx.fillStyle = g;
			ctx.fillRect(0, 0, w, h);
		}
		ctx.globalAlpha = 1;
		for (let i = 0; i < 26000; i++) {
			const x = hash(i) * w;
			const y = hash(i + 0.5) * h;
			const dark = hash(i + 0.25) > 0.5;
			ctx.fillStyle = dark ? "rgba(0,0,0,0.09)" : "rgba(255,255,255,0.06)";
			ctx.fillRect(x, y, 1.5, 1.5);
		}
	});
}

/** The net: a diamond mesh of cord, mostly air. Repeats across the width. */
export function netTexture(): THREE.CanvasTexture {
	const texture = canvas(64, 64, (ctx, w, h) => {
		ctx.clearRect(0, 0, w, h);
		ctx.strokeStyle = "rgba(12,18,26,0.95)";
		ctx.lineWidth = 5;
		ctx.beginPath();
		ctx.moveTo(0, 0);
		ctx.lineTo(w, h);
		ctx.moveTo(w, 0);
		ctx.lineTo(0, h);
		ctx.stroke();
	});
	texture.wrapS = THREE.RepeatWrapping;
	texture.wrapT = THREE.RepeatWrapping;
	return texture;
}

/** The name painted behind a baseline, in the ball's colour, worn. */
export function wordmarkTexture(): THREE.CanvasTexture {
	return canvas(1024, 160, (ctx, w, h) => {
		ctx.clearRect(0, 0, w, h);
		ctx.font =
			"900 118px system-ui, -apple-system, 'Helvetica Neue', sans-serif";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillStyle = "rgba(220,255,74,0.8)";
		ctx.fillText("COUCHCOURT", w / 2, h / 2 + 6);
	});
}

/**
 * One LED advertising board's worth of content, tiled along the court
 * walls and scrolled: the name, a ball, and the two side colours. Drawn as
 * light (bright on black) so it blooms.
 */
export function ledTexture(): THREE.CanvasTexture {
	const texture = canvas(1024, 64, (ctx, w, h) => {
		ctx.fillStyle = "#03060a";
		ctx.fillRect(0, 0, w, h);
		const block = w / 4;
		const items = [
			{ text: "COUCHCOURT", color: "#dcff4a" },
			{ text: "NEAR", color: "#ff5d73" },
			{ text: "COUCHCOURT", color: "#f3f6ef" },
			{ text: "FAR", color: "#5ac8fa" },
		];
		ctx.font = "800 40px system-ui, -apple-system, sans-serif";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		items.forEach((item, i) => {
			ctx.fillStyle = item.color;
			ctx.fillText(item.text, block * i + block / 2, h / 2 + 2);
		});
		// The pixel grid of a real LED panel.
		ctx.fillStyle = "rgba(0,0,0,0.35)";
		for (let x = 0; x < w; x += 4) ctx.fillRect(x, 0, 1, h);
		for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
	});
	texture.wrapS = THREE.RepeatWrapping;
	return texture;
}

/**
 * The comic impact: a jagged star, white hot in the middle, inked round the
 * edge. Drawn as a sprite at the contact point for a few frames — the frame
 * a comic artist would draw a strike with.
 */
export function burstTexture(): THREE.CanvasTexture {
	return canvas(256, 256, (ctx, w, h) => {
		const cx = w / 2;
		const cy = h / 2;
		const spikes = 14;
		const path = () => {
			ctx.beginPath();
			for (let i = 0; i <= spikes * 2; i++) {
				const a = (i / (spikes * 2)) * Math.PI * 2;
				const long = i % 2 === 0;
				const r = (long ? 0.47 : 0.24) * w * (long ? 0.8 + hash(i) * 0.2 : 1);
				const x = cx + Math.cos(a) * r;
				const y = cy + Math.sin(a) * r;
				if (i === 0) ctx.moveTo(x, y);
				else ctx.lineTo(x, y);
			}
			ctx.closePath();
		};
		path();
		ctx.lineJoin = "round";
		ctx.lineWidth = 10;
		ctx.strokeStyle = "#060a10";
		ctx.stroke();
		const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.45);
		g.addColorStop(0, "#ffffff");
		g.addColorStop(0.35, "#fbffd8");
		g.addColorStop(1, "#dcff4a");
		ctx.fillStyle = g;
		path();
		ctx.fill();
	});
}

/** A soft round dot, for dust and sparks. */
export function dotTexture(): THREE.CanvasTexture {
	return canvas(64, 64, (ctx, w, h) => {
		const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
		g.addColorStop(0, "rgba(255,255,255,1)");
		g.addColorStop(0.4, "rgba(255,255,255,0.6)");
		g.addColorStop(1, "rgba(255,255,255,0)");
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, w, h);
	});
}

/** The ball's felt: optic yellow with the white seam that curls round it. */
export function ballTexture(): THREE.CanvasTexture {
	return canvas(256, 128, (ctx, w, h) => {
		ctx.fillStyle = "#d9ff3b";
		ctx.fillRect(0, 0, w, h);
		ctx.strokeStyle = "#f7fff0";
		ctx.lineWidth = 7;
		ctx.beginPath();
		for (let i = 0; i <= 64; i++) {
			const u = i / 64;
			const x = u * w;
			const y = h / 2 + Math.sin(u * Math.PI * 4) * h * 0.28;
			if (i === 0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		}
		ctx.stroke();
	});
}
