---
title: How SwingCourt fits together
updated: 2026-09-22
tags: [map, architecture, core]
status: current
code:
  - `src/shared/protocol.ts`
  - `src/host/main.ts`
  - `src/server/relay.ts`
  - `scripts/relay-plugin.ts`
  - `vite.config.ts`
  - `package.json`
---

# How SwingCourt fits together

**The second page to read, after [[index]].** It is the only note that
describes the system as a whole; everything else in the vault describes one
piece of it or one reason behind it.

If you are about to change something and do not know what it touches, the
answer is here or in the [[index]]'s module row for it.

## Three participants, one port

| Runs where | What it is | Lives in |
| --- | --- | --- |
| Mac, Node | Vite: serves the pages **and** hosts the WebSocket relay. `npm run dev` in development, `npm start` (`vite build && vite preview`) in production — same plugin, same port, same certificates | `src/server/`, `scripts/relay-plugin.ts` |
| Mac, browser | Host display: runs the authoritative simulation, renders it | `src/host/` |
| iPhone, Safari | Controller: the racket | `src/controller/` |

Both browsers talk to one Node process over **one port** (5173, from
`package.json`'s `config.port`). The relay is attached to Vite's own
`httpServer` by a plugin rather than run as a second process, so the page and
its socket share an origin and there is no CORS story, no second port in the
QR code, and no separate dev command. See [[modules/tooling]].

Under TLS that `httpServer` is an **`Http2SecureServer`**, not an
`https.Server` — in dev and preview alike, with no config asking for it. The
relay has always been attached to one. [[vite-https-is-http2]].

The server holds **player slots and nothing else**. There is no game state on
it, nothing persists across a restart, and there is no database — see
[[0002-host-authoritative-simulation]].

## The swing, end to end

This is the path that matters. Everything else in the codebase supports it.

```
 iPhone Safari                    Node relay                  Mac browser
 ─────────────                    ──────────                  ───────────
 devicemotion 60Hz
   │  MotionSample[]
   ▼
 createSwingStream()     ①  every rotation PEAK, ~50ms after it
   │  Swing{power,at,spin,lag}   (kind sent, ignored)
   ▼
 ws.send {t:"swing"}     ②  ──▶  parseControllerMessage
   (only while playing)          attach playerId from socket
                                 forward to host       ──▶  onmessage
                                                              │
                                                              ▼
                                                       queue RallyInput
                                                       {side, swing,
                                                        time: current.time}  ③
                                                              │
                                              ┌───────────────┘
                                              ▼
                                        frame() → advance()
                                          │ N fixed 1/120s ticks
                                          ▼
                                        tick(state, inputs, dt)
                                          │  applySwing at swing time = arrival − lag ⑤
                                          │    waiting-serve → toss, then hit the toss
                                          │    vs the FROZEN contact ⑥:
                                          │      early → arm, strike at contact
                                          │      late  → strike from contact, rewind
                                          │      hardest peak in the window wins
                                          │  fireArmed · advanceBall · planContact
                                          │  movePlayers (REACTION, stance, recovery)
                                          ▼
                                        MatchState (new object)
                                          │
                                          ├─▶ detectEvents(before, after)
                                          │     hit (from contact) · whiff · toss …
                                          ▼
                                        render(previous, current, alpha, …)
                                              │
 flash/toast ◀── {t:"feedback"} ◀── route to playerId ◀── hit / point / miss ④
```

① **Rebuilt 2026-09-22**: announces each rotation lobe at its peak, and lets
the host pick which peak was the swing. Unverified on a phone.
② Swings are only sent while the match is `playing`.
③ The swing is stamped with the **host's** sim clock, never the phone's
`swing.at` — [[0007-host-arrival-time-for-swing-timing]].
④ `hit` to whoever struck a new stroke; on a point, `point` to the winner and
`miss` to the loser. Read off state, not off the input.
⑤ `swing.lag` is a duration inside the phone's own clock
([[0013-detector-latency-is-compensated]]).
⑥ **The contact is the hinge of the whole diagram.** `predictStrike` plans it;
`rally.ts` freezes it once the ball bounces on the receiver's side, and every
swing is judged against that one frozen meeting — which may be in the past.
Re-predicting at arrival instead is what made every return whiff until
2026-09-22. [[0015-contact-model]].

**Where the ball goes** is timing, the Wii rule: early pulls it across the
body, late pushes it the other way, the edge of the window sprays it out.
Forehand or backhand is chosen from where the ball is. Every launch is solved
through `stepBall` to land where it was aimed. [[0015-contact-model]].

## What each hop is allowed to assume

**The phone sends intent, not signal.** Detection runs on the device, so the
wire carries a handful of `Swing` events per rally plus a ~20Hz `aim` stream —
never a 60Hz sensor firehose. Three consequences fall out of that one choice
(bandwidth, a sim with no filtering code in it, a detector tunable offline);
they are written up in [[wire-protocol]].

**The server attaches identity.** A controller's `swing` carries no
`playerId`; the relay adds it from the socket the message arrived on. A client
that names its own id is a client that can name someone else's.

**The host trusts the relay, and only the relay.** `isControllerMessage` and
`isHostMessage` guard the two directions arriving *at the server*, because a
phone's software is arbitrary. `src/host/main.ts` parses `HostBoundMessage`
with a plain cast — there is no third untrusted party on that edge. This reads
like a missing guard and is not; [[wire-protocol]] records why.

**Nothing sends game state anywhere.** The host renders what it simulates.

## Where state lives

| State | Owner | Survives |
| --- | --- | --- |
| Player slots, `playerId`, ready flags | `src/server/lobby.ts` | the socket, not the process |
| Which socket is which player / the host | `src/server/relay.ts` | nothing |
| Match state — ball, players, score, phase | `src/host/main.ts`'s `current` | nothing |
| Session identity on the phone | `sessionStorage` (planned) | a tab suspend |
| Recorded motion traces | `tests/fixtures/motion/` | committed |

`MatchState` is replaced, never mutated — `tick` returns a new object every
time. Two things depend on that and will break silently if it changes: the
renderer interpolates between `previous` and `current`, and both `main.ts` and
`detectEvents` use `before.score !== current.score` reference inequality to
mean "the score just changed".

## The fixed timestep, and why it is everywhere

The sim runs at **exactly 1/120s per tick**, decoupled from the display's
frame rate by `advance()` in `src/host/loop.ts`. A frame runs however many
whole ticks have accumulated, and hands the renderer `alpha`, the leftover
fraction, to interpolate with.

Three separate things depend on the step being fixed:

- **Determinism.** `tick` reads no clock and no RNG, so the same input script
  replays to the same final score — the regression net under every tuning
  change (`rally.test.ts`, "a full set, replayed").
- **Smoothness.** Rendering a fixed-step sim without interpolating by `alpha`
  is what makes it judder, whatever the materials look like.
- **Tunnelling.** At 120Hz a 30 m/s ball still moves 25cm per tick, which is
  why `stepBall` tests the *segment* against the net and floor planes rather
  than the tick's endpoint. Dropping to 60Hz doubles that distance.

`MAX_CATCHUP_TICKS = 5` caps the backlog, because a tab restored from
suspension ([[ios-safari-tab-suspension]]) would otherwise try to simulate
several real seconds inside one frame and spiral.

## The purity boundary

`src/shared/` is compiled by **both** `tsconfig.web.json` (DOM, no
`@types/node`) and `tsconfig.node.json` (`@types/node`, no DOM). Code there
touching `document` fails one; touching `process` fails the other. That is the
whole enforcement mechanism — no lint plugin, no convention.

```
src/shared/   ←── imported by host, server and controller. Imports none of them.
   protocol.ts   the wire contract          → modules/shared-protocol
   swing/        traces + swing detection   → modules/shared-swing
   sim/          the game                   → modules/shared-sim
```

The rule that keeps it working, and that has already been broken once:
**both production tsconfigs must exclude every `*.test.ts`**, because importing
`vitest` pulls `@types/node` in transitively and silently re-grants `process`
to the web project. Tests are typechecked by a third project that enforces
nothing. Full account in [[0002-host-authoritative-simulation]].

## Both seams are closed

**As of 2026-09-20 both are closed.** What is left is not wiring, it is
hardware verification — see "What has not been seen" below.

**Seam 1 — closed, unverified on hardware.** `src/controller/main.ts` is the
real entry point: permission gate → `devicemotion` → `toSample` →
`createSwingStream` → `session.send`. The phone opens a socket, sends
`hello` (with `sessionStorage`-backed resume), and streams swings via
[[0009-streaming-swing-detection]]'s live detector rather than a batched
`detectSwings` call. See [[modules/controller]] for what was built and, just
as importantly, what was **not** verified — no session has opened this page
on a phone yet. `detectSwings` (the batch detector) itself still has no
production caller by design; the streaming detector shares its classification
code instead. See [[modules/shared-swing]].

**Seam 2 — closed.** `npm start` is `vite build && vite preview`, and
`relayPlugin` attaches to the preview server as well as the dev one. There is
no hand-written Node server, because Vite already does static serving and TLS
correctly and the alternative was eighty lines of MIME tables and traversal
guards. [[0010-vite-preview-as-production-server]].

Verified live: `/`, `/host/` and `/controller/` all serve over TLS on the LAN
address, and a `wss://` client gets `assigned` back from the relay.

## The match, end to end

The swing path above is one tick of something larger. The host owns the whole
match:

```
lobby ──(Start / Play the machine)──▶ countdown ──(3s)──▶ playing
  ▲                                                          │
  └──────────────(Back to the lobby)──── over ◀──(setWinner)──┘
```

Every transition is `{ t: "match", phase, server, winner? }` from the host,
broadcast by the relay to every phone. The relay stores none of it. In the
other direction the host is sent `{ t: "lobby", players }` — a **snapshot**,
because a host that reloads cannot rebuild a roster from deltas it was not
connected for.

**Who serves first** is decided in the lobby: the first player to announce
themselves ready. That closes a gap this page carried from the beginning.

**Solo mode** puts `createBot` ([[modules/shared-sim]]) on the empty side.
It is an input source, not a simulation feature: the host calls it once per
tick and queues its swing exactly where a phone's swing goes.

## What has not been seen

The **whole match loop** has now been seen running in headless Chrome —
lobby, countdown, a solo match played through to a completed set, the winner
screen, rematch, and back to the lobby — plus pause-on-disconnect and the
controller's join flow, with no console errors on either page. The first time
anything here has been watched rather than inferred.

Watched again on 2026-09-21 after the direction, movement and animation work:
lobby, countdown, a game played out with the scoreboard ticking through
0 all / 15 / 30 / 40 / Game, players running to the ball, no console errors.
Four bugs came out of that run and **none of them were in the game** — the
relay dying on a malformed frame, the relay dropping a field on the wire, the
relay killing Vite's HMR socket, and a camera framing a range players had
outgrown.

Watched again on 2026-09-22 after the contact-model rewrite: a scripted phone
over the real relay, swinging blind every 280ms against the solo bot, got 11
hits, 2 points won and 2 lost in 20s, with no console errors on the host. The
new controller page was screenshotted at phone size.

A real phone, a real swing and a real frame rate have not. Headless Chrome
renders through SwiftShader and has no motion sensors, so it says nothing
about 60fps on a MacBook GPU and nothing at all about feel, which is the bar
`PRODUCT.md` sets. Nor has the direction classifier been measured against a
single swing recorded at rally spacing — every committed trace is a
multi-rep capture. [[2026-09-21-swing-direction-classifier]].

## What is deliberately not here

Carried forward from the simulation plan's "not being built" list, still
binding:

- No physics engine dependency — three planes and a sphere is about forty
  lines, and a new dependency needs a decision note per `CLAUDE.md` §7.
- No ECS, no renderer abstraction, no interface with one implementation.
- No spin vector and no Magnus force. Topspin is one gravity multiplier
  (`BallEnv.gravityScale`).
- No doubles hooks, no best-of-three, no manual player movement.
- No anti-cheat. The host page is trusted; everyone is in the same room.
- No time synchronisation between phone and host. See
  [[0007-host-arrival-time-for-swing-timing]].

`PRODUCT.md`'s "Explicitly out of scope for v1" is binding and this list
extends it with the engineering equivalents.

## Reading order for a new session

1. [[index]] — the router.
2. This page.
3. The [[index]] module row for whatever you are about to touch.
4. The decision and platform notes that row links to.
