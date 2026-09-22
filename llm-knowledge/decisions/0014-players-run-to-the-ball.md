---
title: Players run to the ball, and one predictor says where and when
updated: 2026-09-22
tags: [decision, sim, movement, core]
status: current
code:
  - `src/shared/sim/players.ts`
  - `src/shared/sim/state.ts`
  - `src/shared/sim/rally.ts`
  - `src/shared/sim/bot.ts`
---

**Amended by [[0015-contact-model]] (2026-09-22).** `predictStrike` is still the one answer, but it is now frozen into `MatchState.contact`; the ground strike is where the ball drops back to waist height, not 1.4m behind the bounce; players wait `REACTION` before running and recover at half speed.

# 0014 — Players run to the ball, and one predictor says where and when

Settled on 2026-09-21. The user's brief was "it should play exactly like Wii
Tennis — players move to the ball in the field", and the answer turned out to
be less about movement than about there being a single source of truth for
where a player meets the ball.

## Decision

**`Player` gains `z`.** It was `{ side, x }`: a player slid along their own
baseline, and `applySwing` took contact at the ball's position wherever the
avatar happened to be. The avatar was decoration.

**One function, `predictStrike`, answers both questions at once** — where the
player will meet the ball, and when — and `rally.ts`'s timing, `movePlayers`'s
steering, `bot.ts`'s planning and the renderer all read that same answer. The
old pair (`predictCrossingX` for feet, `predictCrossingTime` for timing) could
disagree about the same ball; this cannot.

**It chooses between playing the bounce and volleying on reachability.** Walk
the real trajectory. The *ground strike* is `STRIKE_BACK_OFF` behind the first
bounce on this player's side; the *air strike* is the first moment the ball is
over their half at a height a racket reaches. Take the ground strike whenever
the player can get behind it in time; otherwise volley.

That last part is the whole design. There is no rule about when a volley is
allowed, no flag, no "am I at the net" check — it is the decision a real
player makes, and it falls out of asking "can I get there".

## Why a reachability test rather than a volley mode

The cases that have to work are a deep drive past a player caught in after a
drop shot, a ball that would bounce behind the baseline, and an ordinary
groundstroke — and they differ only in whether the bounce is reachable. Any
rule naming the *situations* would have to enumerate them and would be wrong
at the fourth one.

## The three bugs it took to get right

All three were found by instrumenting a rally that had gone quiet, not by
reading the code, and all three are the kind that look like a deadlock.

1. **The predictor did not know the ball had already bounced.** After the
   serve bounce it went hunting for the *next* bounce, which was behind the
   baseline. `alreadyBounced` (the caller's `bounces > 0`) removes the ground
   option entirely: a second bounce loses the point, so there is only a volley
   to find.
2. **The ground strike's time used the player's speed to cover the back-off,
   not the ball's.** The ball is doing 20 m/s and the player 8, so every
   contact was about 130ms late — a quarter of the miss window, on every
   groundstroke. Fixed by walking the trajectory *on* to the strike spot
   instead of adding a guessed offset, which also yields the true contact
   height for free.
3. **Reachability demanded the player's feet be exactly on the ball.** A ball
   moving away at 20 m/s from a player running at 8 can never satisfy that, so
   a receiver standing 1.2m from the ball was judged unable to touch it, and
   went on rejecting it until the candidate was clamped against the back
   fence. `STRIKE_REACH = 1.2` — a racket plus a lean.

## Two things that only appear once players move

- **The held serve ball walks everyone backwards.** It is stationary in the
  server's hand, so a predictor walking its trajectory sees it drop to the
  server's own feet and sends *both* players to meet it. `movePlayers` returns
  early during `waiting-serve`.
- **A fixed sideways shot velocity stops working.** Covered in
  [[0012-swing-kind-is-the-shot-direction]]: it landed out at all 20 powers
  from `x = +3`. Movement is what forced the shot model to aim at a place.

## Alternatives rejected

- **Moving the avatar in `z` for looks, with timing still judged at the
  baseline.** Smaller and safer, and it leaves the run-up as decoration —
  which is the thing being fixed.
- **Keeping `predictCrossingX` / `predictCrossingTime` and adding a third
  predictor for volleys.** Three answers to one question, two of which are
  wrong whenever the player is not on their baseline.
- **A closed-form intercept solve.** `players.ts` has reused `stepBall` since
  phase 4 precisely so the place a player runs to can never be somewhere the
  ball does not go. A closed form would need its own drag and bounce model.

## Consequences

- **`movePlayer` caps on distance, not per axis.** Capping each axis
  separately would make a diagonal run 1.41x faster than a straight one.
- `predictCrossingX` and `predictCrossingTime` survive for tests and for
  `camera.ts`'s framing; the sim no longer uses either for a player.
- The strike point is clamped to the player's own half plus `RUN_BACK` and
  `RUN_WIDE`. Nobody walks through the net.

## See also

[[0012-swing-kind-is-the-shot-direction]] · [[modules/shared-sim]] ·
[[coordinate-frame]] · [[architecture]]
