import { describe, expect, it } from "vitest";
import { parsePrefs } from "./prefs.ts";

type Camera = "broadcast" | "follow" | "side";
const DEFAULTS: { camera: Camera; sound: boolean } = {
	camera: "broadcast",
	sound: true,
};
const ALLOWED = {
	camera: ["broadcast", "follow", "side"] as Camera[],
	sound: [true, false],
};

describe("parsePrefs", () => {
	it("falls back to the defaults when nothing is stored", () => {
		expect(parsePrefs(null, DEFAULTS, ALLOWED)).toEqual(DEFAULTS);
	});

	it("falls back to the defaults on anything that is not a JSON object", () => {
		for (const raw of ["{", "42", "null", "[]", '"side"']) {
			expect(parsePrefs(raw, DEFAULTS, ALLOWED)).toEqual(DEFAULTS);
		}
	});

	it("keeps each stored value that is still allowed", () => {
		const raw = JSON.stringify({ camera: "side", sound: false });
		expect(parsePrefs(raw, DEFAULTS, ALLOWED)).toEqual({
			camera: "side",
			sound: false,
		});
	});

	it("drops a value one field at a time, not the whole record", () => {
		// A mode renamed in a later build must not also reset the sound.
		const raw = JSON.stringify({ camera: "drone", sound: false, extra: 1 });
		expect(parsePrefs(raw, DEFAULTS, ALLOWED)).toEqual({
			camera: "broadcast",
			sound: false,
		});
	});
});
