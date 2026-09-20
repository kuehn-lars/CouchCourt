---
title: Shot direction comes from swing timing, not phone aim
updated: 2026-09-20
tags: [decision, sim, input, core]
status: current
code:
  - `src/shared/sim/shot.ts`
  - `src/shared/protocol.ts`
---

# 0008 — Shot direction comes from swing timing, not phone aim

Settled with the user on 2026-09-19 before any simulation code was written,
recorded in the simulation build plan's up-front decision table, and promoted
here when that plan was deleted. It was load-bearing for four phases, and it
is the reason a whole message type in the wire protocol is dead.

## Decision

**The sign of a swing's timing error sets its direction.** Early is
cross-court, late is down the line, scaled linearly to `LATERAL_SPEED_MAX` at
the edge of the miss window. One `lerp`, in `resolveShot`.

The phone's `aim` stream is **not read by any v1 code.**

## Why

Reading phone yaw needs a trustworthy compass zero, and that needs a
per-player calibration step — hold the phone this way, tap here — inside the
thirty seconds `PRODUCT.md` calls the core engineering problem of the whole
project. It also has to work for two players facing opposite directions, so
the calibration cannot be shared.

Timing is already being measured to decide whether the shot is good at all.
Using its sign for direction costs nothing extra, needs no calibration, and
produces a control scheme a player discovers by playing rather than by being
told.

It is also honest about what the game is. `PRODUCT.md`: *"Timing and intent
matter more than motion capture."* A direction derived from timing cannot
contradict that; a direction derived from a compass bearing invites a fidelity
argument the project has already declined.

## Alternatives rejected

- **Phone yaw from the `aim` stream.** The calibration cost above. Rejected
  before it was built, not after.
- **A geometry solve toward the opposite court** — pick a target point, solve
  for the velocity that reaches it. This is what `contact.x` would be for, and
  it was considered and rejected while building `shot.ts`: the plan's "one
  lerp" was taken literally, because a geometry solve reintroduces exactly the
  precision the timing approach exists to avoid.
- **Leaving `contact` unused.** `resolveShot`'s signature asks for a contact
  point, and a parameter the body never reads is worse than no parameter. It
  is used for `contact.y` instead: a low contact needs more launch angle to
  clear the net, which is real tennis physics, uses the one piece of
  information the other parameters do not carry, and turned out to matter —
  `HEIGHT_ANGLE_BOOST` is one of the two constants phase 9 had to retune
  ([[2026-09-20-shot-envelope]]).

## Consequences

- **`Aim` and `{t:"aim"}` are live in the protocol and dead in the game.** The
  controller may send them and the relay forwards them to the host, where
  nothing consumes them. This looks like an oversight to anyone grepping for
  a consumer. It is not — do not wire it into the sim on the assumption it was
  forgotten. Removing it is also not obviously right: a cheap upstream channel
  that already works is worth keeping while the controller is unbuilt.
- **A serve is always dead straight.** A serve is self-initiated, so there is
  no incoming ball to time against and its timing error is hardcoded to zero —
  which means full quality and zero lateral speed. No serve toss or rhythm
  minigame exists to give it one; nothing has asked for one.
- The camera must stay **fixed behind the near baseline** and must not follow
  the hitter. Cross-court and down-the-line have to mean the same thing every
  shot, and a camera that flips the world would break that as surely as
  changing the sign would. See [[modules/host]]'s renderer rules.

## See also

[[0007-host-arrival-time-for-swing-timing]] (the other half of how a swing is
read) · [[modules/shared-sim]] · [[wire-protocol]] · [[modules/shared-protocol]]
