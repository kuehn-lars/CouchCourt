---
title: iOS will drop the controller's socket
updated: 2026-09-19
tags: [platform, ios, safari, networking]
status: current
code:
  - `src/shared/protocol.ts`
  - `src/server/`
---

# iOS will drop the controller's socket

Assume the connection dies mid-match. It is not an edge case, it is the normal
behaviour of the platform, and designing for it after the fact means retrofitting
session identity into everything.

## What triggers it

- The player locks the phone, or it auto-locks mid-rally.
- A notification pulls them into another app.
- Safari backgrounds the tab and suspends its timers and sockets to save power.
- The phone roams between Wi-Fi access points.

## What it looks like

The WebSocket closes, often without a clean close frame, so the server may not
learn about it until a write fails or a ping goes unanswered. A locked phone can
sit in the lobby looking connected indefinitely.

## Consequences for the design

1. **Session identity must outlive the socket.** The server assigns a `playerId`
   and the controller stores it in `sessionStorage`, then sends it as
   `{ t: "hello", resume: playerId }` on reconnect. Without this a player who
   glances at a notification comes back as a new player, and the slot they were
   holding is either lost or duplicated.
2. **The server needs a ping/pong liveness timeout.** `ws` provides the
   primitives but no policy — see [[0005-raw-websockets-over-socket-io]]. A slot
   held by a dead socket has to be reclaimable.
3. **A rejoining player must not restart the match.** Reconnection is a lobby
   and session concern, never a simulation one. The sim in `src/shared/sim`
   should not know that sockets exist at all — see
   [[0002-host-authoritative-simulation]].
4. **`visibilitychange` is the early warning.** The controller can see
   backgrounding coming and tell the host the player is away, which is nicer
   than the host discovering it from a timeout.

## Untested

Nobody has measured how long iOS actually waits before suspending a
foregrounded-then-backgrounded tab, or whether audio playback keeps it alive.
If someone measures it, that belongs in `experiments/`.

**Code map:** [[modules/server]] · [[modules/controller]] · [[modules/host]]
