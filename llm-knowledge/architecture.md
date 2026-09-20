---
title: How SwingCourt fits together
updated: 2026-09-20
tags: [map, architecture, core]
status: current
code:
  - `src/shared/protocol.ts`
  - `src/host/main.ts`
  - `src/server/relay.ts`
  - `scripts/relay-plugin.ts`
  - `vite.config.ts`
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
| Mac, Node | Dev server: serves both pages **and** hosts the WebSocket relay | `src/server/`, `scripts/relay-plugin.ts` |
| Mac, browser | Host display: runs the authoritative simulation, renders it | `src/host/` |
| iPhone, Safari | Controller: the racket | `src/controller/` |

Both browsers talk to one Node process over **one port** (5173, from
`package.json`'s `config.port`). The relay is attached to Vite's own
`httpServer` by a plugin rather than run as a second process, so the page and
its socket share an origin and there is no CORS story, no second port in the
QR code, and no separate dev command. See [[modules/tooling]].

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
 detectSwings()          ①
   │  Swing{kind,power,at}
   ▼
 ws.send {t:"swing"}     ②  ──▶  parseControllerMessage
                                 attach playerId from socket
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
                                          │  applySwing
                                          │    → timingErrorFor
                                          │    → resolveShot  → ball.v
                                          │  stepBall         → net?/bounce?
                                          │  resolveStep      → point?
                                          │  movePlayers
                                          ▼
                                        MatchState (new object)
                                          │
                                          ├─▶ detectEvents(before, after)
                                          │     → RenderEvent[]
                                          ▼
                                        render(previous, current, alpha, …)
                                              │
 buzz  ◀──  {t:"feedback"}  ◀──  route to playerId  ◀──  send feedback ④
```

① ② **Not built.** See "The two open seams" below.
③ The swing is stamped with the **host's** sim clock, never the phone's
`swing.at` — [[0007-host-arrival-time-for-swing-timing]].
④ `hit`/`miss` per swing, `point` to both phones on a score change.

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

## The two open seams

**As of 2026-09-20 the game cannot be played**, and it is worth being precise
about why, because every individual subsystem is finished and tested. The host
is wired end to end. Both ends of the pipe are not.

**Seam 1 — the controller is a placeholder.** `src/controller/index.html` says
"Controller. Not built yet." and links to the trace recorder. There is no
controller entry module, so the phone never opens a socket, never sends
`hello`, and never sends a swing. `src/controller/motion.ts` — the iOS
permission gate, the hard part — exists and works, but its only caller is
`src/controller/record.ts`, the recorder.

Consequence worth stating plainly: **`detectSwings` has no production
caller.** The detector is complete and tuned against 20 real traces
([[2026-09-19-swing-detector-tuning]]) and nothing in the running system calls
it. `grep -rn detectSwings src` finds its definition and its test.

**Seam 2 — there is no production server.** `src/server/` has the relay and
the lobby, both tested, but no entry point that runs them. The relay reaches a
socket only through the dev-time Vite plugin. `npm run build` emits two static
pages under `dist/` with nothing to serve them and no relay behind them. This
was a deliberate deferral, not an oversight — no decision exists yet for how
production static serving works, and there was nothing real in `dist/` to
serve when the relay was written.

Closing either seam is the next real work. Neither has an ADR yet, because
neither has been designed.

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
