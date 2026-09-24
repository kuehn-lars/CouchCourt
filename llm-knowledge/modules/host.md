---
title: "Module: src/host — the Mac display"
updated: 2026-09-25
tags: [module, host, rendering]
status: current
code:
  - `src/host/main.ts`
  - `src/host/loop.ts`
  - `src/host/loop.test.ts`
  - `src/host/score-line.ts`
  - `src/host/score-line.test.ts`
  - `src/host/render/`
  - `src/host/ui/lobby.ts`
  - `src/host/ui/settings.ts`
  - `src/host/ui/dom.ts`
  - `src/host/ui/icons.ts`
  - `src/host/host.css`
  - `src/host/styles/`
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
| `src/host/score-line.ts` | `scoreLine(state)`: the score and serve as the phones show them (`MatchScore`) | **yes**, `src/host/score-line.test.ts` |
| `src/host/render/index.ts` | `createRenderer` — wires scene, court, stadium, officials, ball, players, effects, UI; turns events into swings, bursts, reactions, crowd mood | no |
| `src/host/render/events.ts` | `detectEvents`, `strokeAnim` — which animation a stroke plays | **yes**, `src/host/render/events.test.ts` |
| `src/host/render/camera.ts` | Every camera as plain numbers: `cameraPose` (three match modes), `attractPose` (lobby crane), `splitPose` (one half per player), `victoryPose` (orbit the winner) | **yes**, `src/host/render/camera.test.ts` |
| `src/host/render/poses.ts` | Joint layout, authored poses and clips, `sample`/`mix`/`mixUpper`, `gait`, `strokeEntry`. No Three.js | **yes**, `src/host/render/poses.test.ts` |
| `src/host/render/scene.ts` | Renderer, lights, shadow map, environment map, fog; two eased camera rigs; shake; adaptive pixel ratio | no |
| `src/host/render/post.ts` | Views pass (1 or 2 viewports, shadow map once), bloom, output, grade | no |
| `src/host/render/sky.ts` | Night dome: gradient, horizon haze, stars | no |
| `src/host/render/toon.ts` | `toon()` cel material with stepped rim; `outline()` inverted hull | no |
| `src/host/render/textures.ts` | Every texture, drawn on a 2D canvas at startup | no |
| `src/host/render/court.ts` | Surface, wordmarks (the far one turns for split), lines, net, posts | no |
| `src/host/render/stadium.ts` | Walls and LED boards, tiered bowl, ribbon board, roof ring, floodlight towers and beams | no |
| `src/host/render/crowd.ts` | The crowd (one instanced mesh, animated in the vertex shader) and camera flashes | no |
| `src/host/render/athlete.ts` | The articulated rig; grounds its own feet | no |
| `src/host/render/players.ts` | The two players: layered animation, swing smear, ponytail spring, reactions | no |
| `src/host/render/officials.ts` | Chair umpire and four ball kids, heads following the ball | no |
| `src/host/render/ball.ts` | Ball, squash and stretch, crossed ribbon trail, blob shadow | no |
| `src/host/render/effects.ts` | Sparks, impact star, rings, dust, skid marks, confetti — fixed pools | no |
| `src/host/render/ui.ts` | Broadcast scorebug, the umpire's call, the note, the split-screen divider and half tags | `callFor` only, `src/host/render/ui.test.ts` |
| `src/host/ui/lobby.ts` | Title screen (join QR, two seats, how-to slides), countdown, "Play", pause, result | no |
| `src/host/ui/settings.ts` | `<dialog>` settings sheet and the two corner buttons; prefs in `localStorage` through `shared/prefs.ts` | parsing only, `src/shared/prefs.test.ts` |
| `src/host/ui/dom.ts` | `el`, write-on-change `setText`, reduced-motion-aware `play` | no |
| `src/host/ui/icons.ts` | Phosphor glyphs as `?raw` strings ([[0017-phosphor-icons-and-the-visual-system]]), plus the CouchCourt `logo` from `src/logo.svg` ([[0021-couchcourt-name-and-mark]]) | no |
| `src/host/host.css` | The page's one stylesheet: an ordered `@import` list that Vite inlines at build time | — |
| `src/host/styles/` | `base` (tokens, buttons, overlay), `lobby`, `match` (countdown, pause, result, scorebug, calls), `settings`, and `adapt` (narrow windows, reduced motion and transparency), which must stay last because its media queries override the rest | — |
| `src/host/audio/index.ts` | Synthesised hit / bounce / point. No asset files | no |
| `src/host/index.html` | `#scene` canvas, `#ui` div, loads `main.ts` | — |

The split is deliberate: `loop.ts`, `camera.ts`, `poses.ts`, `events.ts` and
`score-line.ts` are the pieces of the visual stack that are pure, they are the
highest-value code in it, and they are the things tested. Everything else is DOM- and canvas-shaped wiring
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
| `kind === "serve"` | `serve` — over the top from the trophy position |
| `kind === "overhead"` | `smash` — the same overhead, jumped (since 2026-09-24) |
| `air` | `volley` — a block, almost no backswing, over in a blink |
| otherwise | `forehand` / `backhand` (two-handed) |

`VARIATION` in `players.ts` then scales each one's speed by a cycled factor,
the same deterministic-variation trick `sim/bot.ts` uses. Two identical
forehands in a row read as a looping GIF.

The far player's rig is yawed by π, so every pose is authored once in the
player's own frame (`poses.ts` states it) and never mirrored per side.

### The rewound ball

