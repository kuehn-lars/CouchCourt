---
title: "Module: src/shared/sim — the game"
updated: 2026-09-21
tags: [module, sim, core]
status: current
code:
  - `src/shared/sim/`
  - `src/shared/sim/rally.ts`
  - `src/shared/sim/ball.ts`
  - `src/shared/sim/shot.ts`
  - `src/shared/sim/court.ts`
  - `src/shared/sim/players.ts`
  - `src/shared/sim/scoring.ts`
  - `src/shared/sim/state.ts`
  - `src/shared/sim/index.ts`
---

# Module: `src/shared/sim` — the game

Pure, deterministic tennis. One entry point, `tick(state, inputs, dt)`. No
DOM, no Node, no clock, no RNG — see [[0002-host-authoritative-simulation]]
for why, and [[architecture]] for where it sits.

## Files

| File | Holds |
| --- | --- |
| `src/shared/sim/rally.ts` | `tick`, `MatchState`, the phase machine, point resolution |
| `src/shared/sim/ball.ts` | `stepBall` — integration, net and bounce crossings |
| `src/shared/sim/shot.ts` | `resolveShot` — swing + timing → outgoing velocity. The feel core |
| `src/shared/sim/court.ts` | ITF geometry, `netHeightAt`, `isInBounds`, `isInServiceBox` |
| `src/shared/sim/players.ts` | `predictStrike` — where and when a player meets the ball; `movePlayer`; `predictCrossingX`/`Time` |
| `src/shared/sim/scoring.ts` | `awardPoint`, `Score`, tiebreak rotation |
| `src/shared/sim/state.ts` | `Vec3`, `Ball`, `Player` (`{side, x, z}`) — flat readonly data |
| `src/shared/sim/bot.ts` | `createBot(side, skill)` — the solo opponent. **Not part of `tick`** |
| `src/shared/sim/index.ts` | Barrel re-export. No logic |

## Internal wiring

```
rally.ts  ── imports ──▶  ball.ts     (stepBall)
   │                      court.ts    (BASELINE_Z, isInBounds, isInServiceBox)
   │                      players.ts  (predictStrike, movePlayer)
   │                      scoring.ts  (awardPoint, initialScore, other)
   │                      shot.ts     (resolveShot, CONTACT_HEIGHT_REF)
   │                      state.ts, ../protocol.ts (Side, Swing)
   │
bot.ts    ── imports ──▶  rally.ts    (envFor, MatchState)
                          players.ts  (predictStrike — the SAME answer its feet follow)
                          shot.ts     (MISS_WINDOW)
players.ts ── imports ──▶ ball.ts     (stepBall — the SAME physics, deliberately)
                          court.ts    (SINGLES_HALF_WIDTH, BASELINE_Z)
                          ../protocol.ts (Side)
ball.ts    ── imports ──▶ court.ts    (BALL_RADIUS, NET_POST_X, netHeightAt)
shot.ts, scoring.ts, state.ts ──▶ ../protocol.ts only
```

Nothing in `sim/` imports anything outside `src/shared/`. The only consumers
are `src/host/main.ts` and `src/host/render/` — see [[modules/host]].

## What one `tick` does, in order

1. Freeze if `score.setWinner` is set.
2. If the phase is `point-over`, start the next point.
3. Apply each `RallyInput` — wrong-side inputs are ignored, and a swing past
   the miss window is a whiff that changes nothing.
4. If not `waiting-serve`, `stepBall` one step, then `resolveStep` decides
   whether the point ended.
5. Move both players toward their `predictStrike` point, in x **and** z —
   unless the phase is `waiting-serve`, when nobody moves (see the traps).
6. Advance `time` by `dt`.

Phases: `waiting-serve → serve-flight → rally → point-over`.

## Invariants — break these and something fails silently

- **`tick` returns a new `MatchState`.** Never mutate in place. The renderer
  interpolates between the previous state and this one, and two call sites use
  `score` reference inequality to mean "the score changed".
- **Nothing non-deterministic enters `tick`.** Wall clock, RNG seed and input
  timing are passed *in*. Breaking this breaks the replay test, which is the
  regression net for every tuning change.
