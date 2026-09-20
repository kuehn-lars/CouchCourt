---
title: "Module: src/shared/protocol.ts — the wire contract"
updated: 2026-09-20
tags: [module, protocol, networking]
status: current
code:
  - `src/shared/protocol.ts`
  - `src/shared/protocol.test.ts`
---

# Module: `src/shared/protocol.ts` — the wire contract

One file, imported by all four of the other folders. It is the only thing
every part of the system agrees on, which is why it lives in `src/shared/` and
why a change here is a change everywhere.

`src/shared/protocol.ts` is the source of truth for the *shapes*.
[[wire-protocol]] is the source of truth for **why they are shaped that way** —
read it before changing a message.

## What it exports

| Kind | Names |
| --- | --- |
| Version | `PROTOCOL_VERSION` — bump on any breaking change |
| Identity | `PlayerId`, `Side` (`near`/`far`), `LobbyPlayer` |
| Payloads | `Aim`, `Swing`, `SwingKind`, `FeedbackKind` |
| Message unions | `ControllerMessage`, `ControllerBoundMessage`, `HostMessage`, `HostBoundMessage` |
| Guards | `isControllerMessage`, `isHostMessage` |
| Parsers | `parseControllerMessage`, `parseHostMessage` |

## The four unions, and who reads which

```
ControllerMessage       phone  ──▶ server   hello · ready · aim · swing
ControllerBoundMessage  server ──▶ phone    assigned · rejected · lobby · feedback
HostMessage             host   ──▶ server   host-hello · feedback
HostBoundMessage        server ──▶ host     player-joined · player-left ·
                                            player-ready · aim · swing
```

Four unions rather than two so that a message the host should never receive
cannot typecheck its way into a controller handler.

The server **translates** rather than forwards: a phone sends
`{t:"swing", kind, power, at}` with no identity, and the host receives
`{t:"swing", playerId, swing}`. Identity comes from the socket.

## Who imports it

Everything. `src/shared/swing/` (for `Swing`, `SwingKind`),
`src/shared/sim/` (for `Side`, `Swing`), `src/server/lobby.ts` and
`src/server/relay.ts`, `src/host/main.ts`, `src/host/render/`. It imports
nothing itself.

That makes it the highest-blast-radius file in the repo. `PROTOCOL_VERSION`
exists because of it: phones cache aggressively, so a guest can easily run
last week's controller against today's host, and a mismatch is rejected
loudly rather than debugged as a desync.

## The guards are the trust boundary

`isControllerMessage` and `isHostMessage` are real runtime checks, not casts.
They reject `NaN` and `Infinity` explicitly — those survive an in-process send
intact, sail through a naive `typeof x === "number"`, and then poison the
simulation silently several frames later.

Both inbound directions are guarded on purpose, including the host's. The host
page is served by us but still reaches the server over a socket anyone on the
LAN can open. Shipping a validator for one direction and not the other is how
an unvalidated boundary quietly becomes permanent: whoever writes the server
next copies the pattern they find.

The one place with **no** guard is `src/host/main.ts`, which parses
`HostBoundMessage` with a plain cast. That is deliberate and it reads like an
oversight, so [[wire-protocol]] records the reasoning.

## Fields with a trap in them

- **`Swing.at` is the phone's own `performance.now()`.** It is valid for
  ordering and dedupe *within one device's stream* and meaningless across
  devices — there is no clock synchronisation anywhere in this protocol. The
  simulation times swings by host arrival instead:
  [[0007-host-arrival-time-for-swing-timing]].
- **The `aim` stream is carried and never read.** `Aim` and the ~20Hz `aim`
  message exist in the protocol and the relay forwards them to the host, where
  **no v1 code consumes them**. Shot direction comes from timing's sign
  instead — [[0008-timing-not-aim-for-shot-direction]]. Do not wire `aim` into
  the sim on the assumption that it was simply forgotten.
- **`feedback` is not authoritative for anything.** It drives haptics on the
  phone. The host has already decided what happened.

## Deliberately absent

No sequence numbers, no acknowledgements, no sim state on the wire, no time
sync. A dropped aim update is replaced 20ms later. If swings start getting
lost on real hardware, that is the moment to reconsider — not before.

## See also

[[wire-protocol]] · [[architecture]] · [[modules/server]] ·
[[0005-raw-websockets-over-socket-io]] · [[ios-safari-tab-suspension]]
