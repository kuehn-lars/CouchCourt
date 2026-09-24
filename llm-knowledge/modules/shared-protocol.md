---
title: "Module: src/shared/protocol.ts — the wire contract"
updated: 2026-09-24
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
| Transport | `RELAY_PATH` — the URL path the relay owns, shared with Vite's port |
| Bounds | `MAX_SWING_LAG_MS`, `DEFAULT_SWING_LAG_MS` |
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

## Changes of 2026-09-20

- **`Swing.spin`** — optional, -1 (slice) to +1 (topspin), read from the
  phone's `beta` rotation axis. Optional on purpose: a phone running an older
  build is still a playable phone, and `PROTOCOL_VERSION` does not move for
  an additive field. The sim reads `spin ?? 0`.
  **The relay rebuilds `swing` field by field**, so a new `Swing` field that
  is not added there is silently dropped on the wire. That happened with
  `spin`; `tests/integration/relay.test.ts` is now the thing that notices.
- **`MatchPhase` / `MatchInfo` and `{ t: "match" }`** — host → server → every
  phone. The host owns the match state machine; the server stores none of it.
- **`{ t: "lobby", players }` now goes to the host too**, and
  `player-joined` / `player-left` / `player-ready` are **deleted**. A host
  that reloads mid-lobby cannot rebuild a roster from deltas it was not
  connected for. See [[modules/server]].

## Changes of 2026-09-21

- **`Swing.lag`** — optional, milliseconds between the swing's peak and the
  moment the phone's detector announced it. The host subtracts it from arrival
  time, because **nothing compensated for detector latency before** and every
  swing was therefore reading late. Bounded by `MAX_SWING_LAG_MS`; absent
  means `DEFAULT_SWING_LAG_MS`, not zero. Optional on the `spin` precedent, and
  `PROTOCOL_VERSION` does not move. [[0013-detector-latency-is-compensated]].
  **The relay dropped it** on the day it was added, exactly as the `spin`
  warning above predicted.
- **`SwingKind`'s `serve` became a value only the sim produces.** The phone no
  longer guesses serves — the threshold it used turned out to be measuring
  swing speed. The guard still accepts `serve` from a controller and the sim
  overrides it. [[0012-swing-kind-is-the-shot-direction]].
- **`SwingKind` gained `overhead`** (2026-09-22) — the phone's reading of an
  overhand motion, and a stroke the sim plays as a smash out of the air. An
  additive value: an older controller never sends it, so `PROTOCOL_VERSION`
  did not move. It is distinct from `serve`, which is still the sim's.
  [[0016-stroke-decides-direction]].
- **`RELAY_PATH`** — the relay's own URL path, here rather than in the server
  because the host page, the controller and three integration tests all have
  to agree with it. Sharing a port with Vite's HMR socket makes a path part of
  the contract: [[one-port-one-websocket-path]].

## Changes of 2026-09-24

`MatchInfo.score?: MatchScore` — games, points (as the umpire says them),
who serves, and `ball: "hand" | "toss" | "play"`. **Optional, no version
bump**: an older phone ignores it, an older host never sends it. Guarded in
`isHostMessage` (`isMatchScore`: whole games 0..99, points matching
`0|15|30|40|AD|\d{1,2}`, a real side, a real ball state), passed through by
the relay's explicit `match` rebuild in `relay.ts` **and** by the session's in
`controller/session.ts` — both copy fields one by one, so a new field has to
be added in both or it silently vanishes. The host builds it in
`src/host/score-line.ts` and sends it only when it changes.
[[0020-the-phone-is-the-string-bed]].

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
- **`feedback` is not authoritative for anything.** It drives the flash on the
  phone. The host has already decided what happened.
- **`Swing.lag` is a duration, not a timestamp, and that is the whole reason
  it is allowed.** Both ends of it are read from the same phone's clock
  milliseconds apart, so the skew that makes `Swing.at` useless across devices
  cancels exactly. Do not "improve" it into an absolute time.
- **`SwingKind` has three values and a phone sends two of them.** A controller
  claiming `serve` mid-rally is played as a forehand rather than rejected.

## Deliberately absent

No sequence numbers, no acknowledgements, no sim state on the wire, no time
sync. A dropped aim update is replaced 20ms later. If swings start getting
lost on real hardware, that is the moment to reconsider — not before.

## See also

[[wire-protocol]] · [[architecture]] · [[modules/server]] ·
[[0005-raw-websockets-over-socket-io]] · [[ios-safari-tab-suspension]] ·
[[0012-swing-kind-is-the-shot-direction]] ·
[[0013-detector-latency-is-compensated]] · [[one-port-one-websocket-path]]
