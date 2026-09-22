---
title: "Module: src/shared/sim — the game"
updated: 2026-09-22
tags: [module, sim, core]
status: current
code:
  - `src/shared/sim/`
  - `src/shared/sim/rally.ts`
  - `src/shared/sim/ball.ts`
  - `src/shared/sim/shot.ts`
  - `src/shared/sim/serve.ts`
  - `src/shared/sim/court.ts`
  - `src/shared/sim/players.ts`
  - `src/shared/sim/scoring.ts`
  - `src/shared/sim/state.ts`
  - `src/shared/sim/bot.ts`
  - `src/shared/sim/index.ts`
---

# Module: `src/shared/sim` — the game

Pure, deterministic tennis. One entry point, `tick(state, inputs, dt)`. No
DOM, no Node, no clock, no RNG — see [[0002-host-authoritative-simulation]]
for why, and [[architecture]] for where it sits. **How a swing meets the ball
is [[0015-contact-model]]; where it then goes is
[[0016-stroke-decides-direction]]. Read both before changing anything below.**

## Files

| File | Holds |
| --- | --- |
| `src/shared/sim/rally.ts` | `tick`, `MatchState`, the phase machine, the contact model (plan, arm, strike, rewind, revise), point resolution |
| `src/shared/sim/shot.ts` | Timing windows, `timingOf`, `SCREEN_LEFT`, and the launch solvers `groundstroke` / `smash` / `serveShot`. The feel core |
| `src/shared/sim/serve.ts` | The toss, `TOSS_APEX`, deuce/ad positions and serve aim |
| `src/shared/sim/players.ts` | `predictStrike` — where and when a player meets the ball, including the overhead chance at `SMASH_HEIGHT`; stance, recovery, `movePlayer` |
| `src/shared/sim/ball.ts` | `stepBall` — integration, net and bounce crossings |
| `src/shared/sim/court.ts` | ITF geometry, `netHeightAt`, `isInBounds`, `isInServiceBox` |
| `src/shared/sim/scoring.ts` | `awardPoint`, `Score`, tiebreak rotation |
| `src/shared/sim/state.ts` | `Vec3`, `Ball`, `Player` (`{side, x, z}`) — flat readonly data |
| `src/shared/sim/bot.ts` | `createBot(side, skill)` — the solo opponent. **Not part of `tick`** |
| `src/shared/sim/index.ts` | Barrel re-export. No logic |

## Internal wiring

```
rally.ts  ── imports ──▶  ball.ts     (stepBall)
   │                      court.ts    (isInBounds, isInServiceBox)
   │                      players.ts  (predictStrike, standFor, homeFor, strokeFor, movePlayer)
   │                      serve.ts    (toss, serveSetup, serveTargetX, serveTiming)
   │                      shot.ts     (groundstroke, smash, serveShot, timingOf, windows)
   │                      scoring.ts, state.ts, ../protocol.ts
serve.ts  ── imports ──▶  ball.ts, court.ts, scoring.ts (types), shot.ts (forwardOf, rightOf)
shot.ts   ── imports ──▶  ball.ts (stepBall — the solver flies the real physics), court.ts
players.ts ── imports ──▶ ball.ts (stepBall — the SAME physics), court.ts
bot.ts    ── imports ──▶  rally.ts (MatchState type), serve.ts (TOSS_APEX),
                          shot.ts (SCREEN_LEFT, TIMING_IDEAL), players.ts (SMASH_HEIGHT)
```

Nothing in `sim/` imports anything outside `src/shared/`. The consumers are
`src/host/main.ts` and `src/host/render/` — see [[modules/host]].

## What one `tick` does, in order

1. Freeze if `score.setWinner` is set; set up the next serve if `point-over`.
2. Apply every `RallyInput`, each at its **swing time** (arrival − `lag`):
   toss / serve, arm, strike (rewinding), revise, or ignore. The stroke
   played is the swing's `kind`; an overhead at a bounced contact is a whiff.
3. Fire an armed swing if the ball has reached the contact.
4. Step the ball — the toss while serving, otherwise `advanceBall`
   (`stepBall` + `resolveStep`).
5. Plan or keep `contact`.
6. Move players: the one to hit waits `REACTION` after the opponent's strike,
   then runs to stand beside the contact; the other walks home at `RECOVERY`.
7. Advance `time`.

## Invariants — break these and something fails silently

- **`tick` returns a new `MatchState`.** The renderer interpolates between the
  previous state and this one, and `score` / `stroke` reference inequality
  means "changed" in `main.ts` and `events.ts`.
- **Nothing non-deterministic enters `tick`.** The two-bot full-set replay in
  `rally.test.ts` is the regression net for every tuning change.
- **A swing is compared with the frozen contact, never a fresh prediction.**
  Re-predicting at arrival is the bug that made every return whiff
  ([[0015-contact-model]]). The contact freezes on the receiver's bounce or when
  its moment arrives; after that nothing re-plans it.
- **Anything judged against the window uses swing time, not arrival.** `revise`
  once used arrival and played late swings as their backswing.
