---
title: "Module: src/shared/sim — the game"
updated: 2026-09-20
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
| `src/shared/sim/players.ts` | `predictCrossingX`/`Time`, `movePlayer` — automatic positioning |
| `src/shared/sim/scoring.ts` | `awardPoint`, `Score`, tiebreak rotation |
| `src/shared/sim/state.ts` | `Vec3`, `Ball`, `Player` — flat readonly data |
| `src/shared/sim/index.ts` | Barrel re-export. No logic |

## Internal wiring

```
rally.ts  ── imports ──▶  ball.ts     (stepBall)
   │                      court.ts    (BASELINE_Z, isInBounds, isInServiceBox)
   │                      players.ts  (predictCrossingX/Time, movePlayer)
   │                      scoring.ts  (awardPoint, initialScore, other)
   │                      shot.ts     (resolveShot, CONTACT_HEIGHT_REF)
   │                      state.ts, ../protocol.ts (Side, Swing)
   │
players.ts ── imports ──▶ ball.ts     (stepBall — the SAME physics, deliberately)
                          court.ts    (SINGLES_HALF_WIDTH)
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
5. Move both players toward their predicted crossing `x`.
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
- **`predictCrossingX`/`Time` reuse `stepBall`.** One physics implementation.
  A second approximate predictor would drift out of sync with the first, and
  the drift would read as bad feel rather than as a bug.
- **A player only moves along `x`.** `z` is derived from `side`; a player
  stands on their own baseline for the whole match. The receiver's baseline is
  therefore also the timing-target plane — there is nowhere else they could be.
- `stepBall` reports **at most one** of `net` or `bounce` per step, so those
  are separate branches in `resolveStep`, not a priority order. A tick that
  would do both defers the second by 8ms.

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
- **A test that restates a derived identity can never fail.** Two were deleted
  after mutation testing found them vacuous: "the net spans the singles court"
  (`NET_POST_X` is derived from `SINGLES_HALF_WIDTH`) and "reports where the
  ball landed, not where the tick ended" (the same number by construction).

## Deliberately not modelled

Deuce/ad service boxes (needs a server `x` that `Player` does not carry);
a receiver volleying a serve before it bounces (real tennis forbids it — here,
the moment anyone hits the ball the phase becomes `rally`); a serve toss or
rhythm minigame (a serve's timing error is hardcoded 0, since it is
self-initiated); foot faults, lets as replays, doubles, best-of-three.

## See also

[[architecture]] · [[tennis-scoring]] (the spec `scoring.ts` implements) ·
[[coordinate-frame]] · [[0002-host-authoritative-simulation]] ·
[[0007-host-arrival-time-for-swing-timing]] · [[2026-09-20-shot-envelope]] ·
[[2026-09-20-serve-reachability-recheck]] · [[modules/host]]
