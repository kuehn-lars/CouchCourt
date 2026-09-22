---
title: "Module: src/shared/swing — traces and swing detection"
updated: 2026-09-22
tags: [module, swing-detection, motion]
status: current
code:
  - `src/shared/swing/detector.ts`
  - `src/shared/swing/stream.ts`
  - `src/shared/swing/trace.ts`
  - `src/shared/swing/detector.test.ts`
  - `src/shared/swing/stream.test.ts`
  - `src/shared/swing/trace.test.ts`
  - `tests/fixtures/motion/`
---

# Module: `src/shared/swing` — traces and swing detection

Turns a stream of phone motion samples into the semantic `Swing` events the
wire carries. Pure, so it is tuned offline against 20 recorded traces instead
of in a living room. **This is the project's main testing leverage.**

There are **two detectors sharing `swingFrom`** — one definition of a swing's
power, spin and stroke side. `detector.ts` holds a batch detector
(`detectSwings`) that sees a whole trace at once and has no production caller;
`stream.ts` holds the live one (`createSwingStream`) that the phone runs.
**Since 2026-09-22 the live detector is a different algorithm from the batch
one**: it announces each rotation lobe at its peak, ~50ms after it, and leaves
telling a swing from a gesture to the host ([[0015-contact-model]]). The
duration-and-merge method described below is now the batch detector's only.

## Files

| File | Holds |
| --- | --- |
| `src/shared/swing/trace.ts` | `MotionSample`, `MotionTrace`, `isTrace`, `toSample`, `formatTrace`, `measuredHz`, `longestGapMs`, `nextTraceName`, `MAX_GAP_MS` |
| `src/shared/swing/detector.ts` | `detectSwings` (batch), `rotMagnitude`, `swingFrom`, `TURN_AXIS`, and every tuned threshold |
| `src/shared/swing/stream.ts` | `createSwingStream` (live peak detector), its thresholds, and `level` for the controller's meter |
| `tests/fixtures/motion/` | 26 committed captures, seven labels, plus their README |

## Wiring — and the seam

```
record.ts (controller)    ──▶ trace.ts    toSample, measuredHz, longestGapMs
trace-endpoint.ts         ──▶ trace.ts    isTrace, formatTrace, nextTraceName
detector.ts                    trace.ts    MotionSample
stream.ts                 ──▶ detector.ts  rotMagnitude, swingFrom, TURN_AXIS
fixtures.test.ts          ──▶ trace.ts    isTrace, measuredHz, longestGapMs

controller/main.ts         ──▶ stream.ts   createSwingStream            ◀── production caller
detectSwings (batch)       ◀── NOTHING in production, still only its own test
```

**`detectSwings` itself still has no production caller** — the controller
uses the streaming detector, never a rolling buffer into batch (measured
1066ms too slow, see [[2026-09-20-streaming-swing-latency]]). But the
classification/scaling logic `detectSwings` depends on — `rotMagnitude` and
`swingFrom`, split out of a private `toSwing` specifically so both
detectors share one definition — now runs in production every time the phone
streams a swing. [[architecture]]'s seam 1 (no controller entry module) is
closed; see [[modules/controller]] for what was built and what is still
unverified on real hardware.

`trace.ts` deliberately holds both the **writer** (`formatTrace`) and the
**reader** (`isTrace`) of the on-disk format, and `trace.test.ts` round-trips
one through the other. Split them across modules and they drift.

## The live detector (since 2026-09-22)

A **lobe** is a run of rotation ≥ `LOBE_FLOOR_DEG_S` (200°/s). Its peak is
announced once rotation falls to `PEAK_CONFIRM` (0.85) of it — or the lobe
ends outright — provided the peak reached `TRIGGER_DEG_S` (400) after at least
`MIN_RISE_MS` (40ms) of wind-up. A later peak in the same lobe ≥ `REFIRE_RATIO`
(1.05×) the last one is announced too. So one real swing is typically two or
three announcements — backswing, swing, follow-through — and **the host plays
the hardest one inside its timing window**. The phone does not try to guess
which peak was "the swing".

Measured on the committed swing traces: lag median ~50ms, p90 ~84ms; every
lobe ≥600°/s reported at ≥95% of its peak; idle and pocket traces never fire.
**Gestures and walking do fire** — no gate checkable at the peak separates
them (rise times overlap). That is safe only because of how the host uses a
swing; see [[0015-contact-model]] and [[2026-09-22-contact-model-feel]].

Trap already sprung: a lobe that crashes from its peak straight under the
floor in one sample used to end without announcing. The peak most likely to
do that is the real swing's.

## How the batch detector works

Peak angular velocity **cannot** separate a swing from a hand gesture — the
ranges overlap, measured: swings 585.7–1296.2°/s, gestures up to 866.2°/s.
There is no threshold that works. [[2026-09-19-ios-devicemotion-sampling]] is
the measurement; it killed the obvious detector before anyone wrote it.

What works is **duration at a moderate threshold**, then merging:

1. Find maximal runs where `|rotationRate|` stays ≥ `SWING_ROT_THRESHOLD_DEG_S`
   (300°/s) for ≥ `MIN_SWING_DURATION_MS` (300ms). No negative trace ever
   sustains that; every swing trace does.
