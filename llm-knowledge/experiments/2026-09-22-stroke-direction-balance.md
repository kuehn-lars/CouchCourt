---
title: Balancing stroke-decides-direction against a simulated human
updated: 2026-09-22
tags: [experiment, sim, tuning, feel]
status: current
code:
  - `src/shared/sim/shot.ts`
  - `src/shared/sim/bot.ts`
  - `src/shared/sim/players.ts`
  - `src/host/main.ts`
---

# 2026-09-22 — Balancing stroke-decides-direction

The numbers behind [[0016-stroke-decides-direction]]'s shot constants.
Same method as [[2026-09-22-contact-model-feel]]: throwaway drivers over the
real `tick`, never hand calculation.

## The simulated human

Swings at contact + 40ms display lag + N(0, σ); 50ms reported detector lag
plus 10–40ms unreported network; a backswing peak (−0.3s, power 0.25) and a
follow-through (+0.25s, 0.3) of the *opposite* side. Power uniform 0.4–0.9.
Plays the side away from the opponent 75% of the time, an overhead at an air
contact above 2m 85% of the time. The classifier's measured noise on top: 9%
of groundstrokes flip side, 3% read as overhead
([[2026-09-22-stroke-classifier]]). σ = 60ms is "decent", 100ms "novice".

## What happened on the way

| Attempt | Result |
| --- | --- |
| Shorter depth at 0015's angles (0.2 → 0.03 rad) | groundstrokes 33 m/s median: every rally ball a winner, 3.4 strokes/pt |
| Angles 0.35 / 0.12 | 27 m/s: still winners, novice never errs |
| Angles 0.42 / 0.20 | 23 m/s: **nobody is ever beaten**, 130 strokes/pt |
| Timing-as-a-trade, bot skill as a timing spread, on-time aim 3.2m, angles 0.45 / 0.04 | shipped, below |

**Why reach was a knife-edge.** Every clean shot landed on the same spot and
receivers were almost always back in the middle by the time the ball was
struck, so "hit away from the opponent" rarely applied. Bucketed by shot, a
hard, on-time ball to a centred receiver was a winner **2%** of the time.
Winners had to come from timing quality itself: on time is wider *and*
faster (`MISTIME_LIFT` slows everything else).

**The first timing model was not monotonic**: off-time drifted toward the
middle, then suddenly flew out. Novices almost never erred. The trade
(early wider, late deeper) makes a σ = 100ms player spray wide ~1 shot in 8.

Two harness traps: the tuning helper's `sed` dropped `export` from the
constants it set (the suite caught it with NaN timings); and the shot
record was taken before `revise`, so backswing strikes looked like the
game's most common shot.

## Shipped

Bots, 40 minutes each:

| | points | strokes / pt |
| --- | --- | --- |
| 0.85 v 0.6 | 27 : 13 | 6.8 |
| 0.95 v 0.5 | 27 : 14 | 6.8 |
| 0.7 v 0.7 | 26 : 21 | 7.0 |
| 1 v 1 | 16 : 31 | 3.7 (perfect bots hit winners) |

Humans against the bot, share of points won (0.6 and 0.65: six seeds pooled; 0.7: two):

| | v 0.6 | v 0.65 (solo) | v 0.7 |
| --- | --- | --- | --- |
| σ 60ms | 60% | 57% | 49% |
| σ 100ms | 46% | 43% | 36% |

Landing depth past the net p10/50/90: 7.4 / 8.5 / 10.7m (was ~10 at the
median). Groundstroke speed p10/50/90: 17 / 22 / 30 m/s. Rallies 8–11
strokes a point for humans; 8–37 smashes a match, mostly off popped-up late
balls.

**Hit rate per bucket** (decent human v 0.7, measured before the bot's
spread was widened — the human's own shots, so it barely moves): hard, on time, away from the
receiver 62% winners; hard, on time, at them 9%; hard, off time 4%;
hard and badly timed 33% errors. That gradient is the skill.

**Not measured:** a real person. `TIMING_IDEAL`, `SAFE_TIMING` and the angles
are the knobs a phone session should turn first.
