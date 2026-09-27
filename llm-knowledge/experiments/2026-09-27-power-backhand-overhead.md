---
title: Earned power shots, backhand swings and overhead chances, measured
updated: 2026-09-27
tags: [experiment, sim, swing, detector, tuning, feel]
status: current
code:
  - `src/shared/sim/shot.ts`
  - `src/shared/sim/rally.ts`
  - `src/shared/sim/players.ts`
  - `src/shared/sim/bot.ts`
  - `src/shared/swing/gate.ts`
  - `src/shared/swing/detector.ts`
  - `src/shared/swing/stream.test.ts`
---

# 2026-09-27 — Earned power shots, backhand swings and overhead chances

The numbers behind [[0023-power-shots-are-earned]] and the backhand and
overhead changes made with it. The user reported, after playing on a phone:
power shots were unreachable and won every game; backhands felt bad and a
little buggy; the overhead connected too rarely. Throwaway drivers over every
committed fixture (`tests/fixtures/motion/`) through the real
`createSwingStream` + `createSwingGate`, and over the real `tick` with bots
and a simulated human. All drivers deleted; what they found is asserted in
tests where it can be.

## The simulated human, and a harness bug worth knowing

Same model as [[2026-09-22-stroke-direction-balance]]: swings at the contact
+ `TIMING_IDEAL` + N(0, σ), plays the side away from the bot, overhead at a
high air contact, against the solo bot (0.65). σ 30ms is a very precise
player, σ 60ms "decent".

**Trap:** the first version fixed its swing time at the *first* contact plan.
The contact is re-planned every tick until the ball bounces
([[0015-contact-model]]), so the human swung at a stale moment and whiffed —
and the bot's "winners" were mostly those whiffs. Track `contact.at` every
tick, as `bot.ts` does.

## Power: why it was overpowered

Before, every swing at `power >= POWER_SHOT` (0.85) was a full-power, flat
ball. Human always at power 1 v the 0.65 bot:

| | σ 30ms | σ 60ms |
| --- | --- | --- |
| winners per human shot | 23% | 21% |
| strokes per point | 5.4 | 4.6 |
| median human ball | 33.7 m/s | 32.6 m/s |

At power 0.6 the same player wins 5% of shots outright. The bot cannot reach
a flat 33 m/s ball aimed away from it; the user's report reproduces.

## Power: what was tried

| Attempt | Result |
| --- | --- |
| Cap unearned power at 0.7 (all of it) | Winners down, but hard swinging got **safer**: σ 60ms always-hard errors 74 → 29, points won 51% → 59%. A buff |
| Cap pace only, keep `LONG` from full power | Still 26 errors: the capped ball starts shorter, so lateness pushes it out less |
| **Late drifts from the capped landing toward where the full swing sends a late ball** | Shipped. Hard is a risk again |
| "Physics" condition: ball high at contact | Rejected: groundstroke contacts cluster at 0.8–1.07m (median 0.94, p90 1.06); a rule would hinge on centimetres nobody can see |
| `PERFECT_TIMING` 0.12 / 0.08 / 0.05 × `POWER_RALLY` 6 / 8 | Barely moved the always-hard player (the rally route dominates it). Chose 0.08 / 8 on meaning |

## Power: shipped

`isPowerShot`: power ≥ 0.85 **and** (|u| ≤ `PERFECT_TIMING` 0.08 **or** the
stroke is past the 8th of the point). Otherwise at most `POWER_CAP` 0.7 goes
into pace. Bot swings ≥ 0.85 once the rally is long.

| Human v 0.65 bot | points won | strokes/pt | winners/shot | median ball |
| --- | --- | --- | --- | --- |
| σ 60, always power 1 | 56% (was 51%) | 7.8 | **13%** (was 21%) | **24.7 m/s** (was 32.6) |
| σ 60, always 0.6 | 62% | 14.3 | 5% | 22.3 |
| σ 60, uniform 0.4–1 | 60% | 10.5 | 9% | 22.5 |
| σ 30, always power 1 | 70% (was 64%) | 6.6 | 21% (was 23%) | 31.8 m/s |
| σ 30, always 0.6 | 73% | 16.8 | 5% | 23.0 |

