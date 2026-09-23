---
title: "Module: src/controller — the iPhone racket"
updated: 2026-09-24
tags: [module, controller, ios]
status: current
code:
  - `src/controller/main.ts`
  - `src/controller/session.ts`
  - `src/controller/session.test.ts`
  - `src/controller/wake-lock.ts`
  - `src/controller/motion.ts`
  - `src/controller/index.html`
  - `src/controller/controller.css`
  - `src/controller/icons.ts`
  - `src/controller/racket.ts`
  - `src/controller/view.ts`
  - `src/controller/view.test.ts`
  - `src/controller/record.ts`
  - `src/controller/record.html`
  - `scripts/trace-endpoint.ts`
---

# Module: `src/controller` — the iPhone racket

The phone half. **Built as of 2026-09-20** — [[architecture]]'s seam 1 is
closed: the phone opens a socket, streams swings, and survives iOS dropping
its connection. **Not yet seen running on a phone** — see "What is and is not
verified" below before trusting this page over your own hands.

## Files

| File | What it is | State |
| --- | --- | --- |
| `src/controller/main.ts` | The real entry point: gate → motion listener → stream → session | built, untested on hardware |
| `src/controller/session.ts` | Socket identity, resume, reconnect backoff | `backoffMs` tested; socket wiring untested by design (DOM/WebSocket wiring) |
| `src/controller/wake-lock.ts` | `keepAwake()` — screen wake lock with re-acquire on visibility | untested by design (browser API wiring, no logic to assert) |
| `src/controller/motion.ts` | `requestMotionPermission()` — the iOS permission gate | working, now used by both the controller and the recorder |
| `src/controller/index.html` | The controller page | built — permission gate + play screen + settings sheet; redesigned 2026-09-23 |
| `src/controller/controller.css` | Every controller style, including the platform rules (touch-action, safe areas) | — |
| `src/controller/icons.ts` | Phosphor glyphs; fills `[data-icon]` placeholders | no |
| `src/controller/view.ts` | `racketView`: what the racket says for each match state, from your own side | **yes**, `view.test.ts` |
| `src/controller/racket.ts` | The match screen: the racket drawn on a 2D canvas — strings, stencil, frame, ball, stamps | no (drawing) |
| `src/controller/record.html` | The trace recorder UI | working, dev tool, unchanged |
| `src/controller/record.ts` | The recorder: capture, countdown, live readout, save | working, dev tool; now imports `keepAwake` from `wake-lock.ts` instead of holding its own copy |

The controller no longer links to the recorder from its own page — `record.html`
is still reachable by typing the path, but there is no in-app link now that the
real controller exists to link to instead.

## What the controller actually does

`main.ts` wires five already-independent pieces together and contains no
logic of its own:

```
enable tap → requestMotionPermission()          motion.ts
                │ granted/unsupported
                ▼
           startPlaying()
                │
                ├─▶ keepAwake()                  wake-lock.ts
                ├─▶ createSession({onState,onSide})  session.ts
                │        │ onSide fires once "assigned" arrives
                │        ▼
                │   send {t:"ready", ready:true}
                │
                └─▶ window.addEventListener("devicemotion", onMotion)
                         │
                         ▼
                    toSample(t, event)            shared/swing/trace.ts
                         │
                         ▼
                    stream.push(sample)           shared/swing/stream.ts
                         │ Swing | null        (stream.level → the live glow)
                         ▼
                    showSwing(power)             the ring: last swing's power
                    session.send({t:"swing"})    ONLY while match.phase === "playing"
```

`{t:"ready"}` is sent from inside `onSide`, not right after `createSession`
returns — the socket is not open yet at that point and `Session.send`'s
`readyState === OPEN` guard would drop it silently. This was a bug caught
during the design session's own self-review before implementation started
(see `sessions/2026-09-20-1452-controller-design.md`), not discovered live.

## `session.ts` — identity outlives the socket

