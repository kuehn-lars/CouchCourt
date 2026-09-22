---
title: The shot-feel constants, tuned against a measured playability envelope
updated: 2026-09-22
tags: [experiment, sim, tuning, phase-9]
status: superseded
code:
  - `src/shared/sim/shot.ts`
---

**Superseded by [[2026-09-22-contact-model-feel]].** The constants tuned here (fixed speed ranges and launch angles) are gone, and `playability.test.ts` was deleted with them — its envelope is now a guarantee `shot.test.ts` asserts per shot: every launch is now solved through `stepBall` to land on an aimed target ([[0015-contact-model]]).

# The shot-feel constants, tuned against a measured playability envelope

The last phase of the simulation build plan, now deleted (recoverable at
`git show 0d95ed4^`). `sim/playability.test.ts` is the permanent regression
net; this note is the measurement behind the two constants it drove, and the
two fixture bugs that cost the most time getting there. What the constants
mean and which kind each is: [[modules/shared-sim]].

## The result

`GROUND_SPEED_MAX` (groundstroke launch speed ceiling) 30 → 28 m/s.
`HEIGHT_ANGLE_BOOST` (extra launch angle for a low contact) 0.3 → 0.5 rad.
Both in `shot.ts`, both only affect groundstrokes: a serve's contact height
always equals `CONTACT_HEIGHT_REF`, so `heightDeficit` — and therefore
`HEIGHT_ANGLE_BOOST` — is always zero for a serve, and serves have their own
speed range (`SERVE_SPEED_MIN/MAX`, untouched). That is why every existing
test, including `rally.test.ts`'s full-set replay (which scripts serves
only), still passes unchanged — nothing about a serve moved.

With the phase-5 placeholder values, a well-timed groundstroke from a
representative baseline contact (0.8m, a fixed fixture — see below) landed in
only 50% of the power range: weak power often netted (too flat a launch
angle for a low contact to clear it), full power often sailed past the
baseline. Tuned, that fixture lands in 60%+, `sim/playability.test.ts`'s
floor.

## Two fixture bugs, not physics bugs

Both cost real time because the numbers they produced looked plausible.

**The feeder-couples-to-the-constant-under-test bug.** The first playability
harness generated its incoming ball with a real `near` forehand through
`resolveShot`, so retuning `GROUND_SPEED_MAX` also moved the fixture's own
contact height and invalidated the comparison between runs. Fixed by hand
specifying a fixed incoming trajectory, independent of anything in `shot.ts`.

**The timing-by-tick-offset bug.** Sweeping `timingError` by scheduling the
return swing some number of ticks before or after the predicted crossing
looked right for "sweep power at perfect timing", but for "worst-case timing"
it produced a stark, wrong-looking asymmetry: every *late* mistimed max-power
shot landed in, every *early* one didn't, at every magnitude tried. Cause:
ball height at the moment of actual contact drifts with how many ticks late
the swing is (the ball keeps falling, or has already bounced), and
`HEIGHT_ANGLE_BOOST` turns "the ball happened to be lower when the racket
arrived" into "more loft, more likely to land in" — a real effect, but not
what a "worst-case timing" test is supposed to isolate. Fixed by applying
`timingError` directly as an offset to the swing's input time against a
*fixed* contact position, so contact height no longer depends on how mistimed
the swing is. This is the reason `playability.test.ts`'s own header calls out
testing the timing/fence/serve properties directly against
`resolveShot`+`stepBall` rather than through `tick()`'s scheduling — only the
power-sweep bullet needs the live rally machine.

## The other three envelope properties

Held with the phase-5 constants already and were unaffected by this tuning
(both changed constants are inert above `CONTACT_HEIGHT_REF` or for a serve):

- Deep-miss-window timing at max power: 0% landed in, both directions, once
  contact height was fixed (see above).
- No legal power reaches the far fence: even full power from a full-court-
  length contact barely reaches the opposite baseline (~0.4m past it at the
  old constants, less now) — the drag physics from [[tennis-scoring]]'s
  `sim/ball.ts` (phase 2) already impose the ceiling; nothing here bolts one
  on.
- A minimum-power serve clears the net: true regardless of these two
  constants, since a serve's contact height and speed range are untouched.

## What this doesn't cover

`sim/playability.test.ts` checks *whether* a shot lands in over a plausible
range, not how it *feels* — the plan's own bar ("does a swing that felt like
a forehand produce a forehand that goes where the player expected") needs
real phones and a real match, which no session so far has had. If a future
manual pass changes these constants for feel, re-run this envelope and its
reasoning, not just the numbers.

**Code map:** [[modules/shared-sim]]
