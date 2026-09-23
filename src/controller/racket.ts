/**
 * The racket, drawn: the phone's screen is the string bed. The head fills the
 * screen, the throat runs down into the player's hand, and everything the
 * phone has to say is **stencilled onto the strings** — inked only where
 * there is string, the way a maker's logo is painted on a real racket.
 *
 * It is a physical object, and it behaves like one:
 *
 * - the strings **ripple** out from the sweet spot when a ball is struck,
 *   and bow toward the swing while one is under way;
 * - the frame **charges** round from the throat with the power of the swing
 *   the phone just read, and glows while it is moving;
 * - on your serve a **ball sits on the strings**, bouncing, and on the toss
 *   it flies up off the top of the screen and comes back down on the same
 *   clock as the real one (`TOSS_APEX`), timed from the phone's own swing;
 * - a hit leaves a **smudge of felt** on the strings, a won point throws
 *   confetti, a lost one lets the strings go slack for a moment;
 * - the stencil floats a few pixels over the strings as the phone tilts.
 *
 * One 2D canvas, redrawn each frame while anything moves and a few times a
 * second when nothing does. Everything here is presentation: `main.ts`
 * decides what happened and `view.ts` decides what to say.
 */

import type { SwingKind } from "../shared/protocol.ts";
import { TOSS_APEX } from "../shared/sim/serve.ts";
import type { Ink, RacketView, Tone } from "./view.ts";

const ACCENT = "#dcff4a";
/** The quiet ink: near white, so it still reads against grey strings. */
const INK_DIM = "#dde4ec";
/** Opaque, and greyer than white: stencil ink only lands at full strength
 * on an opaque string, and it has to stand out against the bare ones. */
const STRING = "#7f8b98";
const BG = "#05080c";
const FONT = 'system-ui, -apple-system, "SF Pro Display", sans-serif';
const ROUND = 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif';

/** Dense enough that a letter is crossed by a dozen strings: that is what
 * makes a stencil read as a word rather than as a few coloured dashes. */
const MAINS = 20;
const CROSSES = 27;
const POINTS = 26;

interface Layout {
	w: number;
	h: number;
	cx: number;
	cy: number;
	rx: number;
	ry: number;
	/** Frame thickness. */
	t: number;
	/** Inner radii: where the strings end. */
	irx: number;
	iry: number;
	/** The sweet spot, below the headline: where the ball sits and a strike
	 * ripples from. */
	sx: number;
	sy: number;
}

function layout(w: number, h: number): Layout {
	const t = Math.max(12, Math.min(18, w * 0.042));
	const rx = w / 2 - t / 2 - 10;
	const ry = Math.min(h * 0.41, rx * 1.5);
	const cx = w / 2;
	const cy = Math.max(ry + t + 8, h * 0.44);
	const irx = rx - t * 0.55;
	const iry = ry - t * 0.55;
	return { w, h, cx, cy, rx, ry, t, irx, iry, sx: cx, sy: cy + iry * 0.4 };
}

interface Ripple {
	x: number;
	y: number;
	age: number;
	amp: number;
}

interface Bit {
	x: number;
	y: number;
	vx: number;
	vy: number;
	spin: number;
	angle: number;
	life: number;
	color: string;
	size: number;
}

interface Stamp {
	text: string;
	sub: string;
	color: string;
	age: number;
}

export interface Racket {
	/** What to say. Only re-inks the strings when it changed. */
	show(view: RacketView): void;
	/** The player's colour: the frame, and anything about them. */
	setSide(color: string): void;
	/** Live rotation, 0..1: the frame glows and the strings bow. */
	level(amount: number, kind: SwingKind | null): void;
	/** A swing the phone read: the frame charges with its power. `lag` is
	 * how late the detector announced it, seconds. */
	swing(power: number, lag: number): void;
	hit(power: number): void;
	point(): void;
	miss(): void;
	/** The move being read right now, for the readout; `null` for none. */
	reading(text: string | null): void;
	/** Gravity across the screen, -1..1 each way, for the parallax. */
	tilt(x: number, y: number): void;
}

