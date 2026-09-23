---
title: Three.js over Phaser
updated: 2026-09-24
tags: [decision, rendering]
status: current
code:
  - `src/host/`
  - `src/host/render/`
---

# 0003 — Three.js over Phaser

## Context

`PRODUCT.md` left this open pending prototyping. It was decided without a
prototype, for the reason below.

## Decision

Three.js.

## Why

Tennis is a depth game. The ball travels toward and away from the camera, and
judging that approach *is* the core skill the swing timing is built on. A 2D
side or top-down view does not make that harder to render — it removes the thing
being rendered.

The usual reason to pick Phaser is its sprite and 2D-physics workflow. That
advantage is worth nothing here, because there is no artist and no sprites. The
court, ball, net and players are procedural primitives — a plane, a sphere,
capsules — which also satisfies the "own assets only" principle in `PRODUCT.md`
for free, with no licensing question to think about.

## The camera follows from the same argument

Settled with the user on 2026-09-19: **elevated, behind the near baseline,
fixed.** The whole court is visible and the ball travels in depth, which is
the skill the swing timing is built on.

- **Side-on broadcast** is fairer to both players and removes the depth cue —
  it would argue against this ADR entirely.
- **A camera that follows the hitter** flips the world every shot and
  disorients both players. It would also break
  [[0008-timing-not-aim-for-shot-direction]], since cross-court and
  down-the-line have to mean the same thing every shot.

A small eased lateral drift toward the ball is allowed. Ease it, never cut.

## Alternatives rejected

- **Phaser / 2D.** Cheaper to first pixel, then rewritten once the depth problem
  becomes obvious. The cheap version is only cheap if you keep it.
- **Spike both and compare feel.** Rejected because the deciding factor is
  structural, not a matter of taste — no amount of prototyping makes a 2D view
  show depth.

## Consequences

- `three` is a runtime dependency; `@types/three` a dev one.
- The renderer reads simulation state and never writes it. There is no renderer
  interface or abstraction layer — one implementation, no indirection, per
  [[0002-host-authoritative-simulation]]. This held even where it cost
  something: phase 8 wanted a "did the ball bounce/hit this tick" flag for
  particle effects, and `MatchState` has none (`stepBall`'s `net`/`bounce`
  results are consumed inside `rally.ts` and never surface). Rather than
  growing the sim's public shape for a cosmetic need, `host/render/index.ts`
  exports a pure `detectEvents(before, after)` that diffs two consecutive
  `MatchState`s the same way `main.ts` already derives its `hit`/`point`
  feedback (`toHit` flip, `score` reference change) plus one heuristic for
  bounce (`v.y` sign flip near the ground) that only ever drives a visual, so
  a false positive costs nothing.
- Rendering is not unit-tested. If the host page grows enough to be worth a
  smoke test, that is one Playwright check for "boots, canvas present, no
  console errors" — not a visual regression suite.
- **The rules that keep it fast** live in [[modules/host]]. Three of the
  original seven (blob shadow only, procedural primitives only, no
  post-processing) were overturned on 2026-09-24 by
  [[0018-stylised-stadium-renderer]]; interpolate and zero allocation stand.
  They live
  next to the files that have to obey them. Breaking one shows up as periodic
  hitching rather than as an error, which is why they are written down at all.
