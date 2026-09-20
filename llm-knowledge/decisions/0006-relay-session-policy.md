---
title: Relay session policy — host replacement, slot reclaim, liveness defaults
updated: 2026-09-20
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

## A disconnected player's slot IS reclaimed — amended 2026-09-20

**The original decision here was "never reclaimed", and it is reversed.** The
paragraph below is kept because the reasoning was sound at the time and the
thing that changed is worth naming.

> The vault asks for two things: resume-by-`playerId` (so the *same* player
> can come back), and a liveness timeout so a dead slot is *detectable*. It
> does not ask for freeing an abandoned slot so a *different* new player can
> take over `near`/`far`. With 1v1 as the only v1 mode, there is no scenario
> yet where that matters, and guessing at a policy (how long to wait? does
> the game pause?) would be built against a requirement nobody has stated.

What changed is that there is now a lobby, and therefore a place to get
stuck in. The consequence the original decision accepted — "a player who
disconnects and never comes back leaves their side permanently occupied for
the rest of that server process's life" — reads very differently once a host
screen exists that shows two slots saying RECONNECTING and a Start button
that can never light up. It was hit within minutes of the lobby existing.

**The policy now:** `connectController` prefers a genuinely free side; if
there is none, it takes the side of a player who is **not connected**, and
**deletes** that player's session rather than leaving it dangling.

The case this decision was protecting is untouched, because `resume` is
handled *before* any of it. A player whose phone slept comes back with their
own `playerId` and gets their own side, every time. Only a phone with no
session at all can take an absent player's place — which is exactly the
"their battery died, let me take over" case, and the only case where
reclaiming is what anyone would want.

The reclaimed player, if they ever do return, is told `unknown-session`,
which the controller already handles by forgetting its stored id and
rejoining as a newcomer (`src/controller/session.ts`). No shadowing, no two
players on one side.

No timeout is involved. "Disconnected" here is the relay's own liveness
signal, not a guess about elapsed time, which is what made the original
"how long do we wait?" objection unanswerable.

## Ping interval is an unmeasured default, not a tuned constant

`attachRelay`'s `pingIntervalMs` defaults to 15s (canonical `ws` heartbeat
pattern: one interval is both the ping cadence and the timeout). This is a
policy guess, not something measured on real hardware — unlike the swing
detector's thresholds ([[2026-09-19-swing-detector-tuning]]), there is no
experiment behind this number yet. [[ios-safari-tab-suspension]]'s "Untested"
section is the open question that would inform a real value; until then this
is deliberately just a sane-looking default with a name, easy to override.

**Code map:** [[modules/server]]