function toneColor(tone: Tone, side: string): string {
	return tone === "accent" ? ACCENT : tone === "side" ? side : INK_DIM;
}

export function createRacket(canvas: HTMLCanvasElement): Racket {
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("racket: no 2D context");
	const g: CanvasRenderingContext2D = ctx;
	const layer = document.createElement("canvas");
	const stencil = document.createElement("canvas");
	const layerCtx = layer.getContext("2d");
	const stencilCtx = stencil.getContext("2d");
	if (!layerCtx || !stencilCtx) throw new Error("racket: no 2D context");
	const lg: CanvasRenderingContext2D = layerCtx;
	const sg: CanvasRenderingContext2D = stencilCtx;
	const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

	let L = layout(1, 1);
	let dpr = 1;
	let side = ACCENT;
	let view: RacketView | null = null;
	let inkDirty = true;

	let live = 0;
	let liveKind: SwingKind | null = null;
	let charge = 0;
	let chargeAge = 99;
	let slack = 0;
	let fuzz = 0;
	let tiltX = 0;
	let tiltY = 0;
	let readout: string | null = null;
	/** Seconds since the toss left the strings, or -1 with the ball in hand. */
	let toss = -1;
	let clock = 0;
	const ripples: Ripple[] = [];
	const bits: Bit[] = [];
	let stamp: Stamp | null = null;
	/** Words printed under pieces of the headline, and where. */
	const labels: { text: string; x: number }[] = [];
	let headlineSize = 0;

	function resize(): void {
		dpr = Math.min(window.devicePixelRatio || 1, 2);
		const w = canvas.clientWidth || window.innerWidth;
		const h = canvas.clientHeight || window.innerHeight;
		for (const c of [canvas, layer, stencil]) {
			c.width = Math.round(w * dpr);
			c.height = Math.round(h * dpr);
		}
		L = layout(w, h);
		inkDirty = true;
	}

	// ------------------------------------------------------------ stencil

	/** The biggest size at which `text` fits `width`, capped at `max`. */
	function fitSize(
		text: string,
		width: number,
		max: number,
		weight: number,
		font: string,
	) {
		sg.font = `${weight} ${max}px ${font}`;
		const measured = sg.measureText(text).width || 1;
		return Math.min(max, (max * width) / measured);
	}

	function ink(): void {
		inkDirty = false;
		sg.setTransform(dpr, 0, 0, dpr, 0, 0);
		sg.clearRect(0, 0, L.w, L.h);
		if (!view) return;
		const line = view.headline.map((i: Ink) => i.text).join("");
		const size = fitSize(line, L.irx * 1.62, L.iry * 0.46, 900, ROUND);
		sg.font = `900 ${size}px ${ROUND}`;
		sg.textBaseline = "alphabetic";
		const total = sg.measureText(line).width;
		let x = L.cx - total / 2;
		const y = headlineY() + size * 0.34;
		labels.length = 0;
		for (const piece of view.headline) {
			sg.fillStyle = toneColor(piece.tone, side);
			sg.fillText(piece.text, x, y);
			const w = sg.measureText(piece.text).width;
			if (piece.label) labels.push({ text: piece.label, x: x + w / 2 });
			x += w;
		}
		headlineSize = size;
	}

	/** Where the headline sits: the upper half of the head, clear of the
	 * ball below it. */
	function headlineY(): number {
		return L.cy - L.iry * 0.24;
	}

	/** The caption and the games, printed over the strings rather than
	 * stencilled into them: at this size a stencil is crossed by two strings
	 * and cannot be read. A dark halo keeps it crisp on the weave. */
	function drawDecals(): void {
		if (!view || stamp) return;
		const cap = view.caption.toUpperCase();
		const capSize = fitSize(
			cap,
			L.irx * 1.45,
			Math.max(15, L.w * 0.046),
			800,
			FONT,
		);
		g.save();
		g.font = `800 ${capSize}px ${FONT}`;
		g.textAlign = "center";
		g.textBaseline = "middle";
		g.lineJoin = "round";
		g.lineWidth = capSize * 0.5;
		g.strokeStyle = "rgba(5,8,12,0.88)";
		const capY = headlineY() + headlineSize * 0.5 + capSize * 0.9;
		if (cap) {
			g.strokeText(cap, L.cx, capY);
			g.fillStyle = "#f3f6ef";
			g.fillText(cap, L.cx, capY);
		}
		for (const label of labels) {
			g.strokeText(label.text, label.x, capY);
			g.fillStyle = "#f3f6ef";
			g.fillText(label.text, label.x, capY);
		}

		// Games won, as two rows of pips low on the head: yours filled in
		// your colour, theirs hollow.
		if (view.games) {
			const [mine, theirs] = view.games;
			const r = Math.max(5, L.w * 0.015);
			const gap = r * 3.2;
			const rowY = L.cy + L.iry * 0.7;
			const row = (count: number, yy: number, filled: boolean) => {
				const n = Math.min(Math.max(count, 1), 7);
				for (let i = 0; i < Math.min(count, 7); i++) {
					const px = L.cx + (i - (n - 1) / 2) * gap;
					g.beginPath();
					g.arc(px, yy, r, 0, Math.PI * 2);
					g.fillStyle = "rgba(5,8,12,0.9)";
					g.fill();
					g.beginPath();
					g.arc(px, yy, r * 0.72, 0, Math.PI * 2);
					if (filled) {
						g.fillStyle = side;
						g.fill();
					} else {
						g.lineWidth = r * 0.3;
						g.strokeStyle = "rgba(243,246,239,0.7)";
						g.stroke();
					}
				}
			};
			row(mine, rowY, true);
			row(theirs, rowY + gap, false);
		}
		g.restore();
	}

	// ------------------------------------------------------------ strings

	/** How far the string bed is pushed out of place at `(x, y)`: ripples
	 * from strikes, plus the bow of a swing in progress. */
	function displace(x: number, y: number, along: number): number {
		let d = 0;
		for (const r of ripples) {
			const dist = Math.hypot(x - r.x, y - r.y);
			const front = r.age * 900;
			if (dist > front) continue;
			d +=
				r.amp *
				Math.exp(-r.age * 3.2) *
				Math.sin(dist * 0.075 - r.age * 30) *
				Math.exp(-dist / (L.w * 0.9));
		}
		const bow = Math.sin(Math.PI * along);
		const dir = liveKind === "backhand" ? 1 : liveKind === "forehand" ? -1 : 0;
		return d + bow * live * 9 * dir - bow * slack * 6;
	}

	function drawStrings(): void {
		lg.setTransform(dpr, 0, 0, dpr, 0, 0);
		lg.globalCompositeOperation = "source-over";
		lg.clearRect(0, 0, L.w, L.h);
		lg.save();
		lg.beginPath();
		lg.ellipse(L.cx, L.cy, L.irx, L.iry, 0, 0, Math.PI * 2);
		lg.clip();
		lg.lineWidth = Math.max(1.8, L.w * 0.0058);
		lg.lineCap = "round";
		const alpha = 1 - slack * 0.45;
		lg.strokeStyle = STRING;
		lg.globalAlpha = alpha;
		const ox = -tiltX * 2;
		const oy = -tiltY * 2;

		for (let i = 0; i < MAINS; i++) {
			const u = (i + 0.5) / MAINS;
			const x = L.cx - L.irx + u * L.irx * 2;
			const k = (x - L.cx) / L.irx;
			const half = L.iry * Math.sqrt(Math.max(0, 1 - k * k));
			lg.beginPath();
			for (let j = 0; j <= POINTS; j++) {
				const v = j / POINTS;
				const y = L.cy - half + v * half * 2;
				const px = x + displace(x, y, v) + ox;
				if (j === 0) lg.moveTo(px, y + oy);
				else lg.lineTo(px, y + oy);
			}
			lg.stroke();
		}
		for (let i = 0; i < CROSSES; i++) {
			const u = (i + 0.5) / CROSSES;
			const y = L.cy - L.iry + u * L.iry * 2;
			const k = (y - L.cy) / L.iry;
			const half = L.irx * Math.sqrt(Math.max(0, 1 - k * k));
			lg.beginPath();
			for (let j = 0; j <= POINTS; j++) {
				const v = j / POINTS;
				const x = L.cx - half + v * half * 2;
				const py = y + displace(x, y, v) * 0.8;
				if (j === 0) lg.moveTo(x + ox, py + oy);
				else lg.lineTo(x + ox, py + oy);
			}
			lg.stroke();
		}
		lg.restore();
		lg.globalAlpha = 1;

		// Everything from here on lands only where there is string.
		lg.globalCompositeOperation = "source-atop";
		if (fuzz > 0.01) {
			const r = L.w * 0.17;
			const grad = lg.createRadialGradient(L.sx, L.sy, 0, L.sx, L.sy, r);
			grad.addColorStop(0, `rgba(220,255,74,${0.9 * fuzz})`);
			grad.addColorStop(1, "rgba(220,255,74,0)");
			lg.fillStyle = grad;
			lg.fillRect(L.sx - r, L.sy - r, r * 2, r * 2);
		}
		const show = stamp ? Math.max(0, 1 - stamp.age * 6) : 1;
		if (show > 0) {
			lg.globalAlpha = show;
			lg.drawImage(stencil, tiltX * 2, tiltY * 2, L.w, L.h);
			lg.globalAlpha = 1;
		}
		lg.globalCompositeOperation = "source-over";
	}

	// ------------------------------------------------------------ frame

	function point(angle: number): [number, number] {
		return [L.cx + Math.cos(angle) * L.rx, L.cy + Math.sin(angle) * L.ry];
	}

	function drawFrame(): void {
		const grad = g.createLinearGradient(
			L.cx - L.rx,
			L.cy - L.ry,
			L.cx + L.rx,
			L.cy + L.ry,
		);
		grad.addColorStop(0, mixWhite(side, 0.35));
		grad.addColorStop(0.5, side);
		grad.addColorStop(1, mixBlack(side, 0.45));

		// Throat: two beams from the lower head into the hand.
		g.lineCap = "round";
		g.lineWidth = L.t * 0.95;
		g.strokeStyle = grad;
		for (const s of [-1, 1]) {
			const [x0, y0] = point(Math.PI / 2 + s * 0.5);
			g.beginPath();
			g.moveTo(x0, y0);
			g.quadraticCurveTo(
				L.cx + s * L.rx * 0.18,
				L.cy + L.ry * 1.12,
				L.cx + s * L.t * 0.8,
				L.h + 40,
			);
			g.stroke();
		}

		// The head, glowing while it moves.
		g.save();
		g.shadowColor = side;
		g.shadowBlur = 10 + live * 44;
		g.lineWidth = L.t;
		g.beginPath();
		g.ellipse(L.cx, L.cy, L.rx, L.ry, 0, 0, Math.PI * 2);
		g.stroke();
		g.restore();

		// A hard highlight down the upper left, like a lacquered frame.
		g.lineWidth = Math.max(2, L.t * 0.18);
		g.strokeStyle = "rgba(255,255,255,0.55)";
		g.beginPath();
		g.ellipse(
			L.cx,
			L.cy,
			L.rx - L.t * 0.18,
			L.ry - L.t * 0.18,
			0,
			Math.PI * 1.02,
			Math.PI * 1.42,
		);
		g.stroke();

		// Grommets: where each string passes through the frame.
		g.fillStyle = "rgba(5,8,12,0.55)";
		const hole = Math.max(1.3, L.t * 0.1);
		for (let i = 0; i < MAINS; i++) {
			const x = L.cx - L.irx + ((i + 0.5) / MAINS) * L.irx * 2;
			const k = (x - L.cx) / L.irx;
			const a = Math.asin(Math.max(-1, Math.min(1, k)));
			for (const s of [-1, 1]) {
				const angle = s < 0 ? -Math.PI / 2 + a : Math.PI / 2 - a;
				const [px, py] = point(angle);
				g.beginPath();
				g.arc(px, py, hole, 0, Math.PI * 2);
				g.fill();
			}
		}

		// Charge: the power of the last swing, round the frame from the
		// throat both ways.
		const c = charge * Math.max(0, 1 - Math.max(0, chargeAge - 0.9) * 1.6);
		if (c > 0.01) {
			g.save();
			g.lineCap = "round";
			g.lineWidth = L.t * 0.42;
			g.strokeStyle = ACCENT;
			g.shadowColor = ACCENT;
			g.shadowBlur = 18;
			const sweep = Math.min(chargeAge * 5, 1) * c * Math.PI;
			for (const s of [-1, 1]) {
				g.beginPath();
				g.ellipse(
					L.cx,
					L.cy,
					L.rx,
					L.ry,
					0,
					Math.PI / 2,
					Math.PI / 2 + s * sweep,
					s < 0,
				);
				g.stroke();
			}
			g.restore();
		}

		drawRim();
	}

	/** The rim text: printed round the top of the frame, character by
	 * character along the ellipse. */
	function drawRim(): void {
		if (!view) return;
		const text = view.rim.split("").join(" ");
		const size = Math.max(9, L.t * 0.62);
		g.save();
		g.font = `800 ${size}px ${FONT}`;
		g.fillStyle = "rgba(5,8,12,0.78)";
		g.textAlign = "center";
		g.textBaseline = "middle";
		const width = g.measureText(text).width;
		const radius = (L.rx + L.ry) / 2;
		let angle = -Math.PI / 2 - width / radius / 2;
		for (const ch of text) {
			const w = g.measureText(ch).width;
			angle += w / radius / 2;
			const [x, y] = point(angle);
			g.save();
			g.translate(x, y);
			g.rotate(angle + Math.PI / 2);
			g.fillText(ch, 0, 0);
			g.restore();
			angle += w / radius / 2;
		}
		g.restore();
	}

	// ------------------------------------------------------------ the ball

	function drawBall(): void {
		if (!view || view.serveBall === null) return;
		const r = L.w * 0.07;
		let y = L.sy;
		let squash = 1;
		if (toss >= 0) {
			// Up and back down on the real toss's clock: at the top of the
			// screen at the moment the real ball is at the top.
			const t = toss / TOSS_APEX;
			// Out through the top of the screen, as the real ball leaves the
			// racket's world.
			const height = (L.sy + r * 1.5) * (1 - (t - 1) * (t - 1));
			y = L.sy - Math.max(-r, height);
		} else if (!reduce) {
			const p = (clock * 1.6) % 1;
			const bounce = 4 * p * (1 - p);
			y = L.sy - bounce * L.iry * 0.12;
			squash = p < 0.06 || p > 0.94 ? 0.8 : 1;
		}
		// Its shadow on the strings.
		const lift = Math.max(0, (L.sy - y) / (L.iry * 0.8));
		g.fillStyle = `rgba(0,0,0,${0.35 * (1 - Math.min(1, lift))})`;
		g.beginPath();
		g.ellipse(
			L.sx,
			L.sy + r * 0.9,
			r * (1 - lift * 0.3),
			r * 0.28,
			0,
			0,
			Math.PI * 2,
		);
		g.fill();

		g.save();
		g.translate(L.sx, y);
		g.scale(1 / squash, squash);
		const felt = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
		felt.addColorStop(0, "#f4ffb0");
		felt.addColorStop(0.5, ACCENT);
		felt.addColorStop(1, "#8fae16");
		g.fillStyle = felt;
		g.beginPath();
		g.arc(0, 0, r, 0, Math.PI * 2);
		g.fill();
		g.lineWidth = r * 0.12;
		g.strokeStyle = "rgba(255,255,255,0.9)";
		g.beginPath();
		g.arc(-r * 1.25, 0, r * 0.95, -0.9, 0.9);
		g.stroke();
		g.beginPath();
		g.arc(r * 1.25, 0, r * 0.95, Math.PI - 0.9, Math.PI + 0.9);
		g.stroke();
		g.restore();
	}

	// ------------------------------------------------------ stamps, bits

	function drawStamp(dt: number): void {
		if (!stamp) return;
		stamp.age += dt;
		const t = stamp.age;
		if (t > 1.1) {
			stamp = null;
			return;
		}
		const pop =
			t < 0.12
				? 0.6 + (t / 0.12) * 0.55
				: 1.15 - Math.min(0.15, (t - 0.12) * 0.8);
		const alpha = t > 0.8 ? 1 - (t - 0.8) / 0.3 : 1;
		g.save();
		g.globalAlpha = Math.max(0, alpha);
		g.translate(L.cx, L.cy);
		g.rotate(-0.08);
		g.scale(pop, pop);
		const size = fitSize(stamp.text, L.irx * 1.5, L.iry * 0.5, 900, ROUND);
		g.font = `900 ${size}px ${ROUND}`;
		g.textAlign = "center";
		g.textBaseline = "middle";
		g.lineJoin = "round";
		g.lineWidth = size * 0.14;
		g.strokeStyle = BG;
		g.strokeText(stamp.text, 0, 0);
		g.fillStyle = stamp.color;
		g.fillText(stamp.text, 0, 0);
		if (stamp.sub) {
			g.font = `800 ${size * 0.2}px ${FONT}`;
			g.lineWidth = size * 0.05;
			g.strokeText(stamp.sub, 0, size * 0.62);
			g.fillStyle = "#f3f6ef";
			g.fillText(stamp.sub, 0, size * 0.62);
		}
		g.restore();
	}

	function drawBits(dt: number): void {
		for (let i = bits.length - 1; i >= 0; i--) {
			const b = bits[i];
			if (!b) continue;
			b.life -= dt;
			if (b.life <= 0) {
				bits.splice(i, 1);
				continue;
			}
			b.vy += 900 * dt;
			b.vx *= Math.exp(-dt * 1.5);
			b.x += b.vx * dt;
			b.y += b.vy * dt;
			b.angle += b.spin * dt;
			g.save();
			g.translate(b.x, b.y);
			g.rotate(b.angle);
			g.globalAlpha = Math.min(1, b.life * 2);
			g.fillStyle = b.color;
			g.fillRect(
				-b.size / 2,
				-b.size / 4,
				b.size,
				(b.size / 2) * Math.abs(Math.cos(b.angle * 1.7)) + 1,
			);
			g.restore();
		}
		g.globalAlpha = 1;
	}

	function burst(
		count: number,
		colors: readonly string[],
		speed: number,
	): void {
		if (reduce) return;
		for (let i = 0; i < count; i++) {
			const a = Math.random() * Math.PI * 2;
			const v = speed * (0.4 + Math.random() * 0.8);
			bits.push({
				x: L.sx,
				y: L.sy,
				vx: Math.cos(a) * v,
				vy: Math.sin(a) * v - speed * 0.6,
				spin: (Math.random() - 0.5) * 16,
				angle: Math.random() * 6,
				life: 1.2 + Math.random() * 0.9,
				color: colors[i % colors.length] ?? ACCENT,
				size: 6 + Math.random() * 7,
			});
		}
	}

	// ------------------------------------------------------------ loop

	function drawReadout(): void {
		if (!readout) return;
		g.save();
		g.font = `700 ${Math.max(12, L.w * 0.034)}px ${FONT}`;
		g.textAlign = "center";
		g.fillStyle = "rgba(243,246,239,0.55)";
		g.fillText(readout, L.cx, L.cy + L.ry + L.t * 2.4);
		g.restore();
	}

	let last = performance.now();
	let idle = 0;
	function frame(now: number): void {
		const dt = Math.min(0.05, (now - last) / 1000);
		last = now;
		clock += dt;
		const busy =
			ripples.length > 0 ||
			bits.length > 0 ||
			stamp !== null ||
			live > 0.01 ||
			toss >= 0 ||
			chargeAge < 2 ||
			fuzz > 0.01 ||
			slack > 0.01 ||
			view?.serveBall != null;
		idle += dt;
		if (!busy && !inkDirty && idle < 0.25) {
			requestAnimationFrame(frame);
			return;
		}
		idle = 0;

		for (let i = ripples.length - 1; i >= 0; i--) {
			const r = ripples[i];
			if (!r) continue;
			r.age += dt;
			if (r.age > 1.4) ripples.splice(i, 1);
		}
		chargeAge += dt;
		fuzz *= Math.exp(-dt * 1.4);
		slack *= Math.exp(-dt * 2.2);
		if (toss >= 0) {
			toss += dt;
			if (toss > TOSS_APEX * 2.4) toss = -1;
		}

		if (inkDirty) ink();
		g.setTransform(dpr, 0, 0, dpr, 0, 0);
		g.clearRect(0, 0, L.w, L.h);

		drawStrings();
		// The stencil also glows faintly under the strings, so a word reads
		// even where the weave is thin.
		if (!stamp) {
			g.globalAlpha = 0.16;
			g.drawImage(stencil, tiltX * 3, tiltY * 3, L.w, L.h);
			g.globalAlpha = 1;
		}
		g.drawImage(layer, 0, 0, L.w, L.h);
		drawDecals();
		drawFrame();
		drawBall();
		drawReadout();
		drawStamp(dt);
		drawBits(dt);
		requestAnimationFrame(frame);
	}

	resize();
	window.addEventListener("resize", resize);
	requestAnimationFrame(frame);

	return {
		show(next) {
			const changed =
				!view ||
				view.caption !== next.caption ||
				view.rim !== next.rim ||
				view.headline.map((i) => i.text + i.tone).join() !==
					next.headline.map((i) => i.text + i.tone).join() ||
				String(view.games) !== String(next.games);
			// The toss is over once the host says the ball is in play or back
			// in hand. And if the host says it is up and this phone never saw
			// its own toss (it reconnected mid-serve), put it up now.
			if (next.serveBall !== "toss" && view?.serveBall === "toss") toss = -1;
			if (next.serveBall === "toss" && toss < 0 && view?.serveBall !== "toss") {
				toss = 0;
			}
			view = next;
			if (changed) inkDirty = true;
		},
		setSide(color) {
			side = color;
			inkDirty = true;
		},
		level(amount, kind) {
			live += (amount - live) * (amount > live ? 0.6 : 0.15);
			liveKind = kind ?? liveKind;
		},
		swing(power, lag) {
			charge = Math.max(0, Math.min(1, power));
			chargeAge = 0;
			// Your serve, ball in hand: this swing is the toss. Start it now,
			// from when the swing really happened, rather than waiting a
			// round trip for the host to say so.
			if (view?.serveBall === "hand" && toss < 0) toss = lag;
			if (!reduce)
				ripples.push({ x: L.sx, y: L.sy, age: 0, amp: 3 + power * 4 });
		},
		hit(power) {
			if (!reduce)
				ripples.push({ x: L.sx, y: L.sy, age: 0, amp: 10 + power * 12 });
			fuzz = 1;
			// A hit with no swing read first (a revised strike, or a phone
			// that missed its own peak) has no number to show.
			stamp =
				power > 0.05
					? {
							text: String(Math.round(power * 100)),
							sub: "POWER",
							color: ACCENT,
							age: 0,
						}
					: { text: "HIT", sub: "", color: ACCENT, age: 0 };
			burst(18, [ACCENT, "#ffffff", ACCENT], 520);
		},
		point() {
			stamp = { text: "POINT", sub: "", color: "#34d86a", age: 0 };
			burst(60, [side, ACCENT, "#ffffff", "#34d86a"], 760);
		},
		miss() {
			stamp = { text: "POINT LOST", sub: "", color: "#ff5a5f", age: 0 };
			slack = 1;
		},
		reading(text) {
			readout = text;
		},
		tilt(x, y) {
			tiltX += (x - tiltX) * 0.1;
			tiltY += (y - tiltY) * 0.1;
		},
	};
}

/** `hex` toward white or black by `t`. */
function mixWhite(hex: string, t: number): string {
	return mixWith(hex, 255, t);
}
function mixBlack(hex: string, t: number): string {
	return mixWith(hex, 0, t);
}
function mixWith(hex: string, to: number, t: number): string {
	const n = Number.parseInt(hex.slice(1), 16);
	const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) =>
		Math.round(v + (to - v) * t),
	);
	return `rgb(${c[0]},${c[1]},${c[2]})`;
}
