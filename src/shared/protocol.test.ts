import { describe, expect, it } from "vitest";
import {
	type ControllerMessage,
	type HostMessage,
	isControllerMessage,
	isHostMessage,
	parseControllerMessage,
	parseHostMessage,
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

describe("isHostMessage", () => {
	it("accepts each variant of the union", () => {
		const valid: HostMessage[] = [
			{ t: "host-hello", v: 1 },
			{ t: "feedback", playerId: "p_abc", kind: "hit" },
			{ t: "feedback", playerId: "p_abc", kind: "point" },
		];
		for (const message of valid) {
			expect(isHostMessage(message), JSON.stringify(message)).toBe(true);
		}
	});

	it("rejects malformed payloads", () => {
		const invalid: unknown[] = [
			null,
			{ t: "host-hello" },
			{ t: "host-hello", v: Number.NaN },
			{ t: "feedback", kind: "hit" }, // playerId missing
			{ t: "feedback", playerId: "p", kind: "explode" },
			{ t: "swing", kind: "serve", power: 1, at: 0 }, // controller message
		];
		for (const message of invalid) {
			expect(isHostMessage(message), JSON.stringify(message)).toBe(false);
		}
	});

	// The two inbound directions must not accept each other's traffic, or a
	// misrouted socket would look like a working one.
	it("does not accept controller messages, and vice versa", () => {
		const controller: unknown = { t: "ready", ready: true };
		const host: unknown = { t: "host-hello", v: 1 };
		expect(isHostMessage(controller)).toBe(false);
		expect(isControllerMessage(host)).toBe(false);
	});
});

describe("parseHostMessage", () => {
	it("round-trips a valid message", () => {
		expect(parseHostMessage('{"t":"host-hello","v":1}')).toEqual({
			t: "host-hello",
			v: 1,
		});
	});

	it("returns null for invalid JSON rather than throwing", () => {
		expect(parseHostMessage("{nope")).toBeNull();
	});
});
