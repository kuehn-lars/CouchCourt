---
title: Power shots are earned
updated: 2026-09-27
tags: [decision, sim, feel, arcade, swing]
status: current
code:
  - `src/shared/sim/shot.ts`
  - `src/shared/sim/rally.ts`
  - `src/shared/sim/bot.ts`
  - `src/host/arcade.ts`
  - `src/host/render/events.ts`
  - `src/controller/racket.ts`
  - `src/shared/swing/gate.ts`
  - `src/shared/swing/detector.ts`
  - `src/shared/sim/players.ts`
  - `src/host/render/players.ts`
---

# 0023 — Power shots are earned

Settled 2026-09-27, after the user played [[0022-arcade-layer]] on a phone:
the power shots "work really great" but the bot could not reach them and the
user won every game. They asked for them to stay powerful but to happen
differently — **when a long chain of hits has been built, so the rally comes
to an end, or through a demanding swing** — and, in the same request, for
backhands to be hardened and for the overhead to connect more often.
Numbers: [[2026-09-27-power-backhand-overhead]].

**Amends [[0022-arcade-layer]]**: a swing at `POWER_SHOT` is no longer a
power shot by itself; PERFECT is now `PERFECT_TIMING` (0.08, was 0.12); the
cooldown restarts from the real swing, not the first peak.
**Amends [[0016-stroke-decides-direction]] §3**: a smash chance is a ball
coming down through 1.9m (was 2.3), with 0.3s slack (was 0.4).

## Decision

**1. A power shot is a hard swing that earned it** (`isPowerShot` in
`sim/shot.ts`): power ≥ `POWER_SHOT` and either timed PERFECT
(|u| ≤ `PERFECT_TIMING`) or struck after the `POWER_RALLY`th (8th) stroke of
the point. The sim decides it, so it is deterministic and the same for the
bot. `Stroke.powerShot` records it; `Stroke.power` stays what the phone read,
because `revise` compares raw peaks.

**2. An unearned hard swing puts at most `POWER_CAP` (0.7) into pace, and
keeps all of its risk.** A late ball drifts from the capped landing toward
where the full swing sends a late one, so hard and late still sails long.
Capping everything made swinging hard *safer* than before, and the
always-hard player won more.

**3. The rally counts in the sim** (`MatchState.rally`, the serve is 1). The
host's arcade calls **POWER UP!** when a rally reaches `POWER_RALLY`, and the
bot swings hard from then on — it knows the rule.

**4. Only the TV says POWER SHOT.** Pops, flash and audio read the event's
`powerShot`. The phone cannot know, so its stamp says POWER and a number,
and bursts for a hard swing. The lobby's motion check says "Full power!".

**5. The swing cooldown restarts from the real swing.** A take-back, often
read as the opposite stroke, can come a full second before its swing; a peak
past the group that is harder than all of the swing so far is let through,
once, within a cooldown of the first peak.

**6. A backhand's rotation is scaled by `BACKHAND_GAIN` (1.15)** before power
is read, so the same effort hits the same ball either side.

**7. The avatar steps across to the ball** for the stroke actually played
(`standFor`), in the renderer only. Half of all strokes are played from the
other stance, and the racket used to sweep through air on the wrong side.

**8. More smash chances**: `SMASH_HEIGHT` 2.3 → 1.9, `SMASH_SLACK` 0.4 → 0.3.
Smashes 5.5% → 8.5% of returns.

## Alternatives rejected

- **Make the defender faster** (one of the user's two suggestions). It makes
  every ball easier to reach, not only the power shot, and speed is one of
  the coupled balance constants in [[2026-09-22-stroke-direction-balance]].
  Slowing the unearned ball touches only the problem.
- **A "physics" condition: the ball sitting up at contact.** Groundstroke
  contacts cluster between 0.8 and 1.07m; the rule would turn on
  centimetres no player can see.
- **Tell the phone whether it was a power shot.** A new feedback field
  through the protocol, the guard and a relay that rebuilds every message,
  for a stamp nobody reads mid-swing. Deleting the claim was smaller.
- **Cap the whole power, risk included.** See decision 2.
- **Slack below `REACTION`.** More chances, but the player cannot move yet,
  and a plan that flips to a groundstroke under a committed overhead is a
  swing at air.
- **An overhead at a bounced ball as a lob.** A reading of "hit the ball
  upwards" that would reverse 0016's own rule that the overhead only works
  out of the air. The user's words point at the overhead animation they have
  seen, so the smash was made commoner instead. Ask before building a lob.

## Trade-offs accepted

- **A very precise player still earns a lot.** At σ 30ms about half of all
  hard swings are PERFECT. `PERFECT_TIMING` is the knob.
- **The avatar sidestep is unseen.** No browser session watched it; the step
  is ~1.1m in ~0.15s and may read as a slide.
- **Every number is against a simulated human** and eight recorded serve
  swings for the overhead.
