---
title: The phone streams swings, it does not batch them
updated: 2026-09-22
tags: [decision, swing, controller, latency, core]
status: superseded
code:
  - `src/shared/swing/detector.ts`
  - `src/shared/swing/stream.ts`
  - `src/shared/sim/shot.ts`
---

**Superseded by [[0015-contact-model]] (2026-09-22).** The phone now announces a swing at its peak (~50ms median), not after a decay trigger and a hold. The reasoning below about why `detectSwings` cannot be streamed still holds.

# 0009 — The phone streams swings, it does not batch them

Settled on 2026-09-20 while designing the controller, against the measurements
in [[2026-09-20-streaming-swing-latency]]. This is the first ADR for either of
[[architecture]]'s two open seams.

## Decision

The controller does **not** call `detectSwings` on a rolling buffer. A
separate streaming detector lives beside it in `src/shared/swing/`, sharing
its thresholds and its classification code, and **emits a swing before the
swing has finished**.

The policy, in three parts:

1. A run of samples at or above `SWING_ROT_THRESHOLD_DEG_S` that lasts
   `MIN_SWING_DURATION_MS` is a swing. Same gate as batch, unchanged.
2. Emit as soon as the current magnitude falls below **70%** of the run's
   running peak, or when the run ends, whichever comes first.
3. Then ignore everything for `EPISODE_MERGE_GAP_MS` — a fixed refractory
   window, reusing the batch constant rather than inventing one.

It carries **O(1) state**: the run's start time, its peak sample and that
peak's magnitude. No sample buffer, so a player who shakes the phone for a
minute costs nothing and there is no window length to tune.

## Why not reuse `detectSwings`

Because it cannot be fast. `EPISODE_MERGE_GAP_MS` is 800, so the batch
detector does not know an episode has ended until 800ms of quiet have passed.
Measured, a rolling-buffer wrapper emits **817–3133ms after the swing's peak,
median 1066ms**. `PRODUCT.md` asks for a delay "not something a player
notices." Emitting at 70% decay gives **median 133ms, p90 234ms, max 317ms**.

This is not a tuning gap that could be closed. It is what batch means.

## What it costs, and why that is acceptable

Streaming fires on the backswing in 3 of 9 positive fixtures, misreading kind
and under-reading power. That sounds disqualifying and mostly is not:

**`swing.kind` is read in exactly one place in the whole simulation**
(`src/shared/sim/shot.ts`), and only to choose a speed range for a serve.
Direction comes from timing's sign ([[0008-timing-not-aim-for-shot-direction]]).
A backhand delivered as a forehand is a **byte-identical shot**. Two of the
three failures are invisible to the game; only a serve read as a groundstroke
changes anything, and it changes it to a legal, slower serve.

The residual cost is an under-read `power`. `POWER_FLOOR` exists for exactly
this, and `PRODUCT.md` asks us to guess in the player's favour.

**The property that actually matters survives untouched:** zero false fires
across all nine negative traces — phone on a table, in a pocket, walking,
talking with hands. That is carried by the 300ms duration gate, which
streaming applies identically.

## Alternatives rejected

**Wrap `detectSwings` in a rolling buffer.** The obvious implementation, and
the reason this note exists. Median 1066ms. Unplayable.

**Emit early but keep batch's episode boundaries** — mute until 800ms of
continuous quiet rather than a fixed refractory. Measured *worse on both
counts*: 15 emissions against batch's 18, 11–12 of 15 classified correctly.
The long mute swallows genuinely separate swings.

**Suppress backswings with a higher peak bar for emission.** The ranges
overlap — misfiring backswings peak at 0.21–0.34 power, real swings at
0.15–0.80. No threshold separates them, the same wall
[[2026-09-19-ios-devicemotion-sampling]] hit.

**Emit at 99% of the peak** — the first downward tick after the duration
gate. Marginally faster (median 117ms) and worse: that tick is sensor noise or
a local maximum of a swing still accelerating, so power gets read from the
wrong sample. 16ms is not worth it.

**Trade latency for accuracy** (emit at run end: median 250ms, p90 432ms).
Rejected once it was clear the accuracy being bought is in a field the
simulation ignores. Worth revisiting only if serves specifically feel wrong.

**Detect on the host instead**, shipping raw samples over the wire. Rejected
by [[wire-protocol]] and [[0002-host-authoritative-simulation]] before this
question came up: the phone sends intent, not signal.

## What would overturn this

The fixtures are all multi-rep captures, denser than real gameplay, so the
classification numbers are a lower bound. If six single-swing traces recorded
with rally-like spacing show the backswing firing is an artifact of dense
reps, nothing changes but the confidence. If they show it happening in normal
play *and* serves feel wrong, revisit the 70% constant before the policy.

## See also

[[2026-09-20-streaming-swing-latency]] · [[modules/shared-swing]] ·
[[modules/controller]] · [[architecture]] ·
[[0008-timing-not-aim-for-shot-direction]]
