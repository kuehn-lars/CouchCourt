---
title: "Module: src/host — the Mac display"
updated: 2026-09-21
tags: [module, host, rendering]
status: current
code:
  - `src/host/main.ts`
  - `src/host/loop.ts`
  - `src/host/loop.test.ts`
  - `src/host/render/`
  - `src/host/ui/lobby.ts`
  - `src/host/audio/index.ts`
  - `src/host/index.html`
---

# Module: `src/host` — the Mac display

Runs the authoritative simulation and draws it. The only part of the system
currently wired end to end.

## Files

| File | Holds | Tested |
| --- | --- | --- |
| `src/host/main.ts` | match state machine, rAF loop, socket wiring, the two state references, feedback | no — DOM and socket I/O |
| `src/host/loop.ts` | `advance(accumulator, frameDt)` — the fixed-timestep accumulator | yes, `src/host/loop.test.ts` |
| `src/host/render/index.ts` | `createRenderer` — wires scene, court, entities, effects, UI | no |
| `src/host/render/events.ts` | `detectEvents`, `strokeAnim` — the one pure file in the renderer | **yes**, `src/host/render/events.test.ts` |
| `src/host/render/camera.ts` | `cameraPose(mode, ball)` — pose and FOV per mode, as plain numbers | **yes**, `src/host/render/camera.test.ts` |
| `src/host/render/scene.ts` | Renderer, lights, gradient background, fog; eases toward `cameraPose` | no |
| `src/host/render/court.ts` | Static ground, lines, sagging net, posts | no |
| `src/host/render/stadium.ts` | Ground disc, tiered bowl, instanced crowd, floodlights | no |
| `src/host/render/entities.ts` | Ball + blob shadow + trail; the two player rigs and their four swing animations | no |
| `src/host/render/effects.ts` | Particle pool and shockwave rings | no |
| `src/host/render/ui.ts` | DOM score overlay in the top corners, and the umpire's call | `callFor` only, `src/host/render/ui.test.ts` |
| `src/host/ui/lobby.ts` | Join QR, roster, start/solo/rematch, countdown, winner | no |
| `src/host/audio/index.ts` | Synthesised hit / bounce / point. No asset files | no |
| `src/host/index.html` | `#scene` canvas, `#ui` div, loads `main.ts` | — |

The split is deliberate: `loop.ts` and `camera.ts` are the pieces of the
visual stack that are pure, they are the highest-value code in it, and they
are the two things tested. Everything else is DOM- and canvas-shaped wiring
(`CLAUDE.md` §3, [[0003-threejs-renderer]]).

## The match state machine

`main.ts` owns it. The server relays it and stores none of it
([[0002-host-authoritative-simulation]]).

```
lobby ──(Start / Play the machine)──▶ countdown ──(3s)──▶ playing
  ▲                                                          │
  └──────────────(Back to the lobby)──── over ◀──(setWinner)──┘
```

Each transition sends `{ t: "match", phase, server, winner? }`, which the
relay broadcasts to every phone.

**Who serves is decided here**, closing the gap this page used to record:
the first player to announce themselves ready serves. In solo, that player is
by definition the human. No coin toss (nobody can see one) and no toggle
(nobody is standing at the host screen).

**Solo mode** builds a `createBot(otherSide, 0.7)` and calls it once per
tick. Its swing is pushed onto the same `pending` queue a phone's swing lands
in, so there is exactly one path into the simulation — see
[[modules/shared-sim]].

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
| `hit` | `before.toHit !== current.toHit` **and** `current.stroke` is set |
| `point` | `before.score !== current.score` (reference inequality) |
| `bounce` | `v.y` sign flip with `p.y < BOUNCE_HEIGHT` — a **heuristic**, visual only |

The bounce heuristic can produce a false positive and that costs nothing,
because it only ever drives a particle burst.

