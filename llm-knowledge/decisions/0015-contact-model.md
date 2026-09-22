---
title: The contact model — every swing is judged against one frozen meeting with the ball
updated: 2026-09-22
tags: [decision, sim, input, swing, core, feel]
status: current
code:
  - `src/shared/sim/rally.ts`
  - `src/shared/sim/shot.ts`
  - `src/shared/sim/serve.ts`
  - `src/shared/sim/players.ts`
  - `src/shared/sim/bot.ts`
  - `src/shared/swing/stream.ts`
  - `src/host/render/entities.ts`
---

# 0015 — The contact model

Settled on 2026-09-22 after the user reported that **only the serve ever
connected**. Rebuilt with explicit permission to overturn earlier decisions,
toward "play like Wii Tennis". **Supersedes [[0012-swing-kind-is-the-shot-direction]]
and [[0009-streaming-swing-detection]]**; restores timing-as-direction from
[[0008-timing-not-aim-for-shot-direction]] in a different form; keeps
[[0007-host-arrival-time-for-swing-timing]] and
[[0013-detector-latency-is-compensated]]. The numbers are in
[[2026-09-22-contact-model-feel]].

## Why returns never connected

`applySwing` re-ran `predictStrike` **at the moment the swing arrived**. The
detector announced a swing a median 200ms after its peak, so a perfectly timed
swing arrived after the ball had passed the contact point, and the predictor —
walking forward from the ball's *current* position — found a new "air strike"
0.35-0.55s further on. The back-dated swing was measured against that and read
as **650ms early**: a whiff. Latency compensation (0013) was correct and
useless, because the thing it was compared with had moved. The serve has no
timing, so it always worked.

## Decision

**1. One contact per incoming ball, frozen.** `MatchState.contact` holds where
and when the player to hit will meet the ball. It is re-planned every tick
while the ball is in flight (a net clip changes it) and frozen once the ball
bounces on their side or the moment arrives. Every swing is judged against it
at the time the swing *happened* (arrival − `lag`).

**2. Early swings wait; late swings rewind.** A swing up to `TIMING_EARLY`
before contact is held (`armed`) and struck at the contact point when the ball
gets there. A swing up to `TIMING_LATE` after it is resolved by rewinding:
struck from the contact point at the contact time and flown forward to now
(`fastForward`, through the same `advanceBall` the tick uses, so a rewind can
still find the net). The renderer draws the rewound ball starting on the racket
and closing on the sim's over 60ms, so it reads as a fast ball, not a jump.

**3. The hardest swing in the window wins.** One real swing is several peaks
on the phone — backswing, swing, follow-through. A harder swing replaces an
armed one; a harder swing that *happened* inside the window after a weaker one
already struck re-strikes the same ball (`revise`). Judged on swing time, not
arrival — the first version used arrival and silently played late swings as
their backswing.

**4. Direction is timing, the Wii rule.** Early pulls the ball across the body,
late pushes it the other way. **Forehand or backhand comes from where the ball
is**, not from the phone: the phone's `kind` is sent and ignored. Only the edge
of the window (`|u| > SAFE_TIMING`) aims past the line.

**5. Every launch is solved to land where it was aimed.** `shot.ts` flies
candidate launches through `stepBall` and bisects: groundstrokes take an angle
from power and solve the speed for the target depth, lifting by the least that
clears the net; serves take a speed from power and toss timing and solve the
angle, shedding pace until they clear. Spin changes the flight's shape, not
where it lands.

**6. The serve is toss-then-hit.** First swing tosses, the next one hits it;
hitting at the top of the toss is fastest. A toss nobody hits is caught and
costs nothing. The server alternates deuce and ad court.

**7. The phone announces a swing at its peak** (`stream.ts`): median ~50ms
after it, p90 ~84ms, against 200/334ms before.

## Alternatives rejected

- **Keep predicting at arrival, only shorten detector latency.** Any residual
  lag, including the unmeasured network hop, still lands after the contact for
  a well-timed swing. The contact has to be allowed to be in the past.
- **Delay every hit until the window closes, then pick the best swing.** Adds
  `TIMING_LATE` of visible lag to every shot, including the well-timed ones.
- **Keep the phone's forehand/backhand classifier deciding direction (0012).**
  94.5% at best on the fixtures means one shot in twenty goes the wrong way,
  and the peak detector sees less of the swing than the old hold did.
  Auto-selecting the stroke is what Wii Tennis does.
- **Keep the sustained-rotation gate on the phone.** It cannot be checked at
  the peak: backhands rise in 66-183ms, gestures in 11-134ms. See trade-offs.

## Trade-offs accepted

- **Gestures and walking now fire on the phone.** The host ignores a swing
  unless a ball is at the player's contact or they are serving (a stray swing
  there tosses the ball, which is caught). The phone also only sends while the
  match is `playing`. Idle and pocket traces still never fire — that is the
  `PRODUCT.md` bar.
- **A double fault is practically impossible** — serves are solved into the
  box. Faults remain in the rules for a net clip or an edge case.
- **Balance constants are tuned against a simulated human**, not a real one:
  `REACTION`, `PLAYER_SPEED`, `RECOVERY`, `HIT_REACH`, `SAFE_TIMING`, the bot's
  `ERROR_RATE`. `TIMING_IDEAL` (40ms) is a calibration knob for network plus
  display latency and has not been measured.
