---
title: Three.js over Phaser
updated: 2026-09-19
tags: [decision, rendering]
status: current
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
  [[0002-host-authoritative-simulation]].
- Rendering is not unit-tested. If the host page grows enough to be worth a
  smoke test, that is one Playwright check for "boots, canvas present, no
  console errors" — not a visual regression suite.
