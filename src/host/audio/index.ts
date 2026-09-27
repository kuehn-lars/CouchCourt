/**
 * Sound, synthesised. No files, no `fetch`, no decode step and nothing to
 * license.
 *
 * Driven by the same `RenderEvent[]` the renderer draws from, and by the
 * callouts `arcade.ts` makes of them, so a sound can never disagree with
 * the picture.
 *
 * ## The mix
 *
 * Everything goes through one bus: a compressor, so a smash on top of a
 * cheer on top of a callout never clips, and a short generated stadium
 * reverb on a send. Once a rally gets going a crowd murmur rises under it,
 * and it is **silent at rest**: a constant noise bed is heard as static,
 * which is exactly what the first version sounded like (2026-09-27).
 *
 * ## The hooks
 *
 * Each stroke in a rally rings one note higher up a pentatonic scale, so a
 * long rally is heard climbing before anyone reads the counter; a perfectly
 * timed ball sparkles; a power shot booms. Those three are the reason to
 * listen (`llm-knowledge/decisions/0022-arcade-layer.md`).
 *
 * Not unit tested, per `CLAUDE.md` §3 — this is hardware output.
 *
 * ## The one platform rule
 *
 * Browsers will not start an `AudioContext` without a user gesture. The host
 * page's Start buttons call `resume()`. Everything before that is silent on
 * purpose rather than broken.
 */

import type { Callout } from "../arcade.ts";
import { gradeOf } from "../arcade.ts";
import type { RenderEvent } from "../render/events.ts";

/** Semitones of the major pentatonic, one octave. */
const PENTATONIC = [0, 2, 4, 7, 9];
/** Hz. The rally's first note, and the root of every sting. */
const C5 = 523.25;
/** Rungs before the ladder stops climbing: two octaves. */
const LADDER_TOP = 10;

const semis = (root: number, n: number) => root * 2 ** (n / 12);

/** Hz of rung `n` of the rally ladder. */
function ladder(n: number): number {
	const rung = Math.min(n, LADDER_TOP);
	const octave = Math.floor(rung / PENTATONIC.length);
	const step = PENTATONIC[rung % PENTATONIC.length] ?? 0;
	return semis(C5, octave * 12 + step);
}

export interface Audio {
	/** Call from a user gesture. Safe to call repeatedly. */
	resume(): void;
	/** A frame's events. `rally` is the stroke count after them. */
	play(events: readonly RenderEvent[], rally: number): void;
	callouts(callouts: readonly Callout[]): void;
	/** 3, 2, 1, then 0 for "Play". */
	countdown(n: number): void;
	jingle(kind: "game" | "match"): void;
	/** The settings sheet's sound switch. Holds across `resume`. */
	setMuted(muted: boolean): void;
}

