---
title: What iOS actually does to devicemotion sampling
updated: 2026-09-19
tags: [experiment, ios, safari, motion, measurement]
status: current
code:
  - `src/controller/record.ts`
  - `src/shared/swing/trace.ts`
  - `tests/fixtures/motion/`
---

# What iOS actually does to `devicemotion` sampling

Measured 2026-09-19 from 20 captures, 18,663 samples, recorded with
`src/controller/record.ts`. This answers the question [[index]] carried as an
open gap, and supplies the numbers a swing detector has to live with.

| | |
| --- | --- |
| Device | iPhone 14 Pro |
| iOS | 26.6.1 |
| Browser | Safari |
| Captures | 20 (6 s and 30 s), all seven labels |

## Gate 2 is cleared

`DeviceMotionEvent.requestPermission()` had never been called by any code in this
repo. It has now: the prompt appears, one tap grants, and samples flow. Both iOS
gates are proven on real hardware.

The working call is `request.call(DeviceMotionEvent)`, not `request()`.
`requestPermission` is a static method and WebKit checks its receiver; modules
are strict mode, so an extracted reference invoked bare passes `undefined`.
**Only the `.call` form has been run on a device** — the bare form was corrected
by review before the phone session, so "the bare form throws" is reasoning, not
a measurement. Do not undo it to find out.

## The rate is exactly 60 Hz, and the jitter is not real

A capture with no stall in it delivers **exactly** the expected count: 360
samples in 5.98 s, 1800 in 29.98 s, zero deficit. Mean interval 16.6657 ms →
**60.00 Hz**.

The per-interval spread looks worse than it is. On a clean 6 s capture the only
intervals that occur at all are:

```
15 ms ×4    16 ms ×123    17 ms ×221    18 ms ×11
```

No fractional values, because **`performance.now()` in iOS Safari is quantised
to 1 ms**. 79% of recorded `t` values are exactly integral and the rest are
integers carrying a ~3e-11 float artefact from the `t - t0` subtraction. So the
±1 ms wobble is a clock-resolution artefact, **not sensor jitter**. A detector
must not read anything into it, and must not assume a fixed `dt` either.

## Stalls are rare, real, and up to ~150 ms

| | |
| --- | --- |
| Intervals longer than 50 ms | **9 of 18,643** (0.048%) |
| Longest observed | **147 ms** |
| Where | mid-capture, not at the start |
| Which captures | `gesture` and `walking` — the ones where the phone is doing something irregular |

The recorder refuses to save a capture containing a gap over **250 ms**. That
threshold was picked blind before any data existed; it turns out to sit only
**1.7× above the real ceiling**. A 200 ms threshold would have thrown away good
captures. If it is ever tightened, tighten it against this number.

Missing samples are stalls, not bad readings: in every capture the shortfall
matches the stall time divided by 16.67 ms (e.g. `gesture-02` is 17 samples
short and lost 18.3 samples' worth of time). Captures with no stall are short by
nothing at all.

## No null readings in 18,663 samples

`toSample` drops any reading with a null or non-finite component rather than
substituting zero. The arithmetic above accounts for every missing sample as
stall time, which leaves no room for dropped readings — so iOS appears to have
delivered complete `accelerationIncludingGravity` and `rotationRate` on every
event.

This is inference, not a direct count: the trace format has no field for drops,
only the recorder's live readout showed them. Worth a field if it ever matters.

## Two samples can share a millisecond

`idle-02` and `walking-02` each contain one pair of samples with an **identical
`t`**, in both cases immediately after a 37–41 ms stall — the delivery catching
up. `isTrace` rejects `t` going *backwards* but permits equal values, which was
close to accidental. Had it required strictly increasing `t`, **2 of 20 real
captures would have been rejected as malformed.**

## The finding that actually constrains the detector

Peak `|rotationRate|` per capture, deg/s:

| Label | min | max |
| --- | --- | --- |
| serve | 959.9 | 1296.2 |
| forehand | 934.6 | 1268.2 |
| backhand | 585.7 | 1102.3 |
| **gesture** | 380.2 | **866.2** |
| **walking** | 364.9 | **803.4** |
| pocket | 79.3 | 118.1 |
| idle | 0.2 | 273.4 |

**Swings span 585.7–1296.2. Negatives reach 866.2. They overlap.**

A peak-angular-velocity threshold alone **cannot** separate a soft backhand from
someone talking with their hands, and there is no value that can be chosen to
make it. Any threshold above 866 loses real backhands; anything below it fires
while a guest gesticulates. The product bar is exactly this: *"a swing that
felt like a forehand reads as a forehand, and setting the phone down mid-
conversation never reads as a shot."*

So the detector needs something a single peak does not capture — shape, duration,
the acceleration signature, or a refractory period. That is the next question,
and it is now answerable in a vitest loop instead of a living room.

`idle` reaching 273.4 deg/s is the same warning in miniature: that is the phone
being picked up or put down, inside a capture labelled "at rest".

**Code map:** [[modules/shared-swing]] · [[modules/controller]]
