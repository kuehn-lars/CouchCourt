import { describe, expect, it } from "vitest";
import { createSwingGate, SWING_COOLDOWN_MS, SWING_GROUP_MS } from "./gate.ts";

describe("createSwingGate", () => {
	it("lets every peak of one swing through", () => {
		const gate = createSwingGate();
		expect(gate.admit(1000)).toBe(true);
		expect(gate.admit(1000 + SWING_GROUP_MS / 2)).toBe(true);
		expect(gate.admit(1000 + SWING_GROUP_MS)).toBe(true);
	});

	it("drops a new swing started before the racket has recharged", () => {
		const gate = createSwingGate();
		gate.admit(1000);
		expect(gate.admit(1000 + SWING_GROUP_MS + 1)).toBe(false);
		expect(gate.admit(1000 + SWING_COOLDOWN_MS - 1)).toBe(false);
	});

	it("takes the next swing once recharged, and times the next cooldown from it", () => {
		const gate = createSwingGate();
		gate.admit(1000);
		const next = 1000 + SWING_COOLDOWN_MS;
		expect(gate.admit(next)).toBe(true);
		expect(gate.admit(next + SWING_GROUP_MS + 1)).toBe(false);
	});

	it("does not let dropped peaks extend the cooldown", () => {
		const gate = createSwingGate();
		gate.admit(0);
		for (let t = SWING_GROUP_MS + 50; t < SWING_COOLDOWN_MS; t += 100) {
			gate.admit(t);
		}
		expect(gate.admit(SWING_COOLDOWN_MS)).toBe(true);
	});

	it("reports the charge from empty at the swing to full at the end of the cooldown", () => {
		const gate = createSwingGate();
		expect(gate.charge(0)).toBe(1);
		gate.admit(1000);
		expect(gate.charge(1000)).toBe(0);
		expect(gate.charge(1000 + SWING_COOLDOWN_MS / 2)).toBeCloseTo(0.5);
		expect(gate.charge(1000 + SWING_COOLDOWN_MS * 2)).toBe(1);
	});

	it("forgets the last swing on reset", () => {
		const gate = createSwingGate();
		gate.admit(1000);
		gate.reset();
		expect(gate.admit(1000 + SWING_GROUP_MS + 1)).toBe(true);
		expect(gate.charge(1000 + SWING_GROUP_MS + 1)).toBe(0);
	});
});
