import { describe, expect, it } from "vitest";
import {
	BASELINE_Z,
	isInBounds,
	isInServiceBox,
	NET_HEIGHT_CENTRE,
	NET_HEIGHT_POST,
	NET_POST_X,
	netHeightAt,
	SERVICE_LINE_Z,
	SINGLES_HALF_WIDTH,
} from "./court.ts";

/** The four corners of one side's service boxes, in the plan's frame: `z = 0`
 * at the net, `+z` toward the near baseline. Derived here rather than exported
 * from `court.ts` — nothing in the sim consumes a corner list yet. */
function serviceBoxCorners(
	side: "near" | "far",
): readonly { x: number; z: number }[] {
	const sign = side === "near" ? 1 : -1;
	return [0, sign * SERVICE_LINE_Z].flatMap((z) =>
		[-SINGLES_HALF_WIDTH, 0, SINGLES_HALF_WIDTH].map((x) => ({ x, z })),
	);
}

describe("service boxes", () => {
	it("sit inside the singles court", () => {
		for (const side of ["near", "far"] as const) {
			for (const corner of serviceBoxCorners(side)) {
				expect(Math.abs(corner.x)).toBeLessThanOrEqual(SINGLES_HALF_WIDTH);
				expect(Math.abs(corner.z)).toBeLessThan(BASELINE_Z);
			}
		}
	});

	it("stay on their own side of the net", () => {
		for (const corner of serviceBoxCorners("near")) {
			expect(corner.z).toBeGreaterThanOrEqual(0);
		}
		for (const corner of serviceBoxCorners("far")) {
			expect(corner.z).toBeLessThanOrEqual(0);
		}
	});
});

describe("isInServiceBox", () => {
	it("accepts a bounce inside the far box for a serve from near", () => {
		expect(isInServiceBox(0, -3, "far")).toBe(true);
	});

	it("rejects a bounce beyond the service line, even inside the court", () => {
		expect(isInServiceBox(0, -SERVICE_LINE_Z - 1, "far")).toBe(false);
		expect(Math.abs(-SERVICE_LINE_Z - 1)).toBeLessThan(BASELINE_Z);
	});

	it("rejects a bounce on the wrong side of the net", () => {
		expect(isInServiceBox(0, 3, "far")).toBe(false);
	});

	it("rejects a bounce wide of the singles sideline", () => {
		expect(isInServiceBox(SINGLES_HALF_WIDTH + 0.5, -3, "far")).toBe(false);
	});

	it("mirrors for a serve from far, landing in the near box", () => {
		expect(isInServiceBox(0, 3, "near")).toBe(true);
		expect(isInServiceBox(0, -3, "near")).toBe(false);
	});
});

describe("isInBounds", () => {
	it("accepts a bounce inside the singles court", () => {
		expect(isInBounds(0, -10)).toBe(true);
	});

	it("rejects a bounce past the baseline", () => {
		expect(isInBounds(0, -BASELINE_Z - 0.5)).toBe(false);
	});

	it("rejects a bounce wide of the singles sideline", () => {
		expect(isInBounds(SINGLES_HALF_WIDTH + 0.5, -5)).toBe(false);
	});
});

describe("netHeightAt", () => {
	it("is 0.914 at the centre and 1.07 at the posts", () => {
		expect(netHeightAt(0)).toBeCloseTo(NET_HEIGHT_CENTRE, 10);
		expect(netHeightAt(NET_POST_X)).toBeCloseTo(NET_HEIGHT_POST, 10);
		expect(netHeightAt(-NET_POST_X)).toBeCloseTo(NET_HEIGHT_POST, 10);
	});

	it("rises, never falls, from the centre outward", () => {
		let previous = netHeightAt(0);
		for (let x = 0; x <= NET_POST_X + 1; x += 0.05) {
			const height = netHeightAt(x);
			expect(height).toBeGreaterThanOrEqual(previous);
			expect(height).toBeCloseTo(netHeightAt(-x), 10);
			previous = height;
		}
	});

	it("is strictly higher at the singles sideline than at the centre", () => {
		// A flat net would pass every assertion above but this one, and a ball
		// clipping the band out near the post is a real outcome.
		const sideline = netHeightAt(SINGLES_HALF_WIDTH);
		expect(sideline).toBeGreaterThan(NET_HEIGHT_CENTRE);
		expect(sideline).toBeLessThan(NET_HEIGHT_POST);
	});

	it("does not keep climbing past the post", () => {
		expect(netHeightAt(NET_POST_X + 5)).toBeCloseTo(NET_HEIGHT_POST, 10);
	});
});
