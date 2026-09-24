---
title: Shot direction comes from swing timing, not phone aim
updated: 2026-09-22
tags: [decision, sim, input, core]
status: current
superseded-in-part-by: 0012-swing-kind-is-the-shot-direction
code:
  - `src/shared/sim/shot.ts`
  - `src/shared/protocol.ts`
---

**Direction is the stroke as of [[0016-stroke-decides-direction]] (2026-09-22)**, after a day of being timing again under [[0015-contact-model]]. The refusal to read the `aim` stream still stands.

# 0008 — Shot direction comes from swing timing, not phone aim

> **Superseded in part, 2026-09-21.** Direction no longer comes from timing:
> it comes from which stroke you played, and the shot aims at a place rather
> than pushing sideways at a fixed speed. See
> [[0012-swing-kind-is-the-shot-direction]] for what changed and why the
> reasoning below stopped applying once players could leave their baselines.
>
> **The rest of this note still holds**, and it is not a small rest: the
> refusal to read phone yaw, the calibration cost that rules it out, the `aim`
> stream being deliberately dead, and the camera rule. Amended rather than
> marked superseded, on the precedent of
> [[0006-relay-session-policy]] — one clause changed, not the note.

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
thirty seconds that are the core engineering problem of the whole
project. It also has to work for two players facing opposite directions, so
the calibration cannot be shared.

Timing is already being measured to decide whether the shot is good at all.
Using its sign for direction costs nothing extra, needs no calibration, and
produces a control scheme a player discovers by playing rather than by being
told.

It is also honest about what the game is. *Timing and intent
matter more than motion capture.* A direction derived from timing cannot
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

  **This is the clause that was overturned.** It was right while both players
  stood on the centre mark forever; once they ran, a fixed sideways push from
  `x = +3` landed out at all 20 powers. The solve that replaced it is a
  division by a constant flight time, and sweeping its two constants over
  their plausible ranges moves the outcome by two shots in two hundred — so
  it is not the precision this bullet was guarding against. See
  [[0012-swing-kind-is-the-shot-direction]] and
  [[0014-players-run-to-the-ball]].
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
- **`resolveShot` now reads `contact.x` as well as `contact.y`**, which the
  bullet above said it would not. See the amendment.
- **A serve is always dead straight.** A serve is self-initiated, so there is
  no incoming ball to time against and its timing error is hardcoded to zero —
  which means full quality and zero lateral speed. No serve toss or rhythm
  minigame exists to give it one; nothing has asked for one.
- The camera must stay **fixed behind the near baseline** and must not follow
  the hitter. Cross-court and down-the-line have to mean the same thing every
  shot, and a camera that flips the world would break that as surely as
  changing the sign would. See [[modules/host]]'s renderer rules.

## See also

[[0012-swing-kind-is-the-shot-direction]] (what replaced the direction rule) ·
[[0007-host-arrival-time-for-swing-timing]] (the other half of how a swing is
read) · [[modules/shared-sim]] · [[wire-protocol]] · [[modules/shared-protocol]]
