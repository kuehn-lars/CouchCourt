---
title: Tennis scoring rules the sim implements
updated: 2026-09-19
tags: [reference, domain, rules]
status: current
code:
  - `src/shared/sim/`
---

# Tennis scoring rules the sim implements

Pinned here because scoring is pure, fiddly, and the easiest thing in the
project to get subtly wrong — and because "what should happen at deuce in a
tiebreak" should be answered once, not re-litigated each time a test fails.

This is the specification `src/shared/sim/scoring.ts` implements. If the code
and this note disagree, one of them is a bug; decide which and fix both.

## Points within a game

`0 → 15 → 30 → 40 → game`.

- Win a point at 40 with the opponent below 40: game.
- **40–40 is deuce.** Win a point from deuce: **advantage**. Win again: game.
  Lose it: back to deuce. There is no limit on how long this can run.

## Games within a set

First to 6 games, **and** at least 2 games clear.

- 6–0 through 6–4: set.
- 5–5: play on. 7–5 takes the set.
- **6–6: tiebreak.**

## Tiebreak

Scored in plain numbers, not 15/30/40.

- First to **7 points, at least 2 clear**. 7–5 wins; 6–6 plays on until someone
  leads by two.
- Serve rotation: the player who would serve the next game serves **one** point,
  then serve alternates every **two** points. Getting this wrong is the classic
  bug and it is invisible until someone who plays tennis watches a match.
- The tiebreak counts as one game, so the set ends 7–6.

## Match

v1 scope is a single set. Best-of-three is not in `PRODUCT.md` and should not be
built until it is.

## Serving

- Serve alternates every game.
- Two serve attempts. A missed first serve is a fault; a missed second is a
  double fault and loses the point.
- **A let is ignored: a serve that clips the net and lands in plays on**,
  decided before any simulation code was written and implemented in
  `sim/ball.ts`'s `stepBall`: when the ball's centre
  crosses the net plane still above the band (a clip, not a block), it
  carries on over, damped by `NET_CLIP_DAMPING`, rather than being treated as
  a fault. Real tennis replays a let; replaying it in a motion game means a
  player swings and nothing happens, which feels broken, so SwingCourt does
  not replay it.

## Deliberately simplified

Per the non-goals in `PRODUCT.md`, SwingCourt is not a simulation of tennis.
Not modelled, and not to be added without a reason:

- Foot faults, time violations, challenges.
- Doubles scoring — explicitly out of scope for v1.
- Advantage sets (no final-set tiebreak).
