---
title: Reading forehand, backhand and overhead at the peak
updated: 2026-09-22
tags: [experiment, swing, detector, measurement]
status: current
code:
  - `src/shared/swing/stream.ts`
  - `src/shared/swing/stream.test.ts`
  - `tests/fixtures/motion/`
---

# 2026-09-22 — Reading forehand, backhand and overhead at the peak

The evidence for [[0016-stroke-decides-direction]]'s classifier. Throwaway
scripts over every committed fixture; the kept result is asserted in
`stream.test.ts`. Each "swing" below is the **hardest peak** among
announcements under 700ms apart — the peak the host plays.

## Side: the peak detector had got worse

[[0015-contact-model]]'s peak detector read the side from the max-|alpha|
sample since its last announcement. Nobody re-measured that when it
replaced the hold detector, because the sim ignored `kind` then. It was
**54/60** on swings ≥ 0.4 power — not the 94.5% the older note reports.

| statistic at the hardest peak | power ≥ 0.3 | ≥ 0.4 |
| --- | --- | --- |
| max-\|alpha\| since last announce (was shipped) | 61/69 | 54/60 |
| alpha at the peak | 63/69 | 56/60 |
| alpha integral from lobe start | 48/69 | 42/60 |
| alpha integral, last 80ms | 62/69 | 55/60 |
| **alpha + k·gamma at the peak, k = 0.3–0.5** | **65/69** | **58/60** |

`SIDE_GAMMA_WEIGHT = 0.4`, mid-plateau. What gamma rescues is `forehand-06`:
wrist-snap forehands whose peak is almost pure gamma — `(3, 241, 1012)`.
The integral from lobe start loses because the backswing is in it.

## Overhead: gravity going into the swing

Nothing at the peak separates a serve from a hard forehand — confirmed
again, as [[2026-09-21-swing-direction-classifier]] found for `|gamma|`.
What does is **how the racket was held before the swing started**: an EMA of
`accelerationIncludingGravity` (τ = 200ms), frozen at the first sample of the
lobe, normalised. Groundstrokes go in with device x near vertical
(x ≈ −0.6…−1.0); overhands with the racket up, x ≈ −0.2…+0.4.

| τ | threshold | serves ≥950°/s | groundstroke peaks ≥600°/s called overhead |
| --- | --- | --- | --- |
| 200ms | −0.40 | 8/8 | 5/67 |
| 200ms | **−0.30** | **8/8** | **3/67** |
| 200ms | −0.25 | 8/8 | 3/67 |
| 200ms | −0.20 | 8/8 | 2/67 |
| 200ms | −0.15 | 6/8 | 2/67 |
| 300ms | −0.30 | 7/8 | 3/67 |
| 800ms | −0.50 | 7/8 | 3/67 |

`OVERHEAD_TILT = −0.3`, inside the −0.4…−0.25 plateau and away from its edge.
Two of the three false positives are recovery lobes, not the labelled stroke.

In the shipped test (hardest peak ≥ 635°/s): **59/65 sides right, 2/65 read as
overhead, 8/8 overhands.** Mutations watched failing: gamma weight 0 → 57/65;
threshold −0.6 → 12/65 overheads.

## What failed

- **A quiet-gated EMA** (update only while rotation < 200°/s): 7/8, 3–5 FPs.
  The ungated one is better because the backswing itself carries the
  "racket up" signal.
- **Rotation axis vs gyro-integrated gravity** (|cos| of the angle between
  them, integrating `dg/dt = −ω × g` through the lobe from a pre-swing
  estimate), under every axis mapping and sign: overlapping distributions.
  The end-of-lobe prediction agreed with the measured gravity at a median cos
  of only ~0.5 — the integration drifts more than the signal.

## What would overturn this

Only eight overhand swings exist, all in multi-rep serve captures. Recorded
smashes — an overhead at a ball dropping in front of you, not a serve — may
start from a different racket position. The controller's corner readout
exists so the next session with a phone can see the classifier's answer per
swing and record what it gets wrong.
