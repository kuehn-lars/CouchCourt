import { describe, expect, it } from "vitest";
import { lanUrlLines, localIpHostname } from "./lan-urls.ts";

describe("localIpHostname", () => {
	it("is the local-ip.co name that resolves to the address", () => {
		expect(localIpHostname("192.168.1.42")).toBe("192-168-1-42.my.local-ip.co");
	});
});

describe("lanUrlLines", () => {
	it("turns Vite's network URL into the host and controller URLs the certificate covers", () => {
		expect(lanUrlLines(["https://192.168.1.42:5173/"])).toEqual([
			"  ➜  Host:       https://192-168-1-42.my.local-ip.co:5173/host/",
			"  ➜  Controller: https://192-168-1-42.my.local-ip.co:5173/controller/",
		]);
	});

	// A laptop on Wi-Fi and Ethernet, or with a VPN up, has several. Vite
	// prints them all, and so does this: only the user knows which network
	// the phones are on.
	it("prints every network address", () => {
		expect(
			lanUrlLines(["https://192.168.1.42:5173/", "https://10.0.0.7:5173/"]),
		).toHaveLength(4);
	});

	// Over plain HTTP the certificate is not in play and a local-ip.co name
	// would be no better than the IP: there is nothing to print.
	it("prints nothing for an HTTP server", () => {
		expect(lanUrlLines(["http://192.168.1.42:5173/"])).toEqual([]);
	});

	it("skips an address that is not IPv4", () => {
		expect(lanUrlLines(["https://[fe80::1]:5173/"])).toEqual([]);
	});
});
