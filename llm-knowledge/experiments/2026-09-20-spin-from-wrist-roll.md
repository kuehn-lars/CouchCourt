---
title: Spin comes from the beta axis, and no fixture can confirm it
updated: 2026-09-20
tags: [experiment, swing, motion, honesty]
status: current
code:
  - `src/shared/swing/detector.ts`
  - `src/shared/sim/rally.ts`
---

# Spin from wrist roll — a decision wearing a measurement's clothes

## What the fixtures say

`rotationRate` is `[alpha, beta, gamma]`. The detector already spends two of
those: `alpha`'s sign separates forehand from backhand, `|gamma|` at the peak
detects a serve's pronation. `beta` is unread, so `beta` is where spin went.

Measured at the peak sample of all 20 committed traces:

| label | `beta` at peak (deg/s) |
| --- | --- |
| forehand | +287, -249, +112 |
| backhand | +34, -46, +218 |
| serve | -126, -163, -618 |
| gesture | +866, +318, -489 |
| walking | -803, +288 |

Across correctly-classified swings `|beta|` runs **34-618, median 163**.

## The honest part

**The sign is not consistent within a label.** Two forehands roll one way, one
rolls the other. That is not evidence the axis is wrong — *the captures were
never recorded with spin in mind*, so nothing in `tests/fixtures/motion/`
labels a topspin forehand against a sliced one. No fixture can confirm or
refute this mapping.

So `SPIN_DEADZONE_DEG_S = 100` and `SPIN_FULL_DEG_S = 600` are a **design
decision**, and only the range they live in is measured: the dead zone sits
above the roll every swing carries incidentally, and full spin sits just under
the largest `|beta|` any real swing in the set reaches, so a deliberate roll
can saturate it and an ordinary one cannot.

The mapping is deliberately bounded, signed and dead-zoned — the worst case
is that spin reads as noise, never that it takes a shot away from a player.

## What would settle it

Six captures with a phone in hand: forehand and backhand and serve, each hit
once with the wrist rolling over the ball and once slicing under it. If
`beta`'s sign tracks the intent, this is a measurement. If it does not, the
right axis is probably `gamma` for groundstrokes — which then needs a rule for
not colliding with serve classification, and that is a real design problem,
not a constant change.

This is the same list the streaming detector is waiting on
([[0009-streaming-swing-detection]] wants single-swing traces), so it is one
trip to the living room, not two.

## See also

[[2026-09-19-ios-devicemotion-sampling]] · [[2026-09-19-swing-detector-tuning]]
· [[2026-09-20-serve-that-lands]] — where spin turns into risk ·
[[modules/shared-swing]]
