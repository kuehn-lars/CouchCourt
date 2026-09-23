---
title: "Module: src/host — the Mac display"
updated: 2026-09-23
tags: [module, host, rendering]
status: current
code:
  - `src/host/main.ts`
  - `src/host/loop.ts`
  - `src/host/loop.test.ts`
  - `src/host/render/`
  - `src/host/ui/lobby.ts`
  - `src/host/ui/settings.ts`
  - `src/host/ui/dom.ts`
  - `src/host/ui/icons.ts`
  - `src/host/host.css`
  - `src/host/raw.d.ts`
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
| `src/host/render/camera.ts` | `cameraPose(mode, ball)` — pose and FOV per mode — and `attractPose(seconds)`, the lobby's crane, as plain numbers | **yes**, `src/host/render/camera.test.ts` |
| `src/host/render/scene.ts` | Renderer, lights, gradient background, fog; eases toward `cameraPose` | no |
| `src/host/render/court.ts` | Static ground, lines, sagging net, posts | no |
| `src/host/render/stadium.ts` | Ground disc, tiered bowl, instanced crowd, floodlights | no |
| `src/host/render/entities.ts` | Ball + blob shadow + trail; the two player rigs and their four swing animations | no |
| `src/host/render/effects.ts` | Particle pool and shockwave rings | no |
| `src/host/render/ui.ts` | Broadcast scorebug (top-left), the umpire's call, the bottom note. `setVisible` hides it over the lobby rally | `callFor` only, `src/host/render/ui.test.ts` |
| `src/host/ui/lobby.ts` | Title screen (join QR, two seats, how-to slides), countdown, "Play", pause, result | no |
| `src/host/ui/settings.ts` | `<dialog>` settings sheet and the two corner buttons; prefs in `localStorage` through `shared/prefs.ts` | parsing only, `src/shared/prefs.test.ts` |
| `src/host/ui/dom.ts` | `el`, write-on-change `setText`, reduced-motion-aware `play` | no |
| `src/host/ui/icons.ts` | Phosphor glyphs as `?raw` strings ([[0017-phosphor-icons-and-the-visual-system]]) | no |
| `src/host/host.css` | Every style on the host page: tokens, lobby, scorebug, sheet | — |
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

**Solo mode** builds a `createBot(otherSide, skill)`, where skill comes from the
settings sheet and defaults to 0.65 ("Match") — a decent player wins
~57% of points against it, a newcomer ~43%
([[2026-09-22-stroke-direction-balance]]) — and calls it once per
tick. Its swing is pushed onto the same `pending` queue a phone's swing lands
in, so there is exactly one path into the simulation — see
[[modules/shared-sim]].

## The lobby is a title screen (2026-09-23)

While `phase === "lobby"` the court is not empty: **two bots rally on their
own `MatchState`** (`demo` in `main.ts`), rendered with the `"attract"`
camera shot. Nothing about it can leak into a match — separate state, no
audio, no feedback to phones, score overlay hidden (`ScoreUI.setVisible`,
which also forgets the last score so a new match's first score is not
"called"). A finished demo set starts another. Off in settings for laptops
on battery.

`attractPose(seconds)` is a slow crane swinging ±10° round a high
three-quarter view, with the look-at point pushed to the camera's left so
the court sits in the right of the frame and the join panel owns the left.
Its seven constants were **swept together** against the same projection the
tests use, then picked by eye. Two things the sweep had to be told:

- **MacBooks are 16:10, not 16:9.** The court's far corner went off the
  right edge in a 16:10 screenshot while a 16:9-only test passed. Every
  attract test now runs at both.
- **The panel edge is at -0.04 in NDC** (43.5rem of a 16:9 frame at the
  lobby's rem scale). A looser bound let the near player stand behind the
  seat cards.

Starting a match resets `current` to a fresh match *at the countdown*, so
the camera flies from the crane to the broadcast pose over a court that is
about to be played on.

**Settings** (`S`, or the gear): camera mode, the machine's level (Relaxed
0.4 / Match 0.65 / Tough 0.85 skill — only Match is measured,
[[2026-09-22-stroke-direction-balance]]), sound, lobby rally, full screen.
Keys ignore Cmd/Ctrl/Alt, so Cmd-F is still the browser's find.

## The frame

```
frame(now)
  frameDt = now - lastTime
  advance(accumulator, frameDt) → { ticks, accumulator, alpha }
  repeat ticks times:
      inputs = pending.splice(0)       ← every swing that has arrived
      previous = current
      current  = tick(previous, inputs, FIXED_DT)
      frameEvents += detectEvents(previous, current)
      "hit" to whoever struck a NEW stroke (stroke.at changed)
      on a score change: "point" to lastPoint, "miss" to the other side
  renderer.render(previous, current, alpha, frameDt, frameEvents)
  clear frameEvents
```

**Feedback is read off the state, not off the input** (since 2026-09-22). It
used to be one input per tick so a `hit`/`miss` could be pinned on the swing
that caused it — but under [[0015-contact-model]] an early swing is held until
the ball arrives, and one real swing arrives as several peaks, so the tick a
swing lands on says nothing about whether it connected. A revised stroke keeps
its `at` and does not buzz twice.

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
| `hit` | `current.stroke !== before.stroke`. Positioned at `stroke.from`, the contact point; `revised` when `stroke.at` is unchanged |
| `whiff` | `whiffs[side]` went up — the avatar swings at air |
| `toss` | `toss` went from `null` to set |
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
| `kind === "serve"` or `"overhead"` | `serve` — over the top from behind the head, the slowest of the four. A smash reuses it |
| `air` | `volley` — a block, almost no backswing, over in a blink |
| otherwise | `forehand` / `backhand` — mirrored sweeps across the body |

`SWING_VARIATION` then scales each one's amplitude and duration by a cycled
factor, the same deterministic-variation trick `sim/bot.ts` uses. Two
identical forehands in a row read as a looping GIF.

The far player's group is already yawed by π, so the animations are authored
once in the player's own frame and never mirrored per side.

### Readying, running, and the rewound ball (2026-09-22)

- **The racket coils before the ball arrives.** `PlayersCue.ready` carries the
  contact's side, stroke and seconds to go; from 0.65s out the arm eases into
  that stroke's start pose, fully coiled by 0.2s. The swing animation starts
  from exactly that pose, so readying and hitting join up. During the toss the
  server's racket is up behind the head.
- **Legs hang from hip pivots and swing with distance covered**, not time, so
  the feet never skate whatever speed the sim moves them.
- **A rewound ball is drawn from the racket.** A late swing is resolved in the
  past, so the ball the sim returns is already down the court. On a `hit`
  event `ball.update` starts the drawn ball at `stroke.from` and closes on the
  sim ball with a 60ms time constant; a revised hit does the same without a
  second swing, crack or buzz. A jump over 3m with no hit is a new point and
  snaps (and clears the trail).

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

**The near plane is 1m, not 0.1** (2026-09-23). The court sits 1mm above
the apron, and from the lobby crane at ~45m the depth buffer's precision at
0.1 was about 1.2mm, so the two planes striped. Precision scales with the
near plane and no camera comes within 6m of anything.

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

**Watched 2026-09-23** after the redesign, in headless Chrome over CDP with a
scripted phone: the lobby with its rally, seat states, solo start, countdown
and camera fly-in, the scorebug and auto-hiding corner buttons, the pause
screen on a dropped phone, and — through a throwaway harness page, deleted —
the result, settings and call states. Also the production build via
`vite preview`. No console errors. One unexplained run (a solo start that was
back in the lobby 9s later) did not reproduce in three attempts.

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
