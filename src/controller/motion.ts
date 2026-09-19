/**
 * iOS motion permission gate. See
 * `llm-knowledge/platform/ios-motion-permission.md` before touching this —
 * every rule below traces back to a rejected alternative documented there.
 */

export type MotionPermission = "granted" | "denied" | "unsupported" | "error";

/**
 * Must be called directly from a tap handler, with no `await` before it in
 * that same function — an `await` on anything else first loses the user
 * gesture and `requestPermission()` rejects. Everything that depends on the
 * result belongs in `.then()`/`.catch()`, not after an `await` of this call.
 */
export function requestMotionPermission(): Promise<MotionPermission> {
	// `requestPermission` is iOS Safari-only and isn't in lib.dom.d.ts (the
	// only `requestPermission` there belongs to `Notification`), so it's
	// reached through an `unknown` cast rather than `any` or `declare global`.
	const request = (
		DeviceMotionEvent as unknown as {
			requestPermission?: () => Promise<string>;
		}
	).requestPermission;

	// Missing API is NOT a failure: desktop Safari/Chrome and Android fire
	// `devicemotion` without any grant, so this keeps the page developable on
	// a Mac. Do not "fix" this into an error.
	if (typeof request !== "function") {
		return Promise.resolve("unsupported");
	}

	// No prior `await` above this line — the call must land in the tap's own
	// task or iOS rejects it.
	//
	// `.call(DeviceMotionEvent)` is not decoration. `requestPermission` is a
	// static method and WebKit checks its receiver; invoking the extracted
	// reference bare gives it `undefined` (modules are strict mode) and it
	// throws TypeError. That surfaces here as "error" on a real iPhone and as
	// nothing at all on a Mac, where the feature detect returns early instead.
	return request
		.call(DeviceMotionEvent)
		.then(
			(state): MotionPermission => (state === "granted" ? "granted" : "denied"),
		)
		.catch((): MotionPermission => "error");
}