`playerId` lives in `sessionStorage`, not a variable, because
[[ios-safari-tab-suspension]] is emphatic that the socket dying mid-match is
normal, not exceptional. On every `open`, the stored id (if any) is replayed
as `{t:"hello", resume}`. On `close`, `backoffMs(attempt)` schedules a
reconnect: 500ms doubling to a flat 8s, so a phone that was in a pocket for
ten minutes still comes back promptly rather than after a delay that grew
while nobody was watching. `visibilitychange` reconnects immediately on
foregrounding rather than waiting for the relay's 15s ping to notice.

A `{t:"rejected", reason:"unknown-session"}` clears the stored id and lets the
next `hello` arrive fresh, rather than retrying a resume that can only fail
again — this is the one rejection reason that does **not** set the
reconnect loop's terminal `givenUp` flag.

## `stream.ts` is `shared/swing/`'s module, not this one

The streaming swing detector `createSwingStream` lives in
`src/shared/swing/stream.ts` and is documented in [[modules/shared-swing]] —
it is pure logic with no DOM dependency, tuned entirely against the recorded
fixtures, and this module only calls it. See that page and
[[0015-contact-model]] for why it now announces every rotation peak and leaves
the choosing to the host.

**The phone only sends swings while the match is `playing`.** The peak
detector fires on gestures too; in the lobby a gesture is not a shot.

## What actually works today: the recorder

