/**
 * The numbers that pop off the racket: the shot's speed in km/h, and above
 * it how well it was timed (or POWER SHOT). In the world, not the DOM, so a
 * split screen shows each pop in both halves for free, and bloom makes the
 * hot ones glow.
 *
 * A fixed pool of sprites, each with its own small canvas. A pop redraws one
 * canvas and uploads it — a few times a second at most, never per frame — so
 * the frame loop still allocates nothing (`llm-knowledge/modules/host.md`,
 * rule 2). Sized in screen terms (`sizeAttenuation: false`): the far
 * player's numbers are as readable as the near one's.
 */

import * as THREE from "three";
import type { Side } from "../../shared/protocol.ts";
import type { Grade, Pop } from "../arcade.ts";

const COUNT = 8;
const W = 512;
const H = 256;
/** Seconds a pop stays up. */
const LIFE = 1.15;
/** Screen-relative height of a pop (at 1m from a camera, per three). */
const SIZE = 0.048;

const GRADE: Readonly<Record<Grade, { text: string; color: string }>> = {
	perfect: { text: "PERFECT!", color: "#dcff4a" },
	great: { text: "GREAT", color: "#5ef2ff" },
	good: { text: "GOOD", color: "#f3f6ef" },
	early: { text: "EARLY", color: "#ffa04a" },
	late: { text: "LATE", color: "#ffa04a" },
};

/** The number's colour by `Pop.heat`: cool, ball, hot, white-hot pink. */
const HEAT: readonly string[] = ["#e6f3ff", "#dcff4a", "#ffae2e", "#ff3d8b"];

const FONT = `system-ui, -apple-system, "SF Pro Display", "Helvetica Neue", sans-serif`;

interface Slot {
	readonly sprite: THREE.Sprite;
	readonly ctx: CanvasRenderingContext2D;
	readonly texture: THREE.CanvasTexture;
	readonly base: THREE.Vector3;
	side: Side;
	life: number;
	drift: number;
}

function draw(ctx: CanvasRenderingContext2D, pop: Pop): void {
	ctx.clearRect(0, 0, W, H);
	ctx.textAlign = "center";
	ctx.textBaseline = "alphabetic";
	ctx.lineJoin = "round";

	const label = pop.power
		? { text: "POWER SHOT!", color: "#ff5ab4" }
		: GRADE[pop.grade];
	ctx.font = `italic 800 54px ${FONT}`;
	ctx.lineWidth = 12;
	ctx.strokeStyle = "rgba(6, 8, 14, 0.92)";
	ctx.strokeText(label.text, W / 2, 70);
	ctx.fillStyle = label.color;
	ctx.fillText(label.text, W / 2, 70);

	const number = String(pop.kmh);
	ctx.font = `italic 900 138px ${FONT}`;
	const nw = ctx.measureText(number).width;
	ctx.font = `italic 800 40px ${FONT}`;
	const uw = ctx.measureText("KM/H").width;
	const left = (W - nw - 10 - uw) / 2;

	ctx.textAlign = "left";
	ctx.font = `italic 900 138px ${FONT}`;
	ctx.lineWidth = 16;
	ctx.strokeText(number, left, 214);
	if (pop.power || pop.heat >= 3) {
		const fire = ctx.createLinearGradient(0, 100, 0, 214);
		fire.addColorStop(0, "#fff36b");
		fire.addColorStop(0.5, "#ff8a2a");
		fire.addColorStop(1, "#ff2d7a");
		ctx.fillStyle = fire;
	} else {
		ctx.fillStyle = HEAT[pop.heat] ?? "#ffffff";
	}
	ctx.fillText(number, left, 214);

	ctx.font = `italic 800 40px ${FONT}`;
	ctx.lineWidth = 10;
	ctx.strokeText("KM/H", left + nw + 10, 212);
	ctx.fillStyle = "rgba(243, 246, 239, 0.85)";
	ctx.fillText("KM/H", left + nw + 10, 212);
}

/** Springy entrance: overshoots to ~1.25 and settles, over `t` 0..1. */
function spring(t: number): number {
	if (t >= 1) return 1;
	return 1 - Math.exp(-7 * t) * Math.cos(11 * t);
}

export interface Popups {
	pop(pop: Pop): void;
	update(dt: number): void;
	/** A new point: nothing from the last one lingers. */
	clear(): void;
}

export function createPopups(scene: THREE.Scene): Popups {
	const slots: Slot[] = Array.from({ length: COUNT }, () => {
		const canvas = document.createElement("canvas");
		canvas.width = W;
		canvas.height = H;
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("popups: no 2D context");
		const texture = new THREE.CanvasTexture(canvas);
		texture.colorSpace = THREE.SRGBColorSpace;
		const sprite = new THREE.Sprite(
			new THREE.SpriteMaterial({
				map: texture,
				transparent: true,
				depthTest: false,
				depthWrite: false,
				sizeAttenuation: false,
			}),
		);
		sprite.renderOrder = 20;
		sprite.visible = false;
		scene.add(sprite);
		return {
			sprite,
			ctx,
			texture,
			base: new THREE.Vector3(),
			side: "near",
			life: 0,
			drift: 0,
		};
	});
	let cursor = 0;

	return {
		pop(pop) {
			// A re-struck ball is the same shot, faster: rewrite its number.
			let slot = pop.revised
				? slots.find((s) => s.life > 0 && s.side === pop.side)
				: undefined;
			if (!slot) {
				slot = slots[cursor] as Slot;
				cursor = (cursor + 1) % COUNT;
				slot.base.set(pop.at.x, pop.at.y + 1.1, pop.at.z);
				slot.drift = (Math.random() - 0.5) * 0.6;
			}
			draw(slot.ctx, pop);
			slot.texture.needsUpdate = true;
			slot.side = pop.side;
			slot.life = LIFE;
			// The hotter the shot, the brighter: over the bloom threshold.
			slot.sprite.material.color.setScalar(1 + pop.heat * 0.12);
			slot.sprite.visible = true;
		},
		clear() {
			for (const slot of slots) {
				slot.life = 0;
				slot.sprite.visible = false;
			}
		},
		update(dt) {
			for (const slot of slots) {
				if (slot.life <= 0) continue;
				slot.life -= dt;
				if (slot.life <= 0) {
					slot.sprite.visible = false;
					continue;
				}
				const age = LIFE - slot.life;
				const s = SIZE * spring(age / 0.45);
				slot.sprite.scale.set(s * 2, s, 1);
				// Rises fast and slows, like it was knocked up off the racket.
				const rise = 1.6 * (1 - Math.exp(-age * 3));
				slot.sprite.position.set(
					slot.base.x + slot.drift * rise,
					slot.base.y + rise,
					slot.base.z,
				);
				slot.sprite.material.opacity = Math.min(1, slot.life / 0.35);
			}
		},
	};
}
