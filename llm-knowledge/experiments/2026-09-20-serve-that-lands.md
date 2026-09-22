---
title: The serve only landed at 7 powers in 21. Aiming it fixed that
updated: 2026-09-22
tags: [experiment, sim, feel, serve]
status: superseded
code:
  - `src/shared/sim/shot.ts`
  - `src/shared/sim/rally.ts`
  - `src/shared/sim/rally.test.ts`
---

**Superseded by [[2026-09-22-contact-model-feel]].** Serves are now solved into the box per shot rather than lerped between two measured angles ([[0015-contact-model]]). The finding that slice floats a serve long still explains why the solver must fly the real spin.

# The serve that lands

## What was measured

Driving `tick` from `createMatch("near")` with one serve input and watching
where the ball first touched down, across the whole power range.

**Before.** Contact at `CONTACT_HEIGHT_REF` (1.1 m, waist height) and a fixed
launch angle:

| | |
| --- | --- |
| Powers landing in the box (0.15-1.0 in steps of 0.025) | **7 of 35** |
| The window | power 0.30-0.45 |

Every other serve was a fault. `power` comes from peak angular velocity, so a
player has no fine control over it: three quarters of first serves would fault
and a large share of points would be double faults. Nobody had noticed because
the two committed fault fixtures *used* that brokenness — `swing("serve",
0.55)` was the "lands long" fixture and `swing("serve", 0.15)` the "nets" one.

## The fix, and why it is not a fudge

A serve is struck **overhead**, not at the waist, and a server **aims**: gently
over the net when hitting soft, down into the box when hitting hard.

- `SERVE_CONTACT_HEIGHT = 2.6` — `heldServeBall` no longer reuses
  `CONTACT_HEIGHT_REF`, which is a *groundstroke* reference.
- `SERVE_ANGLE_SLOW = 0.11` → `SERVE_ANGLE_FAST = -0.07`, lerped by power.

The two angles are read off a measurement, not chosen. For each power, the
band of launch angles that lands in the box was swept at 0.005 rad
resolution; the band's midpoint is very nearly linear in power:

| power | landing band (rad) | midpoint |
| --- | --- | --- |
| 0.15 | 0.025 … 0.140 | 0.083 |
| 0.35 | -0.020 … 0.065 | 0.022 |
| 0.55 | -0.045 … 0.015 | -0.015 |
| 0.75 | -0.065 … -0.020 | -0.043 |
| 0.95 | -0.080 … -0.040 | -0.060 |

`SERVE_ANGLE_SLOW/FAST` are that line extended to power 0 and 1.

**After: a flat serve lands in the box at every power, 21 of 21.**

## What makes a serve missable now

Spin. With the aimed serve, landing tolerates roughly gravity ×0.95 to ×1.25
before powers start dropping out:

| gravity | powers landing (of 21) |
| --- | --- |
| ×0.70 | 1 |
| ×0.85 | 8 |
| ×0.95 | 17 |
| ×1.00-1.15 | **21** |
| ×1.25 | 19 |
| ×1.35 | ~17 |

That asymmetry is why `SPIN_GRAVITY_TOP` (0.35) and `SPIN_GRAVITY_SLICE`
(0.15) are different numbers. A symmetric ±0.6 was tried first and made a
player who slices hard **unable to land a serve at any power** — 0 of 21 at
gravity ×0.40. Watched happening, not reasoned about.

So: flat is safe at any power, topspin dips and nets if you also swing your
hardest, slice floats long in the middle of the power range. Risk lives in
the spin axis, which is the one the player is choosing deliberately.

## The fixtures this replaced

`rally.test.ts` gained `LONG_SERVE` (power 0.6, spin -1), `NETTED_SERVE`
(power 1, spin +1) and `GOOD_SERVE` (power 0.6, flat), from a (power × spin)
grid over `tick`. The full-set replay also lost its 36 hardcoded
`{tick, side, swing}` rows — they encoded yesterday's flight times and
silently stopped serving into the right phase the moment the serve changed.
It now serves whenever the state says `waiting-serve`, which is just as
deterministic and survives the next tuning pass.

## See also

[[2026-09-20-shot-envelope]] — the groundstroke half, and explicitly *not*
the serve: it records "nothing about a serve moved", which was true then ·
[[2026-09-20-spin-from-wrist-roll]] · [[modules/shared-sim]]