Winners now come almost only from earned power shots: about one in three is
a winner, a capped hard shot about one in thirty. Swinging hard every time
is no longer the best strategy. **The ceiling:** a σ 30ms player is PERFECT
on about half their swings, so they still earn a power shot on about half —
tighten `PERFECT_TIMING` if real play shows that.

Bots, 40 minutes: 0.95 v 0.5 wins 69–75% of points (was 71%), 0.7 v 0.7 is
even; rallies are longer (0.7 v 0.7: 6.8 → 9.2 strokes a point); about 30%
of bot strokes are earned power shots. The 0.65 bot still loses to both
simulated humans — the user asked for the power nerf, not a harder bot.

## Backhand: the cooldown refused the real swing

Every peak through stream + gate, 30s captures (reps ~3s apart, as in play).
A swing's take-back is a peak of its own, often read as the **opposite**
stroke, and lands 650–1017ms before the swing. The gate timed its 600ms
group from the first peak, so the swing behind it was refused:

```
backhand-05  25399 f0.43 → 26199 b0.75 REFUSED   28583 f0.63 → 29600 b0.68 REFUSED
forehand-04  24293 b0.20 → 24693 f0.49 → 24942 f0.64 REFUSED
forehand-04  27643 f0.26 → 28542 f0.78 REFUSED
forehand-06   6267 b0.18 →  6934 f0.79 REFUSED
```

Five of ~60 real reps (and `backhand-02`'s 5200 b0.59 in a short capture).
Fixed by letting a peak past the group through if it is harder than all of
the swing so far, once, within a cooldown of the first peak; the cooldown
restarts from it. `stream.test.ts` asserts no hardest-peak-of-a-rep is
refused.

## Backhand: read weaker than a forehand

Hardest labelled peak per rep (reps split at 1.2s):

| | n | p25 | median | p75 | ≥ 0.85 |
| --- | --- | --- | --- | --- | --- |
| forehand | 28 | 0.56 | 0.76 | 0.84 | 6 |
| backhand, before | 33 | 0.48 | 0.61 | 0.74 | 4 |
| backhand, ×1.15 | 33 | 0.59 | 0.74 | 0.89 | 9 |

Medians in rotation: 865 v 1012 deg/s (1.17). `BACKHAND_GAIN` = 1.15. The
share of all swing peaks at ≥ 0.85 goes 15% → 19.4% (129 peaks, 25), just
inside `stream.test.ts`'s 10–20% band.

## Backhand: the avatar swings on the empty side

Bots, 40 minutes: 610 of 1274 groundstrokes were played from the opposite
stance — the sim sets the stance from where the ball is, the swing decides
the stroke. Symmetric for bots; the forehand bias in `strokeFor` (−0.3m)
makes a human's backhand the likelier mismatch. Fixed in the renderer only.
**Not seen in a browser.**

## Overheads: why they were rare

32% of rally balls are above 2.3m somewhere over the receiver's half, but
they come down through it mid-court, far from a baseline player, and only
5.5% of returns were smash chances. Bots 0.5 v 0.65, 60 minutes:

| `SMASH_HEIGHT` / `SMASH_SLACK` | smashes of returns | chances | plan flips |
| --- | --- | --- | --- |
| 2.3 / 0.4 (before) | 5.5% (110) | 130 | 20 |
| 2.0 / 0.4 | 6.3% | 167 | 37 |
| 2.0 / 0.3 | 7.5% | 195 | 41 |
| 2.0 / 0.2 | 8.8% | 226 | 45 |
| **1.9 / 0.3** | **8.5% (175)** | 220 | 45 |
| 1.8 / 0.3 | 8.8% | 232 | 50 |

Chance-to-smash conversion stays ~80% throughout. Slack below `REACTION`
(0.3s) was not taken: the player cannot move for that long, and a plan that
flips back to a groundstroke leaves an overhead swing hitting air. Smashes
win almost no points outright here (0–3 of ~100–180): the receiver is
centred and the smash goes down the middle.

**Not measured:** any of this with a person. The phone's overhead read is
still backed by eight serve swings ([[2026-09-22-stroke-classifier]]).
