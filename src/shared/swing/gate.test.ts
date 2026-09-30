import { describe, expect, it } from "vitest";
import { createSwingGate, SWING_COOLDOWN_MS, SWING_GROUP_MS } from "./gate.ts";

describe("createSwingGate", () => {
	it("lets every peak of one swing through", () => {
		const gate = createSwingGate();
		expect(gate.admit(1000, 0.5)).toBe(true);
		expect(gate.admit(1000 + SWING_GROUP_MS / 2, 0.5)).toBe(true);
		expect(gate.admit(1000 + SWING_GROUP_MS, 0.5)).toBe(true);
	});

	it("drops a new swing started before the racket has recharged", () => {
		const gate = createSwingGate();
		gate.admit(1000, 0.5);
		expect(gate.admit(1000 + SWING_GROUP_MS + 1, 0.5)).toBe(false);
		expect(gate.admit(1000 + SWING_COOLDOWN_MS - 1, 0.5)).toBe(false);
	});

	it("takes the next swing once recharged, and times the next cooldown from it", () => {
		const gate = createSwingGate();
		gate.admit(1000, 0.5);
		const next = 1000 + SWING_COOLDOWN_MS;
		expect(gate.admit(next, 0.5)).toBe(true);
		expect(gate.admit(next + SWING_GROUP_MS + 1, 0.5)).toBe(false);
	});

	it("does not let dropped peaks extend the cooldown", () => {
		const gate = createSwingGate();
		gate.admit(0, 0.5);
		for (let t = SWING_GROUP_MS + 50; t < SWING_COOLDOWN_MS; t += 100) {
			gate.admit(t, 0.5);
		}
		expect(gate.admit(SWING_COOLDOWN_MS, 0.5)).toBe(true);
	});

	it("reports the charge from empty at the swing to full at the end of the cooldown", () => {
		const gate = createSwingGate();
		expect(gate.charge(0)).toBe(1);
		gate.admit(1000, 0.5);
		expect(gate.charge(1000)).toBe(0);
		expect(gate.charge(1000 + SWING_COOLDOWN_MS / 2)).toBeCloseTo(0.5);
		expect(gate.charge(1000 + SWING_COOLDOWN_MS * 2)).toBe(1);
	});

	it("takes a harder swing behind its own take-back, and times the cooldown from it", () => {
		const gate = createSwingGate();
		gate.admit(0, 0.2);
		const swing = SWING_GROUP_MS + 400;
		expect(gate.admit(swing, 0.75)).toBe(true);
		expect(gate.charge(swing)).toBe(0);
		expect(gate.admit(swing + SWING_GROUP_MS + 1, 0.9)).toBe(false);
	});

	it("still drops a flail no harder than the swing that opened it", () => {
		const gate = createSwingGate();
		gate.admit(0, 0.8);
		expect(gate.admit(SWING_GROUP_MS + 100, 0.8)).toBe(false);
		expect(gate.admit(SWING_GROUP_MS + 300, 0.5)).toBe(false);
	});

	it("forgets the last swing on reset", () => {
		const gate = createSwingGate();
		gate.admit(1000, 0.5);
		gate.reset();
		expect(gate.admit(1000 + SWING_GROUP_MS + 1, 0.5)).toBe(true);
		expect(gate.charge(1000 + SWING_GROUP_MS + 1)).toBe(0);
	});
});