- **A rewind goes through `advanceBall`**, not a bare `stepBall`, so a rewound
  ball can still hit the net or bounce inside the fast-forward.
- **Every predictor and solver reuses `stepBall`**, with the env of the shot in
  question (`envForSpin`). `shot.ts` lands balls on target only because it flies
  the same integrator at the same step the live ball does.
- **`stroke.at` identifies a shot.** A new `at` is a new hit; the same `at` with
  a new object is a `revise` — `events.ts` and `main.ts` both rely on it to
  avoid a second animation, sound and "hit" buzz.
- **The stroke played is the phone's `kind`, never `contact.stroke`.**
  `contact.stroke` is the stance the player ran to — the renderer's ready
  pose — and nothing else. `strokeOf` in `rally.ts` is the one place a swing
  becomes a stroke: `serve` mid-rally falls back to the stance, and
  `overhead` needs `contact.air`. `revise` goes through it too, so a harder
  peak can change the stroke but never smash a bounced ball.
- **Direction is screen space** (`SCREEN_LEFT`), not the hitter's frame. The
  bot's choice of stroke depends on the same constant; change one without
  the other and the bot aims at its opponent.
- `stepBall` reports **at most one** of `net` or `bounce` per step.

## The bot is an input source, not a simulation feature

`tick` has never heard of it. `main.ts` calls `bot.swing(state)` once per tick
and queues what comes back exactly where a phone's swing goes, judged by the
same contact model. It tosses after `SERVE_DELAY`, hits at `TOSS_APEX`, and for
a rally ball commits once to a timing error, then — at the moment it swings —
picks the stroke that sends the ball away from its opponent, or an overhead
for a high air ball. Skill is a **timing spread** (σ 0.15s at 0 → 0.02s at 1,
a sum of three hashes so it is roughly normal and replays exactly); its
errors are whatever the shot rules make of that, as a person's are. The
0015 error *rate* is gone ([[2026-09-22-stroke-direction-balance]]).

Two skill-1 bots now finish sets on winners; 0.85 v 0.6 and 0.95 v 0.5 are
won by the better bot, 0.7 v 0.7 is even. Solo mode plays 0.65.

## Constants, and which kind each is

| Kind | Where | Change them how |
| --- | --- | --- |
| **Cited** — ITF rulebook figures | `src/shared/sim/court.ts` | Only if the rulebook is wrong |
| **Derived** — from the ball's own physical numbers | `DRAG_K` in `src/shared/sim/ball.ts` | Redo the arithmetic in its comment |
| **Balance** — tuned against a simulated human | `src/shared/sim/shot.ts`, `src/shared/sim/players.ts`, `REACTION` in `src/shared/sim/rally.ts`, `src/shared/sim/bot.ts` | Re-run the harness in [[2026-09-22-stroke-direction-balance]] (it extends [[2026-09-22-contact-model-feel]]'s); they interact |
| **Calibration** — needs a real phone and screen | `TIMING_IDEAL` in `src/shared/sim/shot.ts` | Tune by whether on-time swings go down the middle |

The balance constants are coupled: movement speed, reach, reaction, recovery,
pace and `SAFE_TIMING` together decide whether points end by winners, by
errors, or not at all. Changing one alone was measured to do nothing.

## Traps this module has already sprung

- **Predicting at arrival.** See the invariants; cost every return in the game.
- **The old ground strike (1.4m behind the bounce)** sent receivers sprinting
  at fast balls they would naturally let come to them. Now the ball is taken
  where it drops back to `STRIKE_COMFORT`.
- **Stepping the net-lift angle coarsely** made a harder swing fly slower than
  a softer one. The lift is a bisection on the least angle that clears.
- **Two bots on the same 8-long noise cycle** traded deuce forever.
- **Symplectic Euler is not good enough.** `stepBall` uses the exact
  constant-acceleration form, same multiplies, exact in a vacuum.
- **A bounce must reflect the contact velocity**, not the end-of-tick one.
- **The net sags, and a test that crosses at `x = 0` cannot see it.**
- **The held serve ball walks both players backwards** if anyone predicts from
  it. Nobody moves during `waiting-serve`.
- **A test that restates a derived identity can never fail.** Two were deleted.
- **Pace is a knife-edge under auto-movement** when every shot lands in the
  same place: median 27 m/s made every ball a winner, 23 m/s made nobody
  beatable. The gradient comes from timing changing *both* width and pace.
- **A smash plan flipped back to a groundstroke** while the player stood
  under the ball: its reaction slack was being charged with no running left
  (`canSmash`).

## Deliberately not modelled

Manual movement (`PRODUCT.md` scope); lets as replays; foot faults; doubles;
best-of-three; a spin vector or Magnus force (spin is a gravity multiplier).

## See also

[[architecture]] · [[0015-contact-model]] · [[2026-09-22-contact-model-feel]] ·
[[tennis-scoring]] · [[coordinate-frame]] ·
[[0002-host-authoritative-simulation]] ·
[[0007-host-arrival-time-for-swing-timing]] ·
[[0013-detector-latency-is-compensated]] · [[0014-players-run-to-the-ball]] ·
[[modules/host]]