A late swing is resolved in the past, so the ball the sim returns is already
down the court. On a `hit` event `ball.ts` starts the drawn ball at
`stroke.from` and closes on the sim ball with a 60ms time constant; a revised
hit does the same without a second swing, burst or buzz. A jump over 3m with
no hit is a new point and snaps (and clears the trail).

## Renderer rules — the ceiling on how this is built

Rebuilt 2026-09-24 ([[0018-stylised-stadium-renderer]]). Rules 3, 5 and 6 of
the original seven were overturned there; what holds now:

1. **Interpolate.** Every visual reads `lerp(previous, current, alpha)`.
   Nothing reads sim state directly.
2. **Zero allocation in the frame loop.** Geometries, materials, vectors and
   particle pools are built once; per frame only transforms, instance
   matrices, uniforms and pre-sized buffers are written. Hitches from GC are
   what "not smooth" means.
3. **Real shadows for people, a blob for the ball.** One 2048 directional
   shadow map fitted to the court, `autoUpdate` off, rendered once per frame
   by `post.ts` however many views. The ball's blob stays: it is the depth
   cue, directly under the ball.
4. **Trails are pre-sized buffers**: the ball's crossed ribbon, the racket
   smear. Both rewritten in place.
5. **Still procedural, no asset files.** Primitives, `toon()` materials,
   canvas-drawn textures. Own assets only, nothing to fetch.
6. **Bloom and a grade, and nothing else.** Half-resolution bloom above 0.92,
   `OutputPass`, a display-space grade. No SSAO, no outline pass.
7. **Cameras ease, never cut** — including the fly-in from the lobby crane,
   the split halves, and the victory orbit. Never flip the world to follow the
   hitter. The camera history is in [[2026-09-20-camera-framing]].

**The pixel ratio adapts** (`scene.ts`, `adapt`): 1.75 down to 0.8 on 1.5s of
slow frames, back up after 6s of fast ones. **Frame time is unmeasured on real
hardware.**

The net's top edge still calls `netHeightAt(x)` per vertex. The near plane is
1m (the court striped against the apron at 0.1 from the crane). The ball is
drawn at 4.2× its physical radius; players at 1.14×.

## How a stroke is animated

`players.ts` layers, lowest first: stance (ready while a point is live; the
server at ease until they toss), running or a side-shuffle driven by distance
covered, the coil into the stroke the sim has planned from 0.65s out (the
trophy position on a toss), then the stroke itself, or a reaction after a
point. Upper layers take only part of the legs (`mixUpper`).

A stroke is known only once the sim has struck the ball, so playback **joins
just before the contact frame** (`strokeEntry`), not at the start of the
clip. `strokeAnim` picks the clip: serve, **smash (the serve's overhead,
jumped)**, volley out of the air, else forehand or backhand. A toss cancels
any reaction still playing, because the pause after a point is one tick long.

## Split screen and the victory shot

`main.ts` passes a shot per frame: `"attract"` in the lobby, `"victory"` once
the match is over, `"split"` for a two-player match with the setting on, else
the chosen camera. A split match is fixed at `createMatch(server, true)` —
the sim needs it ([[0019-split-screen]]). The result screen is a lower third
so the victory orbit shows.

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

**Watched 2026-09-24** after the renderer rebuild: lobby crane, solo match,
two-phone split screen, a close-up of the athletes and the victory orbit
(through throwaway pages, deleted), no console errors. See
[[0018-stylised-stadium-renderer]] for what was changed as a result.

**Not watched:** anything on real hardware. Headless Chrome has no motion
sensors and renders through SwiftShader, so frame rate, the wake lock, and
reconnect-after-suspension are all still unverified.

**Harness traps, both costly:**

- **SwiftShader hides real-GPU bugs.** The composer's MSAA target rendered
  black on an M3 and correctly under SwiftShader
  ([[msaa-target-is-discarded-after-resolve]]). For renderer work, drive
  system Chrome with `--headless=new --use-angle=metal --enable-gpu` over
  CDP. That run measured 60fps (p95 16.7ms) in the lobby at 2880px wide.
- **A single NaN pixel flickers as a black rectangle** once bloom has spread
  it ([[nan-pixels-become-bloom-blocks]]). Clamp every `pow` base in a
  shader. It shows up on a few frames in a hundred, so screenshots miss it.
  Count NaNs in the HDR target instead.

- Chrome 153 no longer falls back to SwiftShader implicitly.
  `--use-gl=swiftshader` alone yields no WebGL context at all, `createScene`
  throws, and the host page dies — which looks exactly like a renderer bug
  and is not. Use `--enable-unsafe-swiftshader --use-angle=swiftshader`.
- `Page.captureScreenshot` times out at 1280x800 under SwiftShader ("GPU
  stall due to ReadPixels"). 800x520 is fine.
- Kill Chrome between runs. Controller tabs left open reconnect forever by
  design and silently re-take both lobby slots — recorded on 2026-09-20 and
  still true. A fake phone socket from a finished run is a ghost seat for
  the same reason: restart the dev server between runs.
- **A page that renders once after a long synchronous loop screenshots
  black.** A canvas is only presented when the task yields, and SwiftShader
  shader compiles take seconds. It looked like a NaN bloom bug for an hour.
  (Maybe it partly was the MSAA discard above; this was never re-checked.)
  Yield between frames (`setTimeout`) and wait for a done flag.

## See also

[[architecture]] · [[modules/shared-sim]] · [[0003-threejs-renderer]] ·
[[0002-host-authoritative-simulation]] · [[ios-safari-tab-suspension]] ·
[[coordinate-frame]] · [[2026-09-20-camera-framing]] ·
[[2026-09-21-camera-frames-a-moving-player]] ·
[[0014-players-run-to-the-ball]]
