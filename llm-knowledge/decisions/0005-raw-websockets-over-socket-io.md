---
title: Raw ws over Socket.IO
updated: 2026-09-19
tags: [decision, networking]
status: current
code:
  - `src/shared/protocol.ts`
  - `src/server/`
---

# 0005 — Raw `ws` over Socket.IO

## Decision

The `ws` package on the server, the native `WebSocket` API in both browsers.

## Why

Socket.IO's headline features are reconnection, rooms and transport fallbacks.
On a LAN with two modern Safari clients, fallbacks are dead weight, and rooms
are a `Map`.

Reconnection looks like the real argument, and it is the one that does not
survive contact with the problem. iOS suspends backgrounded Safari tabs and
kills the socket — see [[ios-safari-tab-suspension]] — so reconnection is not
optional. But a generic reconnect does not restore *which player you were*. We
need resume-by-`playerId` either way, and once that is written, Socket.IO's
reconnect is redundant with it.

The message volume also makes transport choice nearly irrelevant, which is
itself the argument for the smaller option. Because swing detection runs on the
phone (see [[wire-protocol]]), the wire carries a handful of semantic events per
rally plus a ~20Hz aim stream — not a 60Hz raw sensor firehose.

## Alternatives rejected

- **Socket.IO** — ~40KB of client for rooms we can do with a `Map` and a
  reconnect that does not solve our reconnect problem.
- **Server-Sent Events + POST** — one-directional, and the aim stream wants a
  cheap upstream channel.

## Consequences

- Resume-by-`playerId` is our code and must be tested. It is the first thing in
  `tests/integration/`.
- No automatic heartbeat. `ws` gives `ping`/`pong` primitives; a dead-peer
  timeout has to be written, or a locked phone lingers in the lobby forever.

**Code map:** [[modules/server]] · [[modules/shared-protocol]]
