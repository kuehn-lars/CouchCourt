---
title: A legal serve is currently unreturnable — found building the rally machine
updated: 2026-09-20
tags: [experiment, sim, tuning, phase-9]
status: superseded
code:
  - `src/shared/sim/rally.ts`
  - `src/shared/sim/players.ts`
  - `src/shared/sim/court.ts`
---

**Superseded by [[2026-09-20-serve-reachability-recheck]] — the central claim
below does not reproduce.** Left in place, not deleted, so a session that
re-derives this doesn't waste an evening rediscovering the same wrong
conclusion; read the recheck note instead.

# A legal serve is currently unreturnable

Found empirically while scripting phase 6's replay test (a throwaway driver,
not a hand guess — see the session log,
`llm-knowledge/sessions/2026-09-20-0312-sim-phase-6.md`). Left here because it
is exactly what [[index]] flags as still needed for phase 9: a measured fact
about the current constants, not a bug in phase 6's wiring.

## The finding

[[0002-host-authoritative-simulation]]'s phase 4 already fixed that a player
only moves along `x`; **`z` stays pinned to their own baseline for the whole
match.** Combine that with the service box (`SERVICE_LINE_Z` = 6.4m from the
net) being less than a third of the singles court's own half (`BASELINE_Z` =
11.885m from the net), and: a serve that legally lands in the box, at any
power that keeps it legal (0.30–0.45 of the swing's power range, measured
against today's `shot.ts` constants), loses enough energy on that first
bounce that it double-bounces well before its residual horizontal velocity
ever carries it out to the receiver's fixed baseline plane.

Since `rally.ts` measures a swing's timing error against when the ball is
predicted to cross the receiver's baseline (the only plane the receiver can
ever be standing on), and the second bounce ends the point outright before
that crossing is ever reached, **the receiver's swing timing is irrelevant —
no swing they make can land inside the window, because there is no window.**
Every legal serve is a de facto ace under the current constants.

## Evidence

`resolveShot(swing("serve", 0.35), 0, contact, "near")` run through `stepBall`
to its bounce lands at `z ≈ -4.03` (server "near", so the far box is
`z ∈ [-6.4, 0]` — legal). Continuing that same trajectory through further
bounces, the second bounce lands well short of `z = -11.885` (the far
baseline) every time in the 0.30–0.45 legal-power range. A full replay
(`rally.test.ts`, "a full set, replayed") confirms the game-level consequence:
scripting "near always serves at 0.35, far always serves at 0.55 (a long
fault, so a guaranteed double fault)" — with **neither side ever attempting a
return** — deterministically reaches a 6–0 set for `near` in 4883 ticks.
Nobody wrote a return path into that script because there was no power level
found where one would land.

## What this is not

Not a phase 6 bug. `rally.ts`'s point resolution (second bounce, out of
bounds, net, fault) was mutation-tested and every guard fires correctly —
this is those correct guards acting on physics that phase 9 hasn't tuned yet.
Not a reason to change the phase 6 timing-target design (contact at the
receiver's own baseline) either: the receiver genuinely cannot be anywhere
else in this sim, so no other target would make a short serve reachable.

## What phase 9 needs to decide

Whichever of these (or a mix) makes serves feel like the product's "generous
input" bar rather than a lottery:

- Faster serves, so the box-legal power range also carries far enough
  post-bounce to reach the baseline before a second bounce.
- A shallower box-to-baseline ratio is fixed by the rulebook (it isn't — this
  is real geometry), so this one is not available.
- Less energy loss on the bounce for a served ball specifically (a serve-only
  restitution, or the general `COURT_RESTITUTION` raised) so the ball
  survives to a second bounce further out.

Whatever is chosen, `rally.test.ts`'s "a full set, replayed" test is the
regression net that will need its swing powers and expected tick numbers
re-derived afterward — not adjusted by guesswork, the same throwaway-driver
approach that found them the first time.

**Code map:** [[modules/shared-sim]]
