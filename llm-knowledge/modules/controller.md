---
title: "Module: src/controller — the iPhone racket"
updated: 2026-09-20
tags: [module, controller, ios]
status: current
code:
  - `src/controller/motion.ts`
  - `src/controller/index.html`
  - `src/controller/record.ts`
  - `src/controller/record.html`
  - `scripts/trace-endpoint.ts`
---

# Module: `src/controller` — the iPhone racket

The phone half. **Mostly not built** — and what exists is the hard part, so
read this before assuming the folder is empty.

## Files

| File | What it is | State |
| --- | --- | --- |
| `src/controller/motion.ts` | `requestMotionPermission()` — the iOS permission gate | working, used only by the recorder |
| `src/controller/index.html` | The controller page | **placeholder** — "Controller. Not built yet." |
| `src/controller/record.html` | The trace recorder UI | working, dev tool |
| `src/controller/record.ts` | The recorder: capture, countdown, live readout, save | working, dev tool |

There is no controller entry module. The phone never opens a WebSocket, never
sends `hello`, and never sends a swing — [[architecture]]'s seam 1.

## What actually works today: the recorder

`record.html` is reached by tapping through from `index.html`, because
`npm run certs` prints only that one URL and a LAN hostname is miserable to
type on a phone. It is a **dev tool** and is excluded from the production
build — Vite's dev `indexHtmlMiddleware` serves any `.html` under the root, so
it needs no `rollupOptions.input` entry, and adding one would only ship a dead
Save button.

Flow: permission gate → pick a label → pick Short (6s) or Long (30s) →
**five-second countdown** → capture → POST to the dev-only endpoint
(`scripts/trace-endpoint.ts`), which validates with `isTrace` and writes the
next free filename into `tests/fixtures/motion/`.

The countdown is not decoration. A Record/Stop button cannot be found with the
phone in a racket grip, and a manual stop puts your own thumb impulse into the
last 300ms of every swing trace.

## The permission gate is the whole platform problem

Two independent gates, both mandatory since iOS 13, and **missing either
produces silence rather than an error** — which is what makes it expensive.

1. **Secure context.** `devicemotion` does not fire at all over plain HTTP. No
   exception, no warning, no prompt. `localhost` is secure but does not help:
   the phone is not the host. This single fact is why
   [[0004-lan-https-via-local-ip-co]] exists.
2. **Permission, from inside a real tap.** See [[ios-motion-permission]] for
   the full list of ways this goes wrong.

Three rules `motion.ts` encodes, each of which traces to a rejected
alternative:

- **`request.call(DeviceMotionEvent)`, never `request()`.** It is a static
  method and WebKit checks the receiver; modules are strict mode, so an
  extracted reference invoked bare passes `undefined` and throws. On a Mac the
  feature detect returns first, so **the mistake is invisible until you are
  standing in the living room holding the phone.** Do not "simplify" it.
- **No `await` before the call in that same function.** An `await` on anything
  else first loses the user gesture and the call rejects. Everything
  downstream belongs in `.then()`, not after an `await` of this.
- **A missing API is `"unsupported"`, not an error.** Desktop Safari, Chrome
  and Android fire `devicemotion` with no grant, and that is what keeps the
  page developable on a Mac.

**Denial is sticky per origin.** Recovering means Settings → Safari → Clear
History and Website Data, which no guest at a party will do. So the prompt
must be explained *before* the tap that triggers it and never fired
speculatively on page load. That makes the permission gate a real UI state,
not a formality — which is a constraint on whoever builds the real controller.

## When the real controller is built

Everything it needs already exists. The shape it has to take:

- `devicemotion` listener → `toSample` → a rolling buffer → `detectSwings`
  (`src/shared/swing/detector.ts`, currently with no caller) → `{t:"swing"}`.
- `hello` with `PROTOCOL_VERSION`; store the returned `playerId` in
  `sessionStorage` and resend it as `{t:"hello", resume: playerId}` on
  reconnect. **Session identity must outlive the socket** — iOS dropping the
  connection is normal behaviour, not an edge case
  ([[ios-safari-tab-suspension]]).
- `visibilitychange` is the early warning that backgrounding is coming; it is
  nicer for the host to be told than to discover it from a timeout.
- `feedback` messages arrive for haptics. They are not authoritative.
- The `aim` stream is in the protocol and **no v1 code reads it**
  ([[0008-timing-not-aim-for-shot-direction]]). Sending it is optional;
  wiring it into gameplay is a decision nobody has made.

One page-level constraint already encoded in both HTML files: a racket swing
must never scroll, rubber-band or pinch-zoom the page —
`user-scalable=no`, `touch-action: none`, `overscroll-behavior: none`,
`viewport-fit=cover`.

## A dev-loop trap worth knowing before you hold a phone

`vite.config.ts` imports `scripts/trace-endpoint.ts`, which imports
`src/shared/swing/trace.ts`. Vite restarts the dev server when any config
dependency changes — so **editing shared code mid-session restarts the server,
reloads the phone, costs the Enable tap again, and discards the in-memory
capture.** Do not edit `src/shared/` with a phone in your hand.

## Reference device

Everything iOS-side in this vault was verified on an **iPhone 14 Pro running
iOS 26.6.1**. Sample rate and gravity handling differ between devices and
releases, so record provenance with any new traces.

## See also

[[architecture]] · [[modules/shared-swing]] · [[ios-motion-permission]] ·
[[ios-safari-tab-suspension]] · [[0004-lan-https-via-local-ip-co]] ·
[[2026-09-19-ios-devicemotion-sampling]]