export function createAudio(): Audio {
	let ctx: AudioContext | null = null;
	let noise: AudioBuffer | null = null;
	let master: GainNode | null = null;
	let wet: GainNode | null = null;
	let crowd: GainNode | null = null;
	let muted = false;
	const LEVEL = 0.6;
	/** The crowd's excitement, 0..1, last scheduled in `play`. */
	let hype = 0;

	function ensure(): AudioContext | null {
		if (ctx) return ctx;
		// Safari still only has the prefixed constructor on some versions.
		const Ctor =
			window.AudioContext ??
			(window as unknown as { webkitAudioContext?: typeof AudioContext })
				.webkitAudioContext;
		if (!Ctor) return null;
		const c = new Ctor();
		ctx = c;

		// Two seconds of noise, reused by every percussive sound and looped
		// for the crowd. Built once: generating it per hit would allocate
		// 88k floats in the frame loop.
		const length = Math.floor(c.sampleRate * 2);
		noise = c.createBuffer(1, length, c.sampleRate);
		const data = noise.getChannelData(0);
		for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

		const glue = c.createDynamicsCompressor();
		glue.threshold.value = -16;
		glue.knee.value = 12;
		glue.ratio.value = 5;
		glue.attack.value = 0.003;
		glue.release.value = 0.2;
		glue.connect(c.destination);

		master = c.createGain();
		master.gain.value = muted ? 0 : LEVEL;
		master.connect(glue);

		// A stadium: a second and a half of decaying stereo noise.
		const verb = c.createConvolver();
		const tail = Math.floor(c.sampleRate * 1.5);
		const impulse = c.createBuffer(2, tail, c.sampleRate);
		for (let ch = 0; ch < 2; ch++) {
			const d = impulse.getChannelData(ch);
			for (let i = 0; i < tail; i++) {
				d[i] = (Math.random() * 2 - 1) * (1 - i / tail) ** 3.2;
			}
		}
		verb.buffer = impulse;
		wet = c.createGain();
		wet.gain.value = 0.22;
		wet.connect(verb).connect(master);

		// The crowd murmur: looped noise, low-passed well under the hiss
		// band and swayed by a slow wobble, so it reads as many voices
		// rather than as a detuned radio. Its gain is 0 until a rally builds.
		const bed = c.createBufferSource();
		bed.buffer = noise;
		bed.loop = true;
		const murmur = c.createBiquadFilter();
		murmur.type = "lowpass";
		murmur.frequency.value = 420;
		murmur.Q.value = 0.4;
		const sway = c.createGain();
		sway.gain.value = 0.7;
		const wobble = c.createOscillator();
		wobble.frequency.value = 0.45;
		const depth = c.createGain();
		depth.gain.value = 0.3;
		wobble.connect(depth).connect(sway.gain);
		crowd = c.createGain();
		crowd.gain.value = 0;
		bed.connect(murmur).connect(sway).connect(crowd).connect(master);
		bed.start();
		wobble.start();
		return c;
	}

	/** Where a sound goes: dry to the bus, and a share to the reverb. */
	function out(node: AudioNode, reverb: number): void {
		if (!master || !wet) return;
		node.connect(master);
		if (reverb > 0 && ctx) {
			const send = ctx.createGain();
			send.gain.value = reverb;
			node.connect(send).connect(wet);
		}
	}

	/** Filtered noise with an exponential tail; `sweepTo` glides the
	 * filter, which is what a swoosh or a cheer is. */
	function burst(
		at: number,
		gain: number,
		frequency: number,
		q: number,
		decay: number,
		opts: {
			sweepTo?: number;
			attack?: number;
			type?: BiquadFilterType;
			reverb?: number;
		} = {},
	): void {
		if (!ctx || !noise) return;
		const source = ctx.createBufferSource();
		source.buffer = noise;
		const filter = ctx.createBiquadFilter();
		filter.type = opts.type ?? "bandpass";
		filter.frequency.setValueAtTime(frequency, at);
		if (opts.sweepTo) {
			filter.frequency.exponentialRampToValueAtTime(opts.sweepTo, at + decay);
		}
		filter.Q.value = q;
		const env = ctx.createGain();
		const attack = opts.attack ?? 0.002;
		env.gain.setValueAtTime(0.0001, at);
		env.gain.exponentialRampToValueAtTime(gain, at + attack);
		env.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
		source.connect(filter).connect(env);
		out(env, opts.reverb ?? 0.15);
		// A random start point: the same slice of noise every time is
		// heard as the same sample, and that is what makes synth sound fake.
		const room = noise.duration - attack - decay - 0.05;
		source.start(at, Math.random() * Math.max(0, room));
		source.stop(at + attack + decay + 0.05);
	}

	/** A pitched voice with a fast attack, optionally gliding. */
	function tone(
		at: number,
		frequency: number,
		gain: number,
		decay: number,
		type: OscillatorType = "triangle",
		opts: {
			glideTo?: number;
			lowpass?: number;
			reverb?: number;
			attack?: number;
		} = {},
	): void {
		if (!ctx) return;
		const osc = ctx.createOscillator();
		osc.type = type;
		osc.frequency.setValueAtTime(frequency, at);
		if (opts.glideTo) {
			osc.frequency.exponentialRampToValueAtTime(opts.glideTo, at + decay);
		}
		const env = ctx.createGain();
		const attack = opts.attack ?? 0.005;
		env.gain.setValueAtTime(0.0001, at);
		env.gain.exponentialRampToValueAtTime(gain, at + attack);
		env.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
		let tail: AudioNode = env;
		osc.connect(env);
		if (opts.lowpass) {
			const lp = ctx.createBiquadFilter();
			lp.type = "lowpass";
			lp.frequency.value = opts.lowpass;
			env.connect(lp);
			tail = lp;
		}
		out(tail, opts.reverb ?? 0.2);
		osc.start(at);
		osc.stop(at + attack + decay + 0.05);
	}

	/** Notes in a row, `gap` seconds apart: arpeggios and fanfares. */
	function run(
		at: number,
		notes: readonly number[],
		gap: number,
		gain: number,
		decay: number,
		type: OscillatorType = "square",
	): void {
		notes.forEach((hz, i) => {
			tone(at + i * gap, hz, gain, decay, type, { lowpass: 3200, reverb: 0.3 });
		});
	}

	function cheer(at: number, size: number): void {
		burst(at + 0.04, 0.1 + 0.2 * size, 1400, 0.5, 0.9 + size, {
			attack: 0.25,
			reverb: 0.4,
		});
		burst(at + 0.1, 0.06 + 0.12 * size, 3200, 0.6, 0.7 + size * 0.8, {
			attack: 0.2,
			reverb: 0.4,
		});
	}

	return {
		setMuted(value) {
			muted = value;
			if (ctx && master) {
				master.gain.setTargetAtTime(muted ? 0 : LEVEL, ctx.currentTime, 0.05);
			}
		},

		resume() {
			const context = ensure();
			if (context && context.state === "suspended") void context.resume();
		},

		play(events, rally) {
			// Never the thing that creates the context: `resume` does, from
			// a click. This runs every frame, lobby included.
			if (!ctx) return;
			const now = ctx.currentTime;

			// The crowd leans in from the third stroke of a rally and falls
			// quiet between points. Scheduled only when it changes: the
			// param eases itself, and this runs every frame.
			const want = rally < 3 ? 0 : Math.min(1, (rally - 2) / 12);
			if (want !== hype) {
				crowd?.gain.setTargetAtTime(
					want * 0.12,
					now,
					want > hype ? 0.35 : 0.45,
				);
				hype = want;
			}

			for (const event of events) {
				switch (event.kind) {
					case "hit": {
						// A re-struck ball is the same shot: one crack, not two.
						if (event.revised) break;
						const p = event.power;
						// The strings: a bright click, then the hollow body.
						burst(now, 0.4 + 0.3 * p, 4200, 0.9, 0.03, {
							type: "highpass",
							reverb: 0.1,
						});
						tone(now, 240 + 60 * p, 0.45, 0.07, "sine", {
							glideTo: 110,
							reverb: 0.1,
						});
						burst(now, 0.25 + 0.25 * p, 1900 + 700 * p, 1.2, 0.07);
						// The rally ladder: one rung per stroke.
						const note = ladder(Math.max(0, rally - 1));
						tone(now + 0.01, note, 0.1, 0.28, "triangle", { reverb: 0.3 });
						if (gradeOf(event.timing) === "perfect") {
							tone(now + 0.04, note * 2, 0.07, 0.35, "sine", { reverb: 0.5 });
							tone(now + 0.09, note * 3, 0.05, 0.4, "sine", { reverb: 0.5 });
						}
						if (event.powerShot || event.stroke === "smash") {
							tone(now, 90, 0.6, 0.3, "sine", { glideTo: 38, reverb: 0.2 });
							burst(now, 0.35, 700, 0.7, 0.22, { sweepTo: 2600, reverb: 0.3 });
						}
						break;
					}
					case "whiff":
						burst(now, 0.16, 2400, 1.4, 0.22, { sweepTo: 500, attack: 0.03 });
						break;
					case "toss":
						tone(now, 380, 0.05, 0.16, "sine", { glideTo: 700 });
						break;
					case "bounce": {
						tone(now, 170, 0.22, 0.07, "sine", { glideTo: 85 });
						burst(now, 0.16, 900, 1.4, 0.06);
						break;
					}
					case "point": {
						cheer(now, Math.min(1, rally / 10));
						break;
					}
				}
			}
		},

		callouts(list) {
			if (!ctx) return;
			const now = ctx.currentTime;
			for (const c of list) {
				switch (c.kind) {
					case "ace":
						run(
							now,
							[C5, semis(C5, 4), semis(C5, 7), semis(C5, 12), semis(C5, 16)],
							0.06,
							0.08,
							0.35,
						);
						cheer(now, 0.8);
						break;
					case "winner":
						run(
							now,
							[semis(C5, 7), semis(C5, 12), semis(C5, 16)],
							0.07,
							0.08,
							0.3,
						);
						break;
					case "power":
					case "fire":
						burst(now, 0.3, 300, 0.8, 0.6, {
							sweepTo: 5000,
							attack: 0.05,
							reverb: 0.4,
						});
						run(
							now + 0.1,
							[semis(C5, -5), C5, semis(C5, 7), semis(C5, 12)],
							0.05,
							0.09,
							0.4,
							"sawtooth",
						);
						break;
					case "record":
						// Two bells.
						tone(now, semis(C5, 19), 0.1, 0.8, "sine", { reverb: 0.6 });
						tone(now + 0.14, semis(C5, 24), 0.1, 1, "sine", { reverb: 0.6 });
						break;
					case "rally":
						run(
							now,
							[semis(C5, 7), semis(C5, 12), semis(C5, 19)],
							0.045,
							0.06,
							0.2,
							"triangle",
						);
						break;
					case "miss":
						tone(now, 330, 0.08, 0.35, "triangle", {
							glideTo: 180,
							lowpass: 1500,
						});
						break;
					case "broken":
						burst(now, 0.15, 3000, 0.8, 0.5, { sweepTo: 300 });
						break;
				}
			}
		},

		countdown(n) {
			if (!ctx) return;
			const now = ctx.currentTime;
			if (n > 0) {
				tone(now, 440, 0.12, 0.12, "square", { lowpass: 2400 });
			} else {
				tone(now, 880, 0.12, 0.4, "square", { lowpass: 3200, reverb: 0.4 });
				tone(now, 1318.5, 0.08, 0.45, "square", { lowpass: 3200, reverb: 0.4 });
				cheer(now, 0.4);
			}
		},

		jingle(kind) {
			if (!ctx) return;
			const now = ctx.currentTime;
			if (kind === "game") {
				run(
					now + 0.25,
					[C5, semis(C5, 4), semis(C5, 7), semis(C5, 12)],
					0.08,
					0.07,
					0.3,
				);
				return;
			}
			const G = semis(C5, 7);
			run(
				now + 0.3,
				[C5, C5, C5, semis(C5, 4), G, G, semis(C5, 4), G, semis(C5, 12)],
				0.11,
				0.08,
				0.35,
				"sawtooth",
			);
			tone(now + 1.3, semis(C5, -12), 0.12, 1.4, "triangle", { reverb: 0.5 });
			cheer(now + 0.2, 1);
			cheer(now + 1.2, 1);
		},
	};
}
