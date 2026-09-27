---
title: Swing cooldown timing, power-shot share and shot speeds
updated: 2026-09-27
tags: [experiment, swing, detector, measurement, arcade]
status: current
code:
  - `src/shared/swing/gate.ts`
  - `src/shared/swing/gate.test.ts`
  - `src/shared/swing/detector.ts`
  - `src/shared/swing/stream.test.ts`
  - `src/host/arcade.ts`
---

# 2026-09-27 — Swing cooldown timing, power-shot share and shot speeds

The numbers behind [[0022-arcade-layer]]. Throwaway drivers over every
committed fixture (`tests/fixtures/motion/`) through the real
`createSwingStream`, and over three bot sets through the real `tick`. Both
scripts were deleted; what they found is asserted in tests where it can be.

## How far apart the peaks of one swing land

Gaps between consecutive announced peaks, all 26 committed traces, ms, sorted:

```
66 100 100 116 116 116 116 133 134 150 166 167 183 184 216 233 233 249 249
250 251 266 267 317 333 366 400 416 433 433 434 450 467 501 517 533 549 566
600 601 633 635 650 650 667 733 748 767 800 ... then 1000-5150
```

Under ~450ms is one swing (backswing, swing, follow-through). 450-670 is
ambiguous: in the 30s captures a rep is every ~3s, so a 517 inside a run of
3000s is a second peak of the same swing. Past ~700 is the next rep. So
`SWING_GROUP_MS = 600` — shorter and the cooldown drops the real swing behind
its own backswing, which is the one failure it must never have.

**Caveat, inherited from every fixture here:** multi-rep captures, recorded
faster than gameplay ([[2026-09-20-streaming-swing-latency]]). Real rally
spacing would only widen the gap between reps.

## How soon a player really swings again

Two bots, three sets (0.65 v 0.65, 0.9 v 0.5, 0.4 v 0.85), 1029 strokes: the
shortest time between two strokes **by the same player** in one point was
**1.97s**, median 2.57s. The ball has to cross and come back. So
`SWING_COOLDOWN_MS = 1200` cannot touch a legitimate rally — with the caveat
that bots never volley at each other at the net; a human pair might get closer.

## How often a swing is a power shot

Share of swing peaks (forehand, backhand, serve fixtures; 129 peaks) with
`power >= POWER_SHOT` (0.85):

| `POWER_CEIL_DEG_S` | `>= 0.85` | `= 1.0` |
| --- | --- | --- |
| 1400 (before) | 7% (9) | 1.5% (2) |
| **1250** | **15% (19)** | **5% (7)** |

`stream.test.ts` holds the share between 10% and 20%. It is a share of
*peaks*, not of played shots — the host plays the hardest peak of a swing, so
the share of shots is somewhat higher. Not measured with a person playing.

This raises every human swing's power a little, not just the top. The solo
balance ([[2026-09-22-stroke-direction-balance]]) was tuned at the old
ceiling and has not been re-run: expect a human to hit slightly deeper and
faster, and to go long slightly more when late.

## Shot speeds

Ball speed at the end of the tick it was struck in, same 1029 bot strokes,
km/h: min 61, p25 87, **median 100**, p75 106, p90 118, max 149. The arcade
layer's heat tiers (95 / 115 / 135) are cut from this, so roughly half of all
shots are tier 1, one in ten tier 2, and tier 3 is a power shot or a smash.