`detectEvents` moved out of `index.ts` into its own `events.ts` on
2026-09-21, and the reason is the rule in `CLAUDE.md` §3: it had no test,
because it lived in a file full of THREE and canvas. It is the one pure thing
in the renderer, and it now decides **which swing animation plays** — not a
branch worth leaving unchecked. Nine tests; the volley branch watched failing
under mutation.

### Which animation, and where the stroke comes from

A `toHit` flip tells you *that* somebody hit it. It cannot tell you *what they
played* — the swing is long gone by then. So `MatchState.stroke` carries it
(side, kind, power, and whether it was taken out of the air), on exactly the
precedent `spin` set. `strokeAnim` maps it:

| `stroke` | animation |
| --- | --- |
| `kind === "serve"` | `serve` — over the top from behind the head, the slowest of the four |
| `air` | `volley` — a block, almost no backswing, over in a blink |
| otherwise | `forehand` / `backhand` — mirrored sweeps across the body |

`SWING_VARIATION` then scales each one's amplitude and duration by a cycled
factor, the same deterministic-variation trick `sim/bot.ts` uses. Two
identical forehands in a row read as a looping GIF.

The far player's group is already yawed by π, so the animations are authored
once in the player's own frame and never mirrored per side.

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
7. **Superseded 2026-09-20 — see [[2026-09-20-camera-framing]].** This rule
   used to read "camera fixed high behind the near baseline, with a small
   eased lateral drift". It is now three modes in `camera.ts`, cycled with
   `C`, and the default is a **long lens from a long way back** rather than a
   wide one from close in. The part of the old rule that survives: *ease,
   never cut*, and never flip the world to follow the hitter.

   What killed the old framing is a number. At 7.5m behind the baseline with
   a 55° lens, the far player is 31.5m away and the near player 7.9m, so the
   far player renders at **0.25x** the near player's height. The complaint
   "you can only see one character" is that ratio. 26m back with a 19° lens
   makes it 0.55.

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
- **The camera frames where players can *stand*, not where the court is.**
  They run from `NET_KEEP_OUT` to `BASELINE_Z + RUN_BACK` now, so a camera
  tuned to the baselines cuts them off — and a frustum test that checks chest
  height passes while the legs hang off the screen.
  [[2026-09-21-camera-frames-a-moving-player]].
- **The renderer reads `player.z`.** It used to place each rig at a constant
  baseline and interpolate `x` only.

## What has and has not been watched

**Watched, twice, in headless Chrome** (2026-09-20 and again 2026-09-21): the
lobby, the join QR, the countdown, a match played out with the scoreboard
ticking 0 all / 15 / 30 / 40 / Game, players running to the ball, and no
console errors on either page. Screenshots are what found the skewing
broadcast camera, the 0.25x far player, and the player framed with their legs
off the bottom of the screen.

**Not watched:** anything on real hardware. Headless Chrome has no motion
sensors and renders through SwiftShader, so frame rate, the wake lock, and
reconnect-after-suspension are all still unverified.

**Harness traps, both costly:**

- Chrome 153 no longer falls back to SwiftShader implicitly.
  `--use-gl=swiftshader` alone yields no WebGL context at all, `createScene`
  throws, and the host page dies — which looks exactly like a renderer bug
  and is not. Use `--enable-unsafe-swiftshader --use-angle=swiftshader`.
- `Page.captureScreenshot` times out at 1280x800 under SwiftShader ("GPU
  stall due to ReadPixels"). 800x520 is fine.
- Kill Chrome between runs. Controller tabs left open reconnect forever by
  design and silently re-take both lobby slots — recorded on 2026-09-20 and
  still true.

## See also

[[architecture]] · [[modules/shared-sim]] · [[0003-threejs-renderer]] ·
[[0002-host-authoritative-simulation]] · [[ios-safari-tab-suspension]] ·
[[coordinate-frame]] · [[2026-09-20-camera-framing]] ·
[[2026-09-21-camera-frames-a-moving-player]] ·
[[0014-players-run-to-the-ball]]