2. Merge runs within `EPISODE_MERGE_GAP_MS` (800ms) into one episode — a real
   swing's rotation dips between backswing, forward swing and follow-through,
   fracturing it into several short runs.
3. Classify from the episode's **largest turn** — the sample where `|α|` is
   greatest, which is usually *not* the magnitude peak. Positive → forehand,
   negative → backhand. That is the phone's whole judgement.
4. `power` = peak magnitude mapped linearly from 400–1400°/s onto 0.15–1.0,
   taken from the magnitude peak, which is a different sample again.

**The phone does not classify serves.** It did, from `|γ| ≥ 350°/s`, until six
30-second captures showed hard forehands reaching `|γ|` of 1063. That was a
fast-swing signature, not a serve signature, and no value separates the two.
The sim assigns `serve` from `phase` instead
([[0012-swing-kind-is-the-shot-direction]]).

**Reading `α` at the magnitude peak was the other half of the same mistake.**
In `forehand-06` the peak sample is almost pure `γ` — `(3, 241, 1012)` — so
the decision rested on noise, and all ten of that trace's swings came out
wrong. Numbers, the twelve statistics tried, and the grip-invariant approach
that failed: [[2026-09-21-swing-direction-classifier]].

Result for the batch detector on the fixtures: **0 false positives and 0
misses across all 26 traces**. (The 52/55 direction figure was the old
streaming detector's; the live detector's `kind` is no longer used by the sim.) Every threshold sits on a measured plateau,
not a knife-edge — the original derivation is
[[2026-09-19-swing-detector-tuning]].

The `power` floor of **0.15, not 0**, is a feel decision, not a measurement: a
swing that cleared the duration gate was a real attempt and should never read
as nothing. `PRODUCT.md` asks to guess in the player's favour.

## Invariants

- **The detector never touches a browser API.** It is a pure function over a
  sample array; the `devicemotion` listener that feeds it lives in
  `src/controller/`. This is the purity boundary
  ([[0002-host-authoritative-simulation]]) and also what makes the fixtures
  useful at all.
- **`toSample` drops a reading with any null or non-finite component** rather
  than substituting 0. A zeroed sample is fabricated "at rest" data fed to the
  one algorithm whose entire job is telling rest from a swing.
- **`hz` is measured, never nominal.** Five of the first twenty captures
  sampled at 57–59Hz because delivery stalled. A hardcoded 60 would write that
  error straight into the data the detector is tuned against.
- **`isTrace` permits equal `t`, rejecting only backwards `t`.** This was close
  to accidental: two iOS samples can share a millisecond, and requiring
  strictly increasing time would have rejected 2 of the 20 real captures.
- **Fixtures are recorded, never synthesised.** A detector tuned against
  fiction is worse than no detector.
- **`nextTraceName` is max-plus-one, not count-plus-one**, so deleting a trace
  cannot cause a silent overwrite.
- **Both detectors classify through `swingFrom`, and it takes TWO samples.**
  `peak` (loudest — power, spin, `at`) and `turn` (largest `|α|` — forehand or
  backhand). They are routinely different samples and confusing them is the
  bug [[2026-09-21-swing-direction-classifier]] documents. The stream tracks
  both incrementally; `detectSwings` picks both out of the episode.
- **Only the stream can fill `Swing.lag`,** because only it has an emission
  moment to measure the peak against. `detectSwings` leaves it absent, which
  is why `stream.test.ts` compares the two with `lag` destructured off.
- **More traces have made the detector look worse, twice now.** Nine 6s
  captures said 100% and six 30s captures said 53%. Assume the current figure
  is the optimistic one until single swings at rally spacing exist.

## Facts about the sensor worth not re-measuring

- The rate is **exactly 60.00 Hz** on the reference device. The ±1ms interval
  wobble is `performance.now()` being quantised to 1ms in iOS Safari, **not**
  sensor jitter. A detector must not read anything into it, and must not
  assume a fixed `dt` either.
- Stalls are rare (0.048% of intervals), real, and up to **147ms**.
  `MAX_GAP_MS = 250` was picked blind before any data and turns out to sit
  1.7× above the real ceiling. A 200ms threshold would have discarded good
  captures.
- **Grip is a binding convention with no field to record it.** iOS
  `devicemotion` axes are device-fixed and do not rotate with the screen, so a
  portrait-grip trace is not comparable to a racket-grip one. The convention is
  prose in `tests/fixtures/motion/`'s README. Change it and **re-record
  everything** — mixing two grips inside the fixture set costs an evening of
  deciding the sensor is broken.

## See also

[[architecture]] · [[modules/controller]] · [[0015-contact-model]] ·
[[2026-09-22-contact-model-feel]] · [[0009-streaming-swing-detection]] ·
[[2026-09-20-streaming-swing-latency]] · [[ios-motion-permission]] ·
[[2026-09-19-ios-devicemotion-sampling]] · [[2026-09-19-swing-detector-tuning]]

Also: [[0012-swing-kind-is-the-shot-direction]] ·
[[0013-detector-latency-is-compensated]] ·
[[2026-09-21-swing-direction-classifier]]
