---
title: Swing detector thresholds, tuned against the traces
updated: 2026-09-19
tags: [experiment, swing-detection, tuning]
status: current
code:
  - `src/shared/swing/detector.ts`
  - `src/shared/swing/detector.test.ts`
---

# Swing detector thresholds, tuned against the traces

Answers the two open questions [[2026-09-19-ios-devicemotion-sampling]] left
and [[index]] carried as a gap. Tuned in a throwaway analysis script against
the 20 committed traces, then implemented in `detector.ts` and re-checked by
`detector.test.ts`'s fixture suite — the numbers below are what that suite
enforces, not just what a script once printed.

## Shape/duration does separate a swing from a gesture

A continuous run where rotation magnitude (`√(α²+β²+γ²)` of `rotationRate`)
stays **≥300°/s for ≥300ms** never occurs in any negative trace
(idle/pocket/walking/gesture) and occurs in every swing trace. The longest
sustained run in any negative trace is 200ms (`gesture-01`); the shortest
qualifying run in any swing trace is well above 300ms. Checked at nearby
threshold values (250-350ms) — not a fit to one trace.

This is the answer to "what separates a swing from a hand gesture, if not
peak": duration at a moderate threshold, not peak magnitude at all. A peak
threshold is still implicitly present (300°/s), but it does none of the
separating work — [[2026-09-19-ios-devicemotion-sampling]] already showed
gesture peaks reach 866°/s, well above it.

## A capture can contain more than one real swing

The recorded captures are 6-30s; several contain multiple swing-shaped
bursts, not one. Classifying every qualifying run independently
misclassified some of the weaker secondary ones — backswing/recovery motion
between reps, not full swings (peak magnitude 450-550°/s there, vs.
900-1400°/s for a confident hit).

**Fix: merge qualifying runs ≤800ms apart into one episode before
classifying**, using the episode's peak sample. This gives 0
misclassifications, 0 false positives and 0 misses across all 20 traces (18
total episodes). Checked 600-2000ms: 700-750ms still leaves one
misclassification, 800-2000ms is a stable zero-mismatch plateau — 800 was
picked at the start of that plateau, not its middle, to stay closer to "two
genuinely separate reps" than to "one swing's phases."

**Rejected: no merge, plus a minimum-peak filter instead.** Requiring each
raw run's peak to also clear ~600°/s cut the misclassification count from 8
to 4 but did not reach 0 — some weak-but-real backhand phases have serve-like
γ, and no simple peak floor separates them from prep motion. Merging first
and classifying the merged episode's peak is the thing that actually gets to
zero, because it stops trying to classify motion that is not the swing.

## Forehand/backhand/serve is separable from motion alone

No need for phone-rotation-relative-to-player-side. At an episode's peak
sample:

- **sign of α** (rotationRate x-axis) — positive is forehand, negative is
  backhand.
- **`|γ|` (z-axis) ≥350°/s** — a serve's pronation/wrist-snap, overriding the
  α sign check. Serves reach 400-770°/s here; groundstrokes stay under ~300
  at the same moment. 350 is the threshold's own midpoint, not fitted to a
  single trace.

## Power

`power` is peak rotation magnitude at the episode's peak sample, linearly
mapped from **400-1400°/s to 0.15-1.0**, clamped outside that range. The
range is the real measured spread of peak magnitude across every
correctly-classified episode (392.1-1401.4°/s — 400 rounds up slightly to
leave the lowest real swing just above the floor rather than jammed against
it).

The 0.15 floor, not 0, is a feel decision: the design principle is to "guess in
[the player's] favour", and a swing that cleared `MIN_SWING_DURATION_MS` was
a real attempt — it should never read as nothing. The exact floor and curve
shape (currently linear) are the most likely things a future session
re-tunes once this is played, not measured.

**Code map:** [[modules/shared-swing]]
