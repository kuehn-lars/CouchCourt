---
title: A legal serve was never actually unreturnable — the earlier note was wrong
updated: 2026-09-20
tags: [experiment, sim, tuning, phase-9]
status: current
code:
  - `src/shared/sim/rally.ts`
  - `src/shared/sim/players.ts`
  - `src/shared/sim/ball.ts`
---

# A legal serve was never actually unreturnable

Supersedes [[2026-09-20-serve-reachability]]. That note's central claim — "no
swing they make can land inside the window, because there is no window" — does
not reproduce against the constants actually committed in phases 2-6. Left
here as the correction, and as a reminder that a hand-derived physics claim
needs the same treatment as any other guard: run it, don't reason about it.

## What the earlier note got wrong

It reasoned that a legal serve's first bounce loses so much energy that the
ball's *second* bounce lands short of the receiver's fixed baseline —
therefore the ball never reaches the plane `rally.ts` measures timing
against, therefore no swing can ever be well-timed.

Tracing `stepBall` for `resolveShot(swing("serve", 0.35), 0, contact, "near")`
directly (a throwaway `/tmp` script, same method as the original note, run
again rather than trusted from memory) shows the opposite: the first bounce
lands at `z ≈ -4.76` (tick 100 after the hit), the ball then **crosses the far
baseline (`z = -11.885`) at tick 155**, and only reaches its *second* bounce
at tick 188 — 33 ticks (0.275s) later. The crossing happens well before the
second bounce, not after it.

## The check that actually matters: can a swing connect?

Raw `stepBall` tracing only shows geometry; whether a swing lands inside
`resolveShot`'s miss window is a `tick()`-level question, so it was checked
there too, with a real `vitest` test driving `createMatch`/`tick` (deleted
after — throwaway, not the permanent playability suite):

- `far` returns `near`'s 0.35 serve cleanly when the return swing arrives on
  tick 160 — comfortably inside the window found below.
- Sweeping every legal serve power (0.28 to 0.46 — confirmed by driving each
  power to `rally` vs a `waiting-serve` fault) against every return tick 1-400
  found a **wide connecting window at every power: 58 to 80 ticks (0.48 to
  0.67 seconds), never zero.**

So the receiver's fixed baseline is not the trap the earlier note thought it
was. Nothing in `rally.ts`, `players.ts` or the phase-9 shot constants needed
to change for this.

## Why the earlier note was wrong

Best guess, not confirmed: the earlier note computed "the second bounce lands
well short of the baseline" without tracing the segment *between* the first
and second bounce, where the ball's residual horizontal velocity (still
~14-15 m/s after the first bounce, well above what drag alone would suggest
at a glance) carries it past the baseline before gravity and restitution
bring it down again. A hand estimate of "energy lost on one bounce" undercounts
how much horizontal speed survives that bounce unchanged — `COURT_RESTITUTION`
only scales the vertical component.

## What this means for phase 9

Reachability was never phase 9's actual problem — it doesn't have one to
solve. What the plan actually asks phase 9 to build,
`sim/playability.test.ts`'s envelope (well-timed shot lands in ~60%+ across
the power range, max-power/worst-timing essentially never lands, no legal
power reaches the far fence, minimum-power serve clears the net), is an
independent question from this one and is tracked in its own place once that
file exists.
