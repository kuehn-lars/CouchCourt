---
title: What actually tells a forehand from a backhand
updated: 2026-09-22
tags: [experiment, swing, detector, measurement]
status: current
code:
  - `src/shared/swing/detector.ts`
  - `src/shared/swing/stream.ts`
  - `tests/fixtures/motion/`
---

**Historical.** The live detector no longer classifies this way: since [[0016-stroke-decides-direction]] it reads `alpha + 0.4·gamma` at the peak and adds overhead — see [[2026-09-22-stroke-classifier]], which also found the peak detector had quietly fallen to 54/60. The batch detector still uses the rule below.

# 2026-09-21 — What actually tells a forehand from a backhand

Six new 30-second captures — `forehand-04..06`, `backhand-04..06`, 3 forehand
and 3 backhand, same reference iPhone and same grip convention — were added on
2026-09-21 because the shot direction was about to depend on the answer.

They immediately showed the detector was far worse than the nine committed 6s
captures had suggested.

## What the old classifier scored

Across **every labelled swing trace**, streaming:

| | right | wrong |
| --- | --- | --- |
| all traces | 34 | 30 |

**53%.** Per trace, batch detection, wrong out of detected:

| trace | wrong | note |
| --- | --- | --- |
| `forehand-06` | **10 / 10** | every swing misread |
| `forehand-04` | 6 / 8 | |
| `backhand-05` | 2 / 9 | |
| `forehand-05` | 2 / 5 | |
| `backhand-04` | 1 / 2 | |
| the nine 6s traces | 0 | which is why nobody knew |

## Two separate bugs

**1. `SERVE_GAMMA_THRESHOLD_DEG_S = 350` was measuring speed, not a serve.**
Peak `|gamma|` on hard forehands in the new captures: **1063, 1012, 921, 870,
837, 829**. The old note called 400-770 a serve's pronation signature and
groundstrokes "under 300 at the same moment"; that held for nine gentle 6s
captures and for nothing else. The distributions overlap completely and no
value separates them.

**2. Alpha was read at the magnitude peak, and the magnitude peak is often
not about direction at all.** `forehand-06`'s peak samples:

```
(  3, 241, 1012)
(202, 105, 1063)
( 62, 193,  837)
(-124, -708, 444)
```

Almost pure gamma — a wrist snap. The alpha component there is noise, and it
was the entire decision.

## What does work

**The signed integral of alpha over a whole episode: 52 / 52 correct**, across
all twelve groundstroke traces including every one of `forehand-06`'s ten. The
net turn over a swing is the direction you swung it; no single sample is.

Every backhand episode: −133 to −458. Every forehand episode: +38 to +321. No
overlap anywhere.

## Which is not streamable, and what is

At the streaming emit point the episode is only partly seen and the backswing
has not yet been outweighed. Twelve candidate statistics × five hold times,
scored over all groundstroke traces:

| statistic | +0ms | +100ms | +200ms |
| --- | --- | --- | --- |
| peak alpha (the old rule) | 47/56 | 48/55 | 49/55 |
| alpha integral, whole run | 40/56 | 48/55 | 49/55 |
| alpha integral from peak−80ms | 50/56 | 51/55 | 52/55 |
| **alpha at the max-\|alpha\| sample** | **49/56** | **50/55** | **52/55** |

The last two tie at the top. **Max-|alpha| was chosen** — it is O(1) state the
stream already had room for, one comparison per sample, no window and no
integral, and it degrades to the same answer.

Isolated swings, cut out of the same captures with real quiet either side —
much closer to what a rally looks like than 30s of continuous reps:

| hold | max-\|alpha\| |
| --- | --- |
| +0ms | 46/52 |
| +100ms | 48/52 |
| **+150ms** | **50/52 (96.2%)** |
| +300ms | 50/52 |

`EMIT_HOLD_MS = 150`. Past it nothing more is bought.

## What failed: a grip-invariant classifier

Reading a fixed device axis is fragile by construction — the fixtures' README
warns that the same swing lands on different axes in a different grip. The
obvious fix is to project `rotationRate` onto a low-pass estimate of gravity,
giving rotation about the **world** vertical, which no grip can change.

Tested at four EMA time constants (200 / 500 / 1000 / 2000ms), freezing the
estimate at run start so the swing's own acceleration could not poison it.
Best result **51/55**, below the plain device-axis rule, and the sign came out
inverted from the physical intuition.

Why it does not pay: `accelerationIncludingGravity` is dominated by swing
acceleration precisely during the swing, so the gravity estimate is least
trustworthy exactly when it is needed. Recorded because it is the obvious next
idea and it costs an evening to re-derive.

## Where it ended up

| | |
| --- | --- |
| continuous 30s captures | **52 / 55 (94.5%)** |
| isolated gameplay-shaped swings | **50 / 52 (96.2%)** |
| false positives on all 11 negative traces | **0** |
| `forehand-06` alone | **10 / 10**, from 0 / 10 |

The cost is latency: median 133ms after the peak becomes 200ms, p90 334ms —
which is past `MISS_WINDOW` and would be unaffordable, except that the swing
now reports the delay and the host subtracts it
([[0013-detector-latency-is-compensated]]).

## What would overturn this

The traces are still all multi-rep, and the isolated figures are cut from
them, so both the ready position and the pause between swings are synthetic.
Six genuine single swings recorded with rally spacing would settle it — the
same thing [[0009-streaming-swing-detection]] has been asking for, and the
94.5% here is the pessimistic number until someone records them.

## See also

[[0012-swing-kind-is-the-shot-direction]] ·
[[2026-09-19-ios-devicemotion-sampling]] · [[2026-09-19-swing-detector-tuning]] ·
[[2026-09-20-streaming-swing-latency]] · [[modules/shared-swing]]
