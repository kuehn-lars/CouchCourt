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
| `scripts/relay-plugin.ts` | Attaches the relay to Vite's `httpServer`, in **dev and preview** | `tests/integration/preview-relay.test.ts` |

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
  │     ok    ──▶ send `assigned`, broadcast `lobby` (phones AND host)
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
- **A disconnected player's slot IS reclaimed — amended 2026-09-20.** A phone
  with no session takes an absent player's side, and that player's session is
  deleted. `resume` is handled first and still wins, so a player whose phone
  slept always gets their own side back; only a genuinely new phone can take
  an absent one. The original "never reclaimed" policy jammed the lobby solid
  the first evening it had a Start button — see [[0006-relay-session-policy]].
- **`pingIntervalMs` defaults to 15s and is an unmeasured guess**, not a tuned
  constant — unlike the swing detector's thresholds, there is no experiment
  behind it. One interval is both the ping cadence and the timeout, the
  canonical `ws` pattern.

## The lobby is a snapshot, not a stream

The host is sent `{ t: "lobby", players }` — the whole roster — on connect
and on every change. `player-joined`, `player-left` and `player-ready` were
deleted on 2026-09-20.

A host that reloads mid-lobby cannot rebuild the roster from deltas it was
not connected for, and two places deriving "who is here" from different
event streams is the drift this protocol exists to avoid. The phones get the
same message. One message, one truth.

The host's own match state travels the other way: `{ t: "match", phase,
server, winner? }`, host → relay → every phone. The relay stores none of it.

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

## There is no production entry, and that is the answer

Closed 2026-09-20 by [[0010-vite-preview-as-production-server]]: `npm start`
is `vite build && vite preview`, and `relayPlugin` attaches to the preview
server as well as the dev one. No hand-written Node server exists, because
Vite already does static serving and TLS correctly and the alternative was
eighty lines of MIME tables and traversal guards.

Two things a future session should not have to rediscover:

- **Vite's TLS server is an `Http2SecureServer`**, in dev and preview alike
  — [[vite-https-is-http2]]. The relay has always been attached to one. It
  works because `allowHTTP1` is set, and there is an integration test on that
  exact server shape.
- `tsconfig.base.json`'s `erasableSyntaxOnly` was originally justified by a
  Node-run server entry that now does not exist. It still earns its place:
  `scripts/*.ts` and `vite.config.ts` are loaded by Vite's own TS pipeline,
  and the flag is what keeps `src/shared/` free of syntax that needs
  emitting. Do not remove it on the grounds that the server is gone.

## See also

[[architecture]] · [[modules/shared-protocol]] · [[wire-protocol]] ·
[[0005-raw-websockets-over-socket-io]] · [[0006-relay-session-policy]] ·
[[ios-safari-tab-suspension]] · [[modules/tooling]]