- **`timingError` is recomputed fresh every tick**, against the ball's current
  trajectory, never cached from the moment of the last hit. That is what makes
  a net-clipped shot's timing correct for free, and it is why no
  `idealContactTime` field exists in state.
- **Every predictor reuses `stepBall`.** One physics implementation. A second
  approximate predictor would drift out of sync with the first, and the drift
  would read as bad feel rather than as a bug.
- **`predictStrike` is the single answer to "where and when".** A player's
  feet, the timing their swing is judged against, the bot's plan and the
  renderer's avatar all read it. Two functions answering that question is how
  a player ends up judged against a ball arriving ten metres behind them —
  which is what the old `predictCrossingX` (feet) plus `predictCrossingTime`
  (timing, at a fixed baseline) did the moment players could leave the
  baseline. See [[0014-players-run-to-the-ball]].
- **Whoever calls `predictStrike` must pass `bounces > 0`.** After one bounce
  a second loses the point, so there is no ground option left and only a
  volley to find. Omitting it sends the predictor hunting for the *next*
  bounce, which is behind the baseline, and the player stands there watching
  the ball go by.
- **Contact is `state.ball.p`, not the player's position.** The strike
  prediction says where they will be; the ball's actual height when the swing
  lands is what `resolveShot` needs, and a mistimed contact being genuinely
  high or low is the point.
- `stepBall` reports **at most one** of `net` or `bounce` per step, so those
  are separate branches in `resolveStep`, not a priority order. A tick that
  would do both defers the second by 8ms.

## The bot is an input source, not a simulation feature

`tick` has never heard of it. `src/host/main.ts` calls `bot.swing(state)`
once per tick and pushes whatever comes back onto the same `pending` queue a
phone's swing lands in. The bot reads the `MatchState` the renderer reads and
answers with the `Swing` a phone would send — no privileged access to
anything.

That matters because a bot `tick` special-cased would be a second way for the
ball to move, and the replay test rests on there being exactly one.

**Skill is a planned timing error.** The bot commits to a contact moment when
the ball starts coming — `time + predictStrike(...).t + error` — and stops
re-deciding, the way a player does. `shot.ts` turns being early or late into a
weak or mistimed shot with no further help.

The error's sign used to be the direction mechanic, which is why the bias
table alternates. It is not any more ([[0012-swing-kind-is-the-shot-direction]]):
direction comes from `Swing.kind`, which the bot picks from which side of its
body the ball is on. The alternating bias still earns its place — outside the
clean window the sign drives `MISHIT_SPRAY_MAX`, so a bot that was always a
little early would spray every mishit the same way.

Measured on 2026-09-21, points won by the far bot against a perfect
opponent: **4 / 6 / 17 / 31** at skill 0 / 0.3 / 0.7 / 1. Monotone, which is
the property `bot.test.ts` asserts. It used to assert "more score changes at
low skill", which reads backwards once a hopeless bot loses the set 6-0 in 28
points and *stops* while a perfect one is still at 6-6 after 55 — a completed
set is fewer score changes, not more.

Two skill-1 bots rally **indefinitely** — 273 hits and not one
point in 40,000 ticks. Against a 0.8 opponent, a 0.7 bot gives rallies of
about nine shots and an even match, which is why 0.7 is what solo mode uses.

## Spin bends gravity, per shot

`MatchState.spin` carries the in-flight ball's spin, and `envFor(state)`
turns it into `BallEnv.gravityScale` — the hook `ball.ts` always documented
("up to ~2.0 stands in for topspin") and nothing drove until 2026-09-20.

**Everything that looks at the ball's future must use the same `envFor`**:
the step itself, `predictCrossingTime` for swing timing, `predictCrossingX`
for player movement, and the bot. Using a different env in one of them means
predicting a trajectory the ball does not fly.

The coefficients are asymmetric — `SPIN_GRAVITY_TOP` 0.35, `SPIN_GRAVITY_SLICE`
0.15 — and the asymmetry is measured, not aesthetic:
[[2026-09-20-serve-that-lands]].

## Constants, and which kind each is

Three different kinds live here and they are not interchangeable:

| Kind | Where | Change them how |
| --- | --- | --- |
| **Cited** — ITF rulebook figures | `src/shared/sim/court.ts` | Only if the rulebook is wrong. A test cannot verify a citation |
| **Derived** — from the ball's own physical numbers | `DRAG_K` in `src/shared/sim/ball.ts` | Redo the arithmetic in its comment |
| **Tuned** — found by measurement | `src/shared/sim/shot.ts`, `COURT_RESTITUTION` | Re-run the envelope: [[2026-09-20-shot-envelope]] |

`sim/playability.test.ts` is the permanent net under the tuned ones. It
asserts an **envelope**, not exact numbers: a well-timed shot lands in ≥60% of
the power range, worst-case timing at max power essentially never lands, no
legal power reaches the far fence, a minimum-power serve clears the net.

It did **not** catch the serve being nearly unplayable. Only 7 powers in 35
landed in the service box, and nothing asserted anything about the serve's
own envelope — the fault fixtures in `rally.test.ts` were *using* the broken
range as their "lands long" and "nets" cases, so the bug had tests depending
on it. [[2026-09-20-serve-that-lands]] has the numbers and the fix; the
lesson is that a fixture chosen because it happens to fail is a fixture that
dies with the bug.

## Traps this module has already sprung

Each of these was found the hard way and cost real time. They are recorded
because the code that fixes them looks unremarkable.

- **Symplectic Euler is not good enough.** Its position error is ~4cm over a
  one-second flight at `dt = 1/120` — four times the accuracy budget, and
  *short*, so it reads as "drag is stronger than we thought" rather than as a
  bug. `stepBall` uses the exact constant-acceleration form `p += v·dt + ½a·dt²`,
  same number of multiplies, exact in a vacuum.
- **A bounce must reflect the contact velocity, not the end-of-tick
  velocity.** Getting this wrong makes the same shot bounce differently
  depending on where inside the tick it lands — invisible in any single
  measurement, and exactly the kind of thing that later gets "tuned" around.
- **The net sags, and a test that crosses at `x = 0` cannot see it.** Both
  original net tests crossed at the centre where the sag is zero, so a flat
  net passed everything.
- **A lofted slow shot can travel further than a flat fast one.** "Slower"
  does not imply "shorter" once drag is in the mix; `LAUNCH_ANGLE_MAX`'s own
  comment carries the warning.
- **The held serve ball walks both players backwards.** It sits stationary in
  the server's hand, so a predictor walking its trajectory sees it drop to the
  server's own feet and sends *everyone* to meet it. `movePlayers` returns
  early during `waiting-serve`. Only visible once players had a `z`.
- **A strike time is the BALL's travel time, not the player's.** The first
  version of the ground strike added `STRIKE_BACK_OFF / PLAYER_SPEED` — the
  time for the player to cover the back-off. The ball does 20 m/s and the
  player 8, so every groundstroke contact was ~130ms late, a quarter of the
  miss window, on every shot. Walk the trajectory instead of guessing an
  offset.
- **Reachability needs a racket's worth of slack.** Requiring the player's
  feet to be on the ball is unsatisfiable for a ball moving away faster than
  they run, so a receiver 1.2m from the ball was judged unable to touch it.
  `STRIKE_REACH` exists for that and nothing else.
- **A test that restates a derived identity can never fail.** Two were deleted
  after mutation testing found them vacuous: "the net spans the singles court"
  (`NET_POST_X` is derived from `SINGLES_HALF_WIDTH`) and "reports where the
  ball landed, not where the tick ended" (the same number by construction).

## Deliberately not modelled

Deuce/ad service boxes (needs a server `x` that `Player` does not carry);
manual movement (`PRODUCT.md` scope); a serve toss or
rhythm minigame (a serve's timing error is hardcoded 0, since it is
self-initiated); foot faults, lets as replays, doubles, best-of-three.

## See also

[[architecture]] · [[tennis-scoring]] (the spec `scoring.ts` implements) ·
[[coordinate-frame]] · [[0002-host-authoritative-simulation]] ·
[[0007-host-arrival-time-for-swing-timing]] · [[2026-09-20-shot-envelope]] ·
[[2026-09-20-serve-reachability-recheck]] ·
[[0012-swing-kind-is-the-shot-direction]] ·
[[0013-detector-latency-is-compensated]] · [[0014-players-run-to-the-ball]] ·
[[modules/host]]
