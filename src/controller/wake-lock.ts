/**
 * Keeps the screen awake while the phone is being used as a racket.
 *
 * Not a nicety: iOS auto-locks after 30s-2min without a touch, a player
 * swinging the phone touches nothing, and a locked phone stops delivering
 * `devicemotion` entirely. Wake locks are also released whenever the page is
 * backgrounded and do not come back on their own, so re-acquiring on
 * `visibilitychange` is part of the contract rather than an optimisation.
 *
 * Extracted from `record.ts`, which learned all of the above first.
 */

export type WakeLockState =
	| "idle"
	| "active"
	| "released"
	| "unsupported"
	| "error";

export interface WakeLockHandle {
	state(): WakeLockState;
	release(): void;
}

export function keepAwake(onChange?: () => void): WakeLockHandle {
	let state: WakeLockState = "idle";
	let sentinel: WakeLockSentinel | null = null;
	let wanted = true;

	const set = (next: WakeLockState): void => {
		state = next;
		onChange?.();
	};

	const acquire = async (): Promise<void> => {
		if (!("wakeLock" in navigator)) {
			set("unsupported");
			return;
		}
		try {
			sentinel = await navigator.wakeLock.request("screen");
			sentinel.addEventListener("release", () => set("released"));
			set("active");
		} catch {
			set("error");
		}
	};

	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "visible" && wanted && sentinel === null) {
			void acquire();
		}
	});

	void acquire();

	return {
		state: () => state,
		release: () => {
			wanted = false;
			const held = sentinel;
			sentinel = null;
			if (held !== null) void held.release();
		},
	};
}
