---
title: Streaming the swing detector — what it costs
updated: 2026-09-22
tags: [experiment, swing, controller, latency]
status: superseded
code:
  - `src/shared/swing/detector.ts`
  - `tests/fixtures/motion/`
---

**Superseded by [[2026-09-22-contact-model-feel]].** Describes the decay-trigger detector. The peak detector that replaced it emits a median ~50ms after the peak.

# Streaming the swing detector — what it costs

`detectSwings` is a batch function. The phone needs a live one. This measures
what the conversion costs, because the obvious implementation is unplayable
and that is not obvious until you measure it.

Method: all 20 committed traces in `tests/fixtures/motion/`, replayed
sample-by-sample through candidate emit policies by throwaway drivers.
**Latency is measured from the swing's own peak sample to the moment a policy
would emit** — not from the start of the swing, because the peak is when a
real racket meets a real ball.

## The naive wrapper is unplayable

Measured with the shipping implementation, not a prototype — an earlier
driver reported a 117ms median for the chosen policy because it measured run
duration to the sample that ended the run rather than to the last sample
inside it. The numbers below reproduce.

| Policy | latency med | p90 | max | false fires on the 9 negatives |
| --- | --- | --- | --- | --- |
| Rolling buffer into `detectSwings` | 1066ms | — | 3133ms | 0 |
| Emit at 50% of the running peak | 216ms | 350ms | 567ms | 0 |
| Emit at 60% of the running peak | 135ms | 333ms | 534ms | 0 |
| **Emit at 70% of the running peak** | **133ms** | **234ms** | **317ms** | **0** |
| Emit at 99% of the running peak | 117ms | 217ms | 300ms | 0 |

**99% measures marginally faster and is the wrong choice.** It fires on the
first sample-to-sample dip after the duration gate — which is sensor noise, or
the first local maximum of a swing still accelerating, not the peak. It buys
16ms of median latency by reading power from whatever happened to tick
downward first. 70% requires a real 30% fall from the peak before it will
believe the peak has passed.

The first row is a floor, not an implementation detail. `EPISODE_MERGE_GAP_MS`
is 800, so the batch detector cannot know an episode has ended until 800ms of
quiet have passed. Any faithful streaming wrapper inherits that wait.
The bar is a delay "not something a player notices"; a second is
not that.

The p90 is the number worth guarding, and `stream.test.ts` asserts it stays at
or under 250ms. That bound is not slack: it **fails at 60% and 50%**, so the
test pins the constant rather than passing for anything plausible.

## The property that survives streaming

**Zero emissions across all nine negative traces, under every policy tested**
— idle, walking, pocket and gesture. This was the finding most at risk and it
is not at risk. `MIN_SWING_DURATION_MS = 300` is what carries it: no negative
trace sustains `SWING_ROT_THRESHOLD_DEG_S` for 300ms, and a streaming detector
applies that gate identically to a batch one. See
[[2026-09-19-swing-detector-tuning]] for where that threshold came from.

This matters more than latency. The bar: "setting the phone down
mid-conversation **never** reads as a shot."

## What streaming gets wrong: it fires on the backswing

Batch, as a baseline: 18 of 18 swings classified correctly, 0 false fires.

Streaming at 70% decay, judged on the **first** swing of each positive trace
(the only unambiguous one), gets 6 of 9 right. The three failures:

| Trace | Streamed | Batch | Why |
| --- | --- | --- | --- |
| `backhand-02.json` | forehand, 0.22 | backhand, 0.42 | fired on the backswing |
| `forehand-03.json` | backhand, 0.21 | forehand, 0.67 | fired on the backswing |
| `serve-01.json` | forehand, 0.34 | serve, 1.00 | fired on the wind-up |

A backswing is sustained rotation in the *opposite* direction lasting over
300ms. Without seeing the future it is genuinely indistinguishable from a weak
swing of the opposite kind. All three cases are episodes whose peak falls in a
later run than the one that triggered emission.

**A higher peak bar does not separate them.** The misfiring backswings peak at
power 0.21–0.34; real first swings span 0.15–0.80. The ranges overlap, which
is the same wall [[2026-09-19-ios-devicemotion-sampling]] hit trying to
classify on peak alone.

## Why that is affordable

`swing.kind` is read in exactly **one** place in the simulation
(`src/shared/sim/shot.ts`), and only to ask `serve` or not-serve for a speed
range. Direction comes from timing's sign
([[0008-timing-not-aim-for-shot-direction]]). So a backhand delivered as a
forehand produces a **byte-identical shot** — two of the three failures above
are invisible to the game. Only the serve case changes anything.

The real residual cost is an under-read `power` (0.22 where 0.42 was meant),
which `POWER_FLOOR` and the "guess in their favour" principle already soften.

## What failed

**Emit early, end the episode the way batch does.** Emit at 70% decay, then
mute until rotation has been continuously quiet for `EPISODE_MERGE_GAP_MS`,
hoping to keep batch's episode boundaries while dropping its latency. It was
worse on both counts it was meant to help: 15 emissions against batch's 18,
and only 11–12 of 15 classified correctly. The long mute swallows genuinely
separate swings. A fixed refractory window from the emit is better.

## The hole in the fixture set

**All 20 traces are multi-rep captures.** Not one is a single swing recorded
with rally-like spacing, which is the only thing the game will ever see.

Gaps between qualifying runs *inside* one merged episode: n=13, 34–751ms,
median 250, with 7 of 13 at or under 300ms. The 517ms and 534ms gaps are
exactly the ones causing two of the three misclassifications above — and the
data cannot say whether they are one swing's backswing or two separate swings
that the 800ms merge is wrongly collapsing into one.

Six single-swing traces, recorded with a few seconds between them, would
settle it. The recorder already does this; it is a living-room task.

**Until then, treat the classification numbers above as a lower bound** — they
are measured on captures denser than gameplay.

## See also

[[0009-streaming-swing-detection]] · [[modules/shared-swing]] ·
[[modules/controller]] · [[2026-09-19-swing-detector-tuning]]
