---
title: The arcade layer
updated: 2026-09-27
tags: [decision, host, controller, audio, design, arcade]
status: current
code:
  - `src/host/arcade.ts`
  - `src/host/arcade.test.ts`
  - `src/host/render/events.ts`
  - `src/host/render/popups.ts`
  - `src/host/render/hud.ts`
  - `src/host/audio/index.ts`
  - `src/host/styles/arcade.css`
  - `src/host/main.ts`
  - `src/host/ui/lobby.ts`
  - `src/shared/swing/gate.ts`
  - `src/shared/swing/detector.ts`
  - `src/controller/main.ts`
  - `src/controller/racket.ts`
---

# 0022 — The arcade layer

Settled 2026-09-27. The user asked for the game to feel like an arcade game
and to be hard to put down: new sounds, speed numbers popping off the racket,
more colour, a swing cooldown so it cannot be spammed, power shots a bit more
often, and a more polished phone-to-game path. Numbers:
[[2026-09-27-cooldown-and-power-share]].

**Amended by [[0023-power-shots-are-earned]]** the same evening: a swing at
`POWER_SHOT` is a power shot only when it earned one (PERFECT timing or a
long rally), PERFECT is 0.08 not 0.12, the phone no longer stamps POWER
SHOT, and the cooldown restarts from a take-back's real swing.

## Decision

**1. One pure layer decides what a moment means.** `host/arcade.ts` turns
the frame's `RenderEvent`s into pops (km/h, timing grade, heat, power shot)
and callouts (ACE!, WINNER!, OUT, NET, FAULT, DOUBLE FAULT, RALLY ×5, ON FIRE!,
STREAK BROKEN, FASTEST YET, BEST RALLY), and keeps the rally count, the
streak and the stats. The renderer, the HUD and the audio all read the same
output, so they cannot disagree — the same reason audio already read
`RenderEvent`s. Tested (`arcade.test.ts`); nothing in it touches the DOM.

**2. The events say more, and still come from a diff of two states.** A
`hit` carries `speed` and `timing`; a `point` carries `winner` and `how`
(ace, winner, double fault, out, net — read off the end state's `toHit`,
`stroke` and `bounces`); a first-serve `fault` is its own event. The sim did
not grow ([[0003-threejs-renderer]]'s rule): `rally.ts` keeps resolving
out/net internally.

**3. The hooks, and why each is there.**
- *Speed pops* — the number a player chases. Sprites, not DOM, so a split
  screen shows them in both halves; screen-sized, so the far player's are
  readable; a canvas redrawn per hit, never per frame.
- *Timing grades* — PERFECT / GREAT / GOOD / EARLY / LATE. The only way a
  player learns the timing window is to be told, every swing. PERFECT is
  `|timing| <= 0.12`; GOOD ends at `SAFE_TIMING`, where a ball may stop
  landing in.
- *The rally ladder* — every stroke rings one step higher up a pentatonic
  scale, and the crowd bed swells with the rally. A long rally is *heard*
  building.
- *Streaks* — three straight points sets a side ON FIRE: a flame on the
  scorebug, flame-coloured trail and sparks, a stinger. Broken by the other
  side's point, which is its own callout.
- *Records* — fastest shot and longest rally of the **session**; only called
  once there is something worth beating (12 strokes, 8-shot rallies).
- *One more match* — the result card has the match's numbers and a Play
  again button, and **a swing on any phone starts the next match** once the
  result has been up 2.5s. Nobody has to walk to the laptop.

**4. More colour, for moments only.** 0017's one accent still owns the
chrome. Callouts, the rally counter, heat tiers and the streak get gold, hot,
orange, pink and cyan (`base.css` tokens). The trail, sparks and shockwave
warm with the shot's speed; the frame is tinted from the edges on big
moments (`post.ts` `flash`) so the ball stays readable.

**5. The swing cooldown is on the phone** (`shared/swing/gate.ts`). A swing
opens a 600ms group — every peak in it is sent, because the host plays the
hardest — and after that nothing is sent until 1.2s after the first peak.
Only while a point is in play (`score.ball === "play"`): a serve is a toss and
a hit close together. The racket goes dark and refills from the throat, flashes
when ready, and the refill turns red on a refused swing. This is the first
thing the phone decides from `MatchScore`, which 0020 called presentation
only; it gates the phone's own input, not the game.

**6. Power shots come more often** by lowering `POWER_CEIL_DEG_S` from 1400
to 1250: 7% of fixture swing peaks reach `POWER_SHOT` (0.85) before, 15%
after, held between 10 and 20% by `stream.test.ts`.

**7. The phone sends swings in every phase.** The host decides what one
means: a shot while playing, the **motion check** in the lobby (the seat
flashes with the swing's power, in the words the match uses), "again" on the
result screen. The relay always forwarded them; only the phone filtered.

**8. The crowd is silent at rest.** The first version ran a constant noise
bed under everything; heard through a real speaker it was static, and it
never stopped in the lobby. The murmur now rises only from a rally's third
stroke, low-passed and wobbled, and falls silent between points.

## Alternatives rejected

- **Cooldown in the sim.** Authoritative and deterministic, but the phone
  could not draw it exactly without a round trip, it would add per-side state
  to `MatchState` for a feel rule, and the bot would need exempting.
- **A cooldown timed from every peak, or a short group.** The early peak of a
  real swing — its backswing, which the host ignores — would lock out the
  swing itself. Measured: peaks of one swing land up to ~600ms apart.
- **Hit-stop** (freezing the picture on a big hit). This is a timing game
  judged against the sim clock; freezing the display for 60ms shifts what the
  *other* player sees and so when they swing. A punch, shake and flash instead.
- **Speed and grade on the phone.** A protocol change for text nobody reads
  mid-swing; players watch the TV. The phone shows POWER SHOT on its own
  stamp, from the power it already knows.
- **Persisted high scores.** `architecture.md` puts stats that persist
  between sessions out of scope. Records last as long as the host page.
- **DOM popups.** Crisper text, but a split screen needs each one projected
  into two viewports.

## Verified, and what is still not

- **Played on a real phone, 2026-09-27** — reported by the user: everything
  works and it plays well. That covers the cooldown and the power ceiling
  meeting a person, and the phone's recharge drawing.
- Before that, watched in headless Chrome on the Metal GPU with a scripted
  phone: popups, callouts, the rally counter, the streak flame, the lobby
  motion check. No console errors.
- **Still not measured.** The cooldown (600ms group, 1.2s) and the power
  ceiling (1250°/s) feel right but are cut from fixtures; how often a real
  player's swing is refused, or is a power shot, has not been counted. The
  solo balance ([[2026-09-22-stroke-direction-balance]]) was not re-run
  after the ceiling moved.
