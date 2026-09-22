---
title: Why returns whiffed, detector latency, and balancing against a simulated human
updated: 2026-09-22
tags: [experiment, sim, swing, tuning, feel]
status: current
code:
  - `src/shared/sim/rally.ts`
  - `src/shared/sim/shot.ts`
  - `src/shared/sim/players.ts`
  - `src/shared/sim/bot.ts`
  - `src/shared/swing/stream.ts`
---

# Contact model: the measurements behind it

The evidence for [[0015-contact-model]]. All drivers were throwaway scripts
over the real `tick`, not hand calculation.

## The whiff, reproduced

A near-side swing timed exactly on the contact, arriving `lag + 30ms` later
with `lag` reported honestly, under the pre-0015 sim:

| lag | judged timing error |
| --- | --- |
| 0ms | −0.008s (hit) |
| 100ms | −0.650s (whiff) |
| 200ms | −0.650s (whiff) |
| 300ms | −0.650s (whiff) |

The old detector's median lag was 200ms, so effectively every return whiffed.

## Detector latency

Across the 15 committed swing traces, emission minus peak:

| | median | p90 | max |
| --- | --- | --- | --- |
| Decay trigger + 150ms hold (0009/0013) | 200ms | 334ms | — |
| Peak detector (0015) | 50ms | 84ms | 200ms |

The max is a plateaued swing: its peak cannot be confirmed until it drops.
Every lobe peaking ≥600°/s is reported at ≥95% of its peak speed; idle and
pocket traces never fire. Rise-to-peak, lobes ≥400°/s: backhands 66-383ms,
forehands 67-1167ms, gestures 11-316ms — no gate at the peak separates them.

## Balance

The simulated human: swings at contact + 40ms display lag + N(0, σ), reports
50ms of detector lag, 10-40ms of unreported network jitter, and also emits a
backswing peak (−0.3s, power 0.25) and a follow-through (+0.25s, power 0.3).
Against the solo bot at skill 0.7:

| Stage | σ=60ms human : bot | σ=100ms | strokes/pt |
| --- | --- | --- | --- |
| First contact model, no reaction delay | 24 : 0 | 24 : 0 | 8-9 |
| + slower recovery, lower reach (no effect alone) | 24 : 0 | 24 : 0 | 19 |
| + revise judged on swing time, bot error *rate* | 22 : 3 | 24 : 17 | 12-21 |
| **Shipped** | **25 : 14** | **16 : 29** | **8-13** |

What mattered, in order:

1. **Nobody could be beaten on the run.** Flights were 1.1-1.3s and receivers
   arrived with 0.3-0.7s to spare, because contacts sat at the deepest point
   allowed (baseline + 2m) and `HIT_REACH` was 1.8m. Contact now at ≤1.5m on
   the way down, `RUN_BACK` 1m, reach 1.4m, speed 4.5 m/s, `REACTION` 0.3s,
   recovery at 45% speed.
2. **Humans never missed.** With the whole window aiming inside the lines, a
   σ=100ms player still landed everything. `SAFE_TIMING` 0.5 puts the in-court
   band at roughly −190ms…+120ms around ideal inside a −300…+200ms connect
   window: timing errors spray, they do not whiff.
3. **The bot's misses were a smear.** Continuous noise made a 0.7 bot spray a
   third of its shots or none. Now a per-shot error rate (`ERROR_RATE × (1 −
   skill)`), clean placement otherwise.

Two traps sprung on the way: bots with identical 8-long noise cycles traded
deuce forever (0.7 v 0.7: 131 points, 0-0 in games) — fixed with a hashed
per-side sequence; and a coarse 0.04 rad net-lift step made a harder swing
fly *slower* than a softer one — now a bisection on the least angle that
clears.

**Not measured:** any of this with a real phone and a real person.
`TIMING_IDEAL` is the first knob to turn once someone does.
