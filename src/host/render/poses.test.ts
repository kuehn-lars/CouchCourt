import { describe, expect, it } from "vitest";
import {
	CLIPS,
	type Clip,
	gait,
	JOINT_INDEX,
	makePose,
	mixUpper,
	POSE_LENGTH,
	sample,
	strokeEntry,
} from "./poses.ts";

const a = makePose({ shoulderR: [1, 0, 0], hipR: [1, 0, 0] });
const b = makePose({ shoulderR: [3, 0, 0], hipR: [3, 0, 0], lift: 1 });
const clip: Clip = {
	duration: 1,
	contact: 0.5,
	keys: [
		{ t: 0, pose: a },
		{ t: 0.5, pose: b },
		{ t: 1, pose: a },
	],
};
const out = () => new Float32Array(POSE_LENGTH);
const shoulder = (p: Float32Array) => p[JOINT_INDEX.shoulderR];

describe("sample", () => {
	it("hits every key exactly on its time", () => {
		expect(shoulder(sample(clip, 0, out()))).toBe(1);
		expect(shoulder(sample(clip, 0.5, out()))).toBe(3);
		expect(shoulder(sample(clip, 1, out()))).toBe(1);
	});

	it("holds the end poses outside the clip", () => {
		expect(shoulder(sample(clip, -2, out()))).toBe(1);
		expect(shoulder(sample(clip, 7, out()))).toBe(1);
	});

	// Eased, not linear: a quarter of the way through a segment is less than
	// a quarter of the way through the motion, which is what makes a swing
	// accelerate instead of sliding.
	it("eases between keys, symmetric about the middle", () => {
		expect(shoulder(sample(clip, 0.25, out()))).toBeCloseTo(2);
		const early = shoulder(sample(clip, 0.125, out())) ?? 0;
		expect(early).toBeGreaterThan(1);
		expect(early).toBeLessThan(1.5);
	});

	it("walks into the second segment, not back to the first", () => {
		expect(shoulder(sample(clip, 0.75, out()))).toBeCloseTo(2);
	});
});

describe("mixUpper", () => {
	// A player who swings while running keeps their legs running.
	it("gives the legs only their share of the blend", () => {
		const p = mixUpper(out(), a, b, 1, 0.25);
		expect(shoulder(p)).toBe(3);
		expect(p[JOINT_INDEX.hipR]).toBeCloseTo(1.5);
		expect(p[0]).toBe(1);
	});
});

describe("the clips", () => {
	it("are keyed in order, from 0 to 1, with the contact inside", () => {
		for (const [name, c] of Object.entries(CLIPS)) {
			const times = c.keys.map((k) => k.t);
			expect(times[0], name).toBe(0);
			expect(times[times.length - 1], name).toBe(1);
			for (let i = 1; i < times.length; i++) {
				expect(times[i], name).toBeGreaterThan(times[i - 1] ?? 0);
			}
			expect(c.contact, name).toBeGreaterThanOrEqual(0);
			expect(c.contact, name).toBeLessThan(1);
		}
	});

	// Playback joins a stroke just before its contact frame, so the racket
	// is seen meeting the ball rather than starting a swing after it left.
	it("enter each stroke before its contact and not at its start", () => {
		for (const name of ["forehand", "backhand", "serve", "smash"] as const) {
			const c = CLIPS[name];
			expect(strokeEntry(c), name).toBeLessThan(c.contact);
			expect(strokeEntry(c), name).toBeGreaterThan(0);
		}
	});
});

describe("gait", () => {
	it("stands still at no speed, whatever the phase", () => {
		const p = gait(1.3, 0, 0, out());
		const q = gait(4.1, 0, 0, out());
		p.forEach((v, i) => {
			expect(v).toBeCloseTo(q[i] ?? Number.NaN);
		});
	});

	it("swings the legs against each other when running", () => {
		const p = gait(Math.PI / 2, 1, 0, out());
		expect(p[JOINT_INDEX.hipR]).toBeGreaterThan(p[JOINT_INDEX.hipL] ?? 0);
	});
});
