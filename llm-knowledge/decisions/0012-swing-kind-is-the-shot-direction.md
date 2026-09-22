---
title: The stroke you play is the direction the ball goes
updated: 2026-09-22
tags: [decision, sim, input, swing, core]
status: superseded
code:
  - `src/shared/sim/shot.ts`
  - `src/shared/sim/rally.ts`
  - `src/shared/swing/detector.ts`
---

**Superseded by [[0015-contact-model]] (2026-09-22).** Direction is timing again, the Wii way, and forehand/backhand is chosen from where the ball is. The phone's `kind` is sent and ignored. **Its idea is back as [[0016-stroke-decides-direction]]**, in screen space and with timing as a trade.

# 0012 — The stroke you play is the direction the ball goes

Settled on 2026-09-21, after the user reported that a forehand and a backhand
played identically. **Supersedes the direction rule in
[[0008-timing-not-aim-for-shot-direction]]**, and only that rule — everything
else 0008 decided still holds, including the refusal to read the `aim` stream.

## Decision

Three parts, and the third is the one that made the other two possible.

**1. A forehand goes one way and a backhand the other.** A right-hander pulls
the ball across their body, so a near-side forehand sweeps toward `-x` and a
far-side one toward `+x`. Both cases are the sign of `forward`, which is why
it is one multiply and not a per-side table. The same convention `bot.ts`
already used to pick which stroke it was playing.

**2. Timing keeps quality and loses direction.** It still decides whether the
racket meets anything at all, how fast the ball leaves, and how much launch
angle it gets. Outside `CLEAN_WINDOW` it also **sprays** the ball in the
direction the error went, which is what keeps a mishit out of the court now
that it no longer flies wide by construction.

**3. The phone stops guessing serves.** The sim assigns `serve` from
`phase === "waiting-serve"`, and demotes a phone-claimed serve mid-rally to a
forehand. The detector's job is now exactly one bit: which way did the racket
sweep.

## Why

The phone had been detecting forehand and backhand, sending them over the
wire, and having them ignored by everything except the renderer's arm
animation. It is the single most obvious thing a player expects to control,
and the product's own bar is *"a swing that felt like a forehand reads as a
forehand"*.

Part 3 is not a simplification for its own sake. `SERVE_GAMMA_THRESHOLD_DEG_S
= 350` was a measurement from nine 6s captures, and six new 30s captures
destroyed it: hard forehands reach `|gamma|` of 1063, 1012 and 921 at their
peak. The gamma spike is a **fast swing** signature, not a serve signature.
Retuning it was not available — the distributions overlap completely — and the
sim already knows when a serve is a serve. Context beat classification, and a
threshold went away rather than getting a new number.

Full measurements: [[2026-09-21-swing-direction-classifier]].

## What this overturned in 0008

0008 rejected **"a geometry solve toward the opposite court"** explicitly, and
took "one lerp" literally. That was right at the time and is wrong now, for a
reason 0008 could not have seen: it was written while both players stood on
the centre mark forever.

A fixed sideways speed is a *push*, and a push only works from the middle.
Measured on 2026-09-21, with players that now run
([[0014-players-run-to-the-ball]]): a full-power forehand struck from `x = +3`
with a 7 m/s lateral landed **out at every one of 20 powers**, because it was
already at the sideline and was pushed further. Half of every rally would have
been decided by where the player happened to be standing.

So the shot is aimed at a **place** — `CROSS_COURT_X` metres from the centre
line, scaled toward the middle by contact quality — and the sideways velocity
is whatever reaches it in a nominal `AIM_FLIGHT_TIME`, clamped. Across five
contact positions × two strokes × 20 powers, **150 of 200 land in**, and the
ball goes cross-court from all five.

This is a geometry solve. It is not the *precision* 0008 was guarding against:
sweeping `CROSS_COURT_X` from 2.2 to 3.0 and `AIM_FLIGHT_TIME` from 0.9 to 1.3
moved the result by two shots in two hundred. The constants are insensitive,
which is the opposite of the fidelity trap.

## Alternatives rejected

- **Keeping timing as the direction and adding the stroke as a bias.** The
  smallest change, and it fails the report it was answering: the swing kind
  would still barely matter.
- **Stroke picks the half, timing nudges the angle inside it.** More
  expressive on paper. A player cannot feel 120ms, so the nudge is invisible,
  and it costs a constant nobody can tune against anything.
- **Retuning the serve threshold instead of deleting it.** No value separates
  the two distributions. A threshold that cannot be right is worse than no
  threshold, because it looks like it was measured.
- **Letting mishits land in.** "Generous input" argues for it, but the
  playability envelope has asserted since phase 9 that a shot deep in the miss
  window essentially never lands, and that property was silently resting on
  direction-from-timing. Restoring it deliberately as `MISHIT_SPRAY_MAX` beat
  discovering later that mishits had become free.

## Consequences

- **`SwingKind`'s `serve` is a value only the sim produces.** A controller may
  still send one and the guard still accepts it; nothing downstream believes
  it. Do not "fix" the detector by teaching it serves again.
- **`resolveShot` reads `contact.x` now**, which 0008 explicitly noted it did
  not. Its `contact.y` use is unchanged.
- The camera rule from 0008 still stands, and for a stronger reason: a camera
  that flipped the world would now flip what a forehand means.

## See also

[[0008-timing-not-aim-for-shot-direction]] (superseded in part) ·
[[0013-detector-latency-is-compensated]] · [[0014-players-run-to-the-ball]] ·
[[2026-09-21-swing-direction-classifier]] · [[modules/shared-sim]] ·
[[modules/shared-swing]]
