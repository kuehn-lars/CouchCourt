---
title: Relay session policy — host replacement, no slot reclaim, liveness defaults
updated: 2026-09-19
tags: [decision, networking, server]
status: current
code:
  - `src/server/lobby.ts`
  - `src/server/relay.ts`
---

# 0006 — Relay session policy

Three gaps [[wire-protocol]] and [[0005-raw-websockets-over-socket-io]] leave
open, decided while building `src/server/` rather than blocked on.

## A second host connection replaces the first

Only one Mac exists in practice. A new `host-hello` becomes the active host;
the previous host connection is simply no longer sent anything (it is not
closed by the server — the old page, if still open, just goes quiet). There is
no rejection message for this because `HostBoundMessage` has none to send.

**Rejected:** giving the host a `"rejected"`-style message of its own. Nothing
asks for it, and the host is developer-run, not a guest — a raw disconnect is
acceptable here where it would not be for a phone.

## A version-mismatched host is closed, not told why

`ControllerBoundMessage` has `"rejected"`; `HostBoundMessage` does not. A
controller gets `{ t: "rejected", reason }` before the close. A host with a bad
`v` just gets `ws.close()`. Same reasoning as above — inventing a message type
the protocol doesn't define, for an audience of one developer, is not worth it.

## A disconnected player's slot is never reclaimed for someone else

The vault asks for two things: resume-by-`playerId` (so the *same* player can
come back), and a liveness timeout so a dead slot is *detectable*. It does not
ask for freeing an abandoned slot so a *different* new player can take over
`near`/`far`. With 1v1 as the only v1 mode, there is no scenario yet where that
matters, and guessing at a policy (how long to wait? does the game pause?)
would be built against a requirement nobody has stated.

**Consequence:** today, a player who disconnects and never comes back leaves
their side permanently occupied for the rest of that server process's life. A
new server process (the host restarting) is the only way to clear it. Revisit
if/when a real session ever needs it.

## Ping interval is an unmeasured default, not a tuned constant

`attachRelay`'s `pingIntervalMs` defaults to 15s (canonical `ws` heartbeat
pattern: one interval is both the ping cadence and the timeout). This is a
policy guess, not something measured on real hardware — unlike the swing
detector's thresholds ([[2026-09-19-swing-detector-tuning]]), there is no
experiment behind this number yet. [[ios-safari-tab-suspension]]'s "Untested"
section is the open question that would inform a real value; until then this
is deliberately just a sane-looking default with a name, easy to override.

**Code map:** [[modules/server]]
