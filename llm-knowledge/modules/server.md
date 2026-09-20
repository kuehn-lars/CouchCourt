---
title: "Module: src/server — the relay"
updated: 2026-09-20
tags: [module, server, networking]
status: current
code:
  - `src/server/lobby.ts`
  - `src/server/relay.ts`
  - `src/server/lobby.test.ts`
  - `tests/integration/relay.test.ts`
  - `scripts/relay-plugin.ts`
---

# Module: `src/server` — the relay

Owns player slots and forwards messages. **Owns no game state** — the
simulation is in the host browser ([[0002-host-authoritative-simulation]]).

Split in two so the slot logic gets fast unit tests and only the socket wiring
needs a real `ws` server:

| File | Holds | Tested by |
| --- | --- | --- |
| `src/server/lobby.ts` | `Lobby` — a pure state machine over opaque connection tokens. No sockets, no timers | `src/server/lobby.test.ts` |
| `src/server/relay.ts` | `attachRelay` — real `ws` sockets, the heartbeat, translation to wire messages | `tests/integration/relay.test.ts` |
| `scripts/relay-plugin.ts` | Attaches the relay to Vite's `httpServer` in dev | — |

`Conn` is `object`, any reference — `relay.ts` passes the `WebSocket` instance
itself. That is what keeps `Lobby` socket-free and unit-testable.

## What lives where, exactly

`Lobby` holds `playerId → LobbyPlayer`, `Conn → playerId`, and which `Conn` is
the host. `relay.ts` holds the two things `Lobby` deliberately does not: the
actual `hostSocket`, and `connsByPlayer` (needed to route host-originated
`feedback` back to the right phone). Plus an `alive` WeakMap for the
heartbeat.

## The handshake

```
first message on a socket
  ├── parses as controller `hello`  ──▶ lobby.connectController
  │     ok    ──▶ send `assigned`, broadcast `lobby`, tell host `player-joined`
  │     !ok   ──▶ send `rejected` {full | bad-version | unknown-session}, close
  ├── parses as `host-hello`        ──▶ lobby.connectHost
  │     bad version ──▶ ws.close() with no message
  └── neither                       ──▶ ws.terminate()
```

A socket that never identified itself never entered `Lobby` state, so there is
nothing to unwind on terminate.

Thereafter the message router keys off what the socket already is:
`lobby.playerIdFor(ws)` → controller path, else `lobby.isHost(ws)` → host
path, else it is still handshaking.

## Session policy — the parts nothing else specifies

These were decided while building this module rather than blocked on, and are
written up in [[0006-relay-session-policy]]:

- **A second `host-hello` replaces the first.** The old host connection is not
  closed; it simply stops being sent anything. There is no rejection message
  because `HostBoundMessage` has none to send, and the host is developer-run.
- **A version-mismatched host is closed without being told why**, for the same
  reason. A controller gets `{t:"rejected", reason}` first, because a
  controller is a guest.
- **A disconnected player's slot is never reclaimed for someone else.** Today,
  a player who leaves and never returns holds their side for the life of the
  server process. With 1v1 as the only mode there is no scenario that needs
  more, and guessing at a policy would build against a requirement nobody has
  stated.
- **`pingIntervalMs` defaults to 15s and is an unmeasured guess**, not a tuned
  constant — unlike the swing detector's thresholds, there is no experiment
  behind it. One interval is both the ping cadence and the timeout, the
  canonical `ws` pattern.

## Invariants

- **Identity is attached server-side, from the socket**, on every forwarded
  message. Never trusted from the client. A client that names its own
  `playerId` is a client that can name someone else's.
- **Every inbound payload goes through a guard** (`parseControllerMessage` /
  `parseHostMessage`) before it reaches any logic.
- **Resume purges the old mapping first.** `connectController`'s resume branch
  deletes any existing `Conn → playerId` entry for that player before adding
  the new one. Without it, a stale socket's late `close` flips the live
  resumed player back to `connected: false` — the exact iOS case where a phone
  resumes on a new socket before the old one's close event arrives, if it ever
  does. There is a regression test named for it.
- **The heartbeat is our code.** `ws` gives `ping`/`pong` primitives and no
  policy; without the interval a locked phone lingers in the lobby forever.
  Deleting `ws.terminate()` has been watched failing the liveness test.

## Why not Socket.IO

Its headline feature is reconnection, and that is the argument that does not
survive contact: iOS *will* kill the controller's socket
([[ios-safari-tab-suspension]]), so reconnection is mandatory — but a generic
reconnect does not restore *which player you were*. Resume-by-`playerId` has
to be written either way, and once it exists Socket.IO's reconnect is
redundant with it. Full reasoning: [[0005-raw-websockets-over-socket-io]].

## The gap: no production entry

There is no `src/server/main.ts`. The relay reaches a socket **only** through
the dev-time Vite plugin, so `npm run build` produces static pages with no
server behind them. Deliberate deferral — no decision exists for how
production static serving works, and there was nothing real in `dist/` to
serve when this was written. See [[architecture]]'s "two open seams".

Note for whoever closes it: `tsconfig.base.json`'s `erasableSyntaxOnly` exists
because the server is intended to run under Node's native type stripping
(`node src/server/main.ts`, no build step). Keep it that way or the flag stops
earning its place.

## See also

[[architecture]] · [[modules/shared-protocol]] · [[wire-protocol]] ·
[[0005-raw-websockets-over-socket-io]] · [[0006-relay-session-policy]] ·
[[ios-safari-tab-suspension]] · [[modules/tooling]]
