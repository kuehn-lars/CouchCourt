import { describe, expect, it } from "vitest";
import {
	type ControllerMessage,
	isControllerMessage,
	parseControllerMessage,
} from "./protocol.ts";

describe("isControllerMessage", () => {
	it("accepts each variant of the union", () => {
		const valid: ControllerMessage[] = [
			{ t: "hello", v: 1 },
			{ t: "hello", v: 1, resume: "p_abc" },
			{ t: "ready", ready: true },
			{ t: "aim", yaw: 0.2, pitch: -1.1 },
			{ t: "swing", kind: "forehand", power: 0.75, at: 1234.5 },
		];
		for (const message of valid) {
			expect(isControllerMessage(message), JSON.stringify(message)).toBe(true);
		}
	});

	it("rejects malformed payloads", () => {
		const invalid: unknown[] = [
			null,
			"hello",
			42,
			{},
			{ t: "unknown" },
			{ t: "ready", ready: "yes" },
			{ t: "aim", yaw: 0 }, // pitch missing
			{ t: "swing", kind: "volley", power: 0.5, at: 1 }, // not a SwingKind
			{ t: "swing", kind: "serve", power: 1.5, at: 1 }, // power out of range
			{ t: "hello", v: 1, resume: 7 },
		];
		for (const message of invalid) {
			expect(isControllerMessage(message), JSON.stringify(message)).toBe(false);
		}
	});

	// NaN survives JSON.parse as `null`, but arrives intact from an in-process
	// sender. Either way it must never reach the simulation.
	it("rejects non-finite numbers", () => {
		expect(isControllerMessage({ t: "aim", yaw: Number.NaN, pitch: 0 })).toBe(
			false,
		);
		expect(
			isControllerMessage({
				t: "swing",
				kind: "serve",
				power: 0.5,
				at: Number.POSITIVE_INFINITY,
			}),
		).toBe(false);
	});

	it("narrows the union for the caller", () => {
		const message: unknown = { t: "swing", kind: "backhand", power: 1, at: 0 };
		expect(isControllerMessage(message)).toBe(true);
		if (isControllerMessage(message) && message.t === "swing") {
			// Compiles only if the guard narrows — this test is half type-level.
			const kind: "forehand" | "backhand" | "serve" = message.kind;
			expect(kind).toBe("backhand");
		}
	});
});

describe("parseControllerMessage", () => {
	it("round-trips a valid message", () => {
		expect(parseControllerMessage('{"t":"ready","ready":false}')).toEqual({
			t: "ready",
			ready: false,
		});
	});

	it("returns null for invalid JSON rather than throwing", () => {
		expect(parseControllerMessage("{not json")).toBeNull();
	});

	it("returns null for valid JSON that is not a message", () => {
		expect(parseControllerMessage('{"t":"drop-tables"}')).toBeNull();
	});
});