`record.html` is reached by typing its path directly (`npm run certs` prints
only the controller's own URL now). It is a **dev tool** and is excluded from
the production build — Vite's dev `indexHtmlMiddleware` serves any `.html`
under the root, so it needs no `rollupOptions.input` entry.

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
  downstream belongs in `.then()`, not after an `await` of this — `main.ts`'s
  `enableButton` handler follows this exactly, same as `record.ts` always did.
- **A missing API is `"unsupported"`, not an error.** Desktop Safari, Chrome
  and Android fire `devicemotion` with no grant, and that is what keeps the
  page developable on a Mac.

**Denial is sticky per origin.** Recovering means Settings → Safari → Clear
History and Website Data, which no guest at a party will do. So the prompt
must be explained *before* the tap that triggers it and never fired
speculatively on page load — `main.ts`'s gate section does this.

One page-level constraint encoded in both HTML files: a racket swing must
never scroll, rubber-band or pinch-zoom the page — `user-scalable=no`,
`touch-action: none`, `overscroll-behavior: none`, `viewport-fit=cover`.

## The match screen: the phone is the string bed (2026-09-24)

[[0020-the-phone-is-the-string-bed]]. The match screen is one canvas
(`racket.ts`) drawing a racket head that fills the screen, with everything the
phone says stencilled onto the strings. `main.ts` wires it and decides
nothing about how it looks:

```
session.onMatch ──▶ match ─┐
session.onSide  ──▶ mySide ├─▶ racketView() (view.ts, pure) ──▶ racket.show()
connection state ──────────┘        once a frame, in drawLevel; re-inks only on change

stream.level / stream.current ──▶ racket.level()     frame glow, strings bow
stream.push → Swing ──▶ showSwing ──▶ racket.swing()  frame charges; ball tossed
session.onFeedback ──▶ flash()  ──▶ racket.hit/point/miss  + colour wash + haptic
devicemotion gravity ──▶ racket.tilt()                stencil parallax
```

What the phone knows about the match comes from the host's `match` message:
the phase, and since 2026-09-24 **`score`** (`MatchScore` — games, points, who
serves, and the ball in hand / tossed / in play). That is what lets the racket
say SERVE with a ball on the strings, HIT once it is up, RETURN when they
serve, and the score from your own side. Still presentation of a relayed fact:
the phone decides nothing from it ([[0002-host-authoritative-simulation]]).

**The toss is started by the phone's own swing**, not by the host's reply:
with the ball in hand, the swing the phone just read is the toss, so the ball
leaves the strings immediately, back-dated by the detector's `lag`, and flies
on `TOSS_APEX`. The host's `ball: "toss"` is the fallback.

Kept from before, unchanged: one swing arrives as several peaks, so the
strongest in 400ms is the one shown (and the one the host plays); swings are
sent only while `playing`; the flash wash and the iOS 18 switch-label haptic
(**iOS Safari has no `navigator.vibrate`**; the haptic trick is still
unverified on a phone). The stroke readout (a setting) now reads along the
throat.

**Why the strings are opaque:** a stencil drawn `source-atop` onto
58%-transparent strings landed — 5,767 yellow pixels measured on the layer —
and was invisible, olive on grey. Opaque grey strings, full-strength ink, and
a denser weave (20 × 27) so a letter is crossed by a dozen strings. Captions
and game pips are printed over the strings, not stencilled: at caption size a
letter is crossed by two strings.

## The gate (redesigned 2026-09-23, unchanged since)

An animated swing (a phone on an arm meeting a ball at the top of its arc),
"This phone is your racket.", four swipeable how-to cards that turn over on
their own until touched, and one button. The permission rules above are
untouched: the button's handler is byte-for-byte the same. **The cards needed
a `touch-action` change** — [[touch-action-is-an-intersection]]. Settings
(gear, bottom corner beside the throat): screen flash, haptic tick, stroke
readout, kept in `localStorage` through `shared/prefs.ts`.

Seen in headless Chrome at 390x844, driven by a fake host over the real relay
(every phase and feedback kind) and by synthetic `devicemotion` through the
real detector. Not on a phone.

## What is and is not verified

Everything above is verified by tests (`session.test.ts`'s `backoffMs`,
`stream.test.ts` in `shared/swing/`) and a typechecker, and by `npm run build`
actually emitting `dist/controller/index.html` wired to a bundled script.

**Seen running 2026-09-20, in headless Chrome only:** the page loads with no
console errors, the permission gate's button takes it through to the play
screen (`requestMotionPermission` returns `"unsupported"` there, which is the
path a non-iOS browser takes), it opens a socket, is assigned a side, sends
`ready`, and renders "Far side / Ready / Waiting for the host."

**No session has opened this page on a phone.** Specifically unverified:

- Whether `main.ts`'s wiring actually works against a real `devicemotion`
  stream and a real WebSocket round trip — everything below `main.ts` is
  tested in isolation, but the integration itself has not run.
- Whether the wake lock actually keeps the screen on through a real match on
  real hardware — `record.ts` proved the underlying API works for a 30s
  capture; a whole match is a longer, unverified claim.
- Whether reconnect-after-suspension actually resumes a session on a real
  iPhone, versus only against the backoff-formula unit test.

- Whether `Swing.spin`'s `beta` axis actually tracks rolling the wrist over
  the ball — [[2026-09-20-spin-from-wrist-roll]] is explicit that no
  committed fixture can confirm it.

Closing this gap needs a phone in hand: `npm start`, scan the QR code on the
host's lobby screen, tap Enable, swing. Not done in this session — [[0009-streaming-swing-detection]]'s
"What would overturn this" also still needs six single-swing fixtures
recorded with rally-like spacing, which the same phone session should collect.

## A dev-loop trap worth knowing before you hold a phone

`vite.config.ts` imports `scripts/trace-endpoint.ts`, which imports
`src/shared/swing/trace.ts`. Vite restarts the dev server when any config
dependency changes — so **editing shared code mid-session restarts the server,
reloads the phone, costs the Enable tap again, and discards in-progress
state.** Do not edit `src/shared/` with a phone in your hand.

## Reference device

Everything iOS-side in this vault was verified on an **iPhone 14 Pro running
iOS 26.6.1**. Sample rate and gravity handling differ between devices and
releases, so record provenance with any new traces.

## See also

[[architecture]] · [[modules/shared-swing]] · [[0015-contact-model]] · [[0009-streaming-swing-detection]] ·
[[ios-motion-permission]] · [[ios-safari-tab-suspension]] ·
[[0004-lan-https-via-local-ip-co]] · [[2026-09-19-ios-devicemotion-sampling]]
