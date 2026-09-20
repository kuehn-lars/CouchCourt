---
title: "Module: src/host — the Mac display"
updated: 2026-09-20
tags: [module, host, rendering]
status: current
code:
  - `src/host/main.ts`
  - `src/host/loop.ts`
  - `src/host/loop.test.ts`
  - `src/host/render/`
  - `src/host/index.html`
---

# Module: `src/host` — the Mac display

Runs the authoritative simulation and draws it. The only part of the system
currently wired end to end.

## Files

| File | Holds | Tested |
| --- | --- | --- |
| `src/host/main.ts` | rAF loop, socket wiring, the two state references, feedback | no — DOM and socket I/O |
| `src/host/loop.ts` | `advance(accumulator, frameDt)` — the fixed-timestep accumulator | yes, `src/host/loop.test.ts` |
| `src/host/render/index.ts` | `createRenderer`, `detectEvents` | no |
| `src/host/render/scene.ts` | Renderer, camera, lights, gradient background, fog | no |
| `src/host/render/court.ts` | Static ground, lines, sagging net, posts | no |
| `src/host/render/entities.ts` | Ball + blob shadow + trail; the two player rigs | no |
| `src/host/render/effects.ts` | Particle pool and shockwave rings | no |
| `src/host/render/ui.ts` | DOM score overlay | no |
| `src/host/index.html` | `#scene` canvas, `#ui` div, loads `main.ts` | — |

The split is deliberate: `loop.ts` is the one piece of the visual stack that
is pure, and it is the highest-value code in it, so it is the one thing tested.
Everything else is DOM- and canvas-shaped wiring (`CLAUDE.md` §3,
[[0003-threejs-renderer]]).

## The frame

```
frame(now)
  frameDt = now - lastTime
  advance(accumulator, frameDt) → { ticks, accumulator, alpha }
  repeat ticks times:
      input = pending.shift()          ← at most ONE swing per tick
      previous = current
      current  = tick(previous, input ? [input] : [], FIXED_DT)
      frameEvents += detectEvents(previous, current)
      send feedback hit|miss for that swing; point if score changed
  renderer.render(previous, current, alpha, frameDt, frameEvents)
  clear frameEvents
```

**One input per tick, drained oldest first**, rather than dumping a frame's
whole queue into its first tick. That keeps a 1:1 tick-to-swing relationship
so a `hit`/`miss` message can be attributed to the exact swing that caused it,
at a cost of up to one tick (~8ms) when two swings land in the same frame —
imperceptible, and doubles are out of scope.

**Events are accumulated across every tick in a frame**, not read off the last
one, or an event is lost whenever two ticks land in one rAF frame.

## `advance` — the three numbers it returns

`FIXED_DT = 1/120`. `MAX_CATCHUP_TICKS = 5`, and on overflow the backlog is
**dropped to zero** rather than carried, or the next frame faces the same
overflow again. A tab restored from suspension
([[ios-safari-tab-suspension]]) would otherwise try to run 360 ticks in one
frame. Deleting that cap has been watched failing its test.

`alpha` is the leftover fraction, always in `[0, 1)`. Rendering a fixed-step
sim without interpolating by it is what makes it judder, whatever the
materials look like.

## How the renderer learns what happened

`MatchState` carries no "a bounce happened this tick" flag. `stepBall`'s
`net`/`bounce` results are consumed inside `rally.ts` and never surface, and
growing the pure sim's public shape for a cosmetic need was rejected
([[0003-threejs-renderer]]).

Instead `detectEvents(before, current)` is a **pure diff of two consecutive
tick states**, mirroring the derivation `main.ts` already uses:

| Event | Derived from |
| --- | --- |
| `hit` | `before.toHit !== current.toHit` |
| `point` | `before.score !== current.score` (reference inequality) |
| `bounce` | `v.y` sign flip with `p.y < BOUNCE_HEIGHT` — a **heuristic**, visual only |

The bounce heuristic can produce a false positive and that costs nothing,
because it only ever drives a particle burst.

## Renderer rules — the ceiling on how this is built

Carried forward from the simulation plan's phase 8, in priority order. They
are what keeps frame time steady; breaking one shows up as periodic hitching,
not as an error.

1. **Interpolate.** Every visual reads `lerp(previous, current, alpha)`.
   Nothing reads sim state directly.
2. **Zero allocation in the frame loop.** Geometries, materials and vectors
   are built once at setup; per frame only `.position`, `.rotation` and
   `.scale` are mutated. No `new THREE.*` inside rAF, ever. This is the
   difference between steady frame time and GC hitches, and hitches are what
   "not smooth" means.
3. **A blob shadow, not a shadow map.** A flat dark circle under the ball,
   scaled and faded by height. Free, and at this ball size it reads better
   than a real soft shadow — it is the primary cue for judging an approaching
   ball. `WebGLRenderer.shadowMap` is off.
4. **Ball trail as a ring buffer** of past interpolated positions, one
   `InstancedMesh`. Cheap, and it does most of the "looks expensive" work.
5. **Procedural primitives only.** No artist, no sprites — which also
   satisfies `PRODUCT.md`'s "own assets only" for free. Court lines are nine
   segments in one `InstancedMesh`, one draw call.
6. **No post-processing.** The gradient background, fog and ACES tone mapping
   do the atmospheric work a bloom pass would buy, at no frame cost.
7. **Camera fixed high behind the near baseline**, with a small eased lateral
   drift toward the ball. Ease it, never cut. A camera that follows the hitter
   flips the world every shot and disorients both players; a side-on broadcast
   view is fairer but removes the depth cue the whole game is built on.

The net mesh's top edge literally calls `netHeightAt(x)` per vertex, so the
sag on screen is the same sag the physics uses rather than a decoration.

The ball is drawn at **2.6× its physical radius** — a real 3.35cm ball is
invisible from this camera. "Feel beats fidelity."

## Invariants

- `src/host` compiles under `tsconfig.web.json` only: DOM yes, Node no.
- The renderer **reads simulation state and never writes it.** There is no
  renderer interface and no abstraction layer — one implementation.
- The trail's ring buffer uses a local mutable `{x,y,z}`, not `Vec3`, because
  `Vec3` is all-`readonly` by design. It is not a sim type and never crosses
  back into `src/shared`.

## Not verified on real hardware

No session has yet run `npm run dev`, opened the host page and watched a rally.
The module graph is confirmed to resolve and the build is green, but "does it
look good, does it hold 60fps, are there console errors" is **unchecked**, and
so are phase 9's tuned constants ([[2026-09-20-shot-envelope]]). This is the
top of the manual to-do list.

Also unresolved by anything: **nothing decides who serves first.** `main.ts`
starts the match with `createMatch("near")` because no lobby UI exists
(`src/host/ui/` is a `.gitkeep`) and the wire protocol has no message for it.

## See also

[[architecture]] · [[modules/shared-sim]] · [[0003-threejs-renderer]] ·
[[0002-host-authoritative-simulation]] · [[ios-safari-tab-suspension]] ·
[[coordinate-frame]]
