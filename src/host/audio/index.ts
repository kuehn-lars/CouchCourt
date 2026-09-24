/**
 * Sound, synthesised. No files, no `fetch`, no decode step and nothing to
 * license, and the whole module is smaller than a single short wav would be.
 *
 * Driven by the same `RenderEvent[]` the renderer draws from, so a sound can
 * never disagree with the picture: one derivation of "a hit happened", in
 * `render/index.ts`'s `detectEvents`.
 *
 * Not unit tested, per `CLAUDE.md` §3 — this is hardware output, and the
 * only thing a test could assert is that the same calls were made.
 *
 * ## The one platform rule
 *
 * Browsers will not start an `AudioContext` without a user gesture. The host
 * page has exactly one button, so `resume()` is called from it. Everything
 * before that is silent on purpose rather than broken.
 */

import type { RenderEvent } from "../render/events.ts";

/** A short noise buffer, reused by every percussive sound. Built once: a
 * second of noise is 44k floats and generating one per hit would allocate in
 * the frame loop, which is the thing `modules/host.md` rule 2 forbids for
 * exactly the same reason here. */
function noiseBuffer(ctx: AudioContext): AudioBuffer {
	const length = Math.floor(ctx.sampleRate * 0.4);
	const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
	const data = buffer.getChannelData(0);
	for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
	return buffer;
}

export interface Audio {
	/** Call from a user gesture. Safe to call repeatedly. */
	resume(): void;
	play(events: readonly RenderEvent[]): void;
	/** The settings sheet's sound switch. Holds across `resume`. */
	setMuted(muted: boolean): void;
}

export function createAudio(): Audio {
	let ctx: AudioContext | null = null;
	let noise: AudioBuffer | null = null;
	let master: GainNode | null = null;
	let muted = false;
	const LEVEL = 0.5;

	function ensure(): AudioContext | null {
		if (ctx) return ctx;
		// Safari still only has the prefixed constructor on some versions.
		const Ctor =
			window.AudioContext ??
			(window as unknown as { webkitAudioContext?: typeof AudioContext })
				.webkitAudioContext;
		if (!Ctor) return null;
		ctx = new Ctor();
		noise = noiseBuffer(ctx);
		master = ctx.createGain();
		master.gain.value = muted ? 0 : LEVEL;
		master.connect(ctx.destination);
		return ctx;
	}

	/** A filtered burst of noise: the body of every impact sound. */
	function burst(
		at: number,
		gain: number,
		frequency: number,
		q: number,
		decay: number,
	): void {
		if (!ctx || !noise || !master) return;
		const source = ctx.createBufferSource();
		source.buffer = noise;
		const filter = ctx.createBiquadFilter();
		filter.type = "bandpass";
		filter.frequency.value = frequency;
		filter.Q.value = q;
		const envelope = ctx.createGain();
		envelope.gain.setValueAtTime(gain, at);
		envelope.gain.exponentialRampToValueAtTime(0.0001, at + decay);
		source.connect(filter).connect(envelope).connect(master);
		source.start(at);
		source.stop(at + decay + 0.02);
	}

	/** A tone with a fast attack: the pitched part of a hit, and the chime. */
	function tone(
		at: number,
		frequency: number,
		gain: number,
		decay: number,
		type: OscillatorType = "triangle",
	): void {
		if (!ctx || !master) return;
		const osc = ctx.createOscillator();
		osc.type = type;
		osc.frequency.setValueAtTime(frequency, at);
		const envelope = ctx.createGain();
		envelope.gain.setValueAtTime(0.0001, at);
		envelope.gain.exponentialRampToValueAtTime(gain, at + 0.006);
		envelope.gain.exponentialRampToValueAtTime(0.0001, at + decay);
		osc.connect(envelope).connect(master);
		osc.start(at);
		osc.stop(at + decay + 0.02);
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

		play(events) {
			if (events.length === 0 || !ensure() || !ctx) return;
			const now = ctx.currentTime;

			for (const event of events) {
				switch (event.kind) {
					case "hit": {
						// A re-struck ball is the same shot: one crack, not two.
						if (event.revised) break;
						// Strings: a bright, very short crack with a pitched
						// core. Harder swings are louder and a touch higher.
						const p = event.power;
						burst(now, 0.35 + 0.3 * p, 2200 + 900 * p, 1.1, 0.075);
						tone(now, 280 + 90 * p, 0.2, 0.09, "square");
						break;
					}
					case "whiff":
						// Air: a soft, breathy swish and nothing pitched.
						burst(now, 0.12, 1400, 0.5, 0.2);
						break;
					case "toss":
						tone(now, 520, 0.05, 0.12, "sine");
						break;
					case "bounce":
						// Court: duller, lower, and longer than the racket.
						burst(now, 0.3, 900, 1.6, 0.12);
						tone(now, 150, 0.12, 0.1, "sine");
						break;
					case "point": {
						// Applause: broadband noise with a slow swell, which is
						// what a crowd is. Quieter than the racket so a point
						// never drowns the next serve.
						burst(now + 0.05, 0.16, 1500, 0.7, 1.1);
						burst(now + 0.12, 0.1, 3200, 0.5, 0.9);
						// Two notes a fifth apart, the second a beat behind — the
						// only non-percussive sound in the game, so a point never
						// reads as another hit.
						tone(now + 0.02, 660, 0.18, 0.5);
						tone(now + 0.14, 990, 0.16, 0.6);
						break;
					}
				}
			}
		},
	};
}
