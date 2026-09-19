---
title: iOS motion sensors need HTTPS and a tap
updated: 2026-09-19
tags: [platform, ios, safari, motion]
status: current
code:
  - `src/controller/index.html`
  - `src/shared/swing/`
---

# iOS motion sensors need HTTPS *and* a tap

Two independent gates, both mandatory since iOS 13. Missing either produces
silence rather than an error, which is what makes this expensive to debug.

## Gate 1 — secure context

`devicemotion` and `deviceorientation` events do not fire at all over plain
HTTP. No exception, no console warning, no permission prompt. The listener
simply never runs.

`localhost` is a secure context, but that does not help: the phone is not the
host. This is the entire reason [[0004-lan-https-via-local-ip-co]] exists.

## Gate 2 — permission, from inside a user gesture

```js
// MUST be called from a real tap handler. Calling it on page load
// rejects, and it cannot be retried without another gesture.
const state = await DeviceMotionEvent.requestPermission();
if (state === "granted") {
  window.addEventListener("devicemotion", onMotion);
}
```

Things that catch people out:

- `DeviceMotionEvent.requestPermission` **does not exist** on non-Safari
  browsers and older iOS. Feature-detect with
  `typeof DeviceMotionEvent.requestPermission === "function"` before calling,
  or desktop Chrome throws on the host page.
- The call must be inside the gesture's own task. An `await` on something else
  *before* it loses the gesture and the call rejects.
- `deviceorientation` has its own separate `DeviceOrientationEvent.requestPermission()`.
  Granting one does not grant the other.
- Denial is sticky per origin. Recovering means Settings > Safari > Clear
  History and Website Data — not something a guest at a party will do. So the
  permission prompt must be clearly explained *before* the tap that triggers it,
  and never fired speculatively on page load.

## Consequence for the architecture

The controller's permission gate is a real UI state, not a formality: an
explanatory screen with one button. `src/controller/index.html` is the entry
point for it.

Because the API is a browser-only global, the detector in `src/shared/swing`
must not call it — the detector is a pure function over a sample stream, and the
listener that feeds it lives in `src/controller`. See
[[0002-host-authoritative-simulation]].
