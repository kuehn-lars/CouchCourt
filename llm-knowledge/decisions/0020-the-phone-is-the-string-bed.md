---
title: The phone is the string bed
updated: 2026-09-24
tags: [decision, controller, design, protocol]
status: current
code:
  - `src/controller/racket.ts`
  - `src/controller/view.ts`
  - `src/controller/main.ts`
  - `src/controller/index.html`
  - `src/shared/protocol.ts`
  - `src/host/score-line.ts`
  - `src/server/relay.ts`
---

# 0020 — The phone is the string bed

Settled 2026-09-24. The user found the 2026-09-23 match screen (a 270° power
dial, a status pill, a hint card) "lazy, boring, AI slop" and asked for a
controller nobody would want to trade for another. The gate — the landing
page — was praised and is unchanged.

**Replaces the match screen** of [[0017-phosphor-icons-and-the-visual-system]]
and [[modules/controller]]. The visual rules of 0017 (dark, one accent, the
side colours) still hold.

## Decision

**1. The screen is the racket.** The head fills a portrait screen, the throat
runs off the bottom into the player's hand, the frame is in the player's side
colour with grommets and the court's name printed round the rim. Everything
the phone says is **stencilled onto the strings** — inked only where there is
string, as a maker's logo is on a real racket (`racket.ts`, `source-atop` on an
opaque string layer).

**2. It behaves like one.** Strings ripple from the sweet spot on a hit and bow
toward a swing in progress; the frame glows while it moves and **charges round
from the throat** with the power of the swing just read; a hit leaves felt on
the strings; a won point throws confetti, a lost one lets the strings go slack.

**3. It says the one thing to do next.** SERVE with a ball on the strings, HIT
once it is tossed, RETURN when they serve, the score from your own side
mid-rally, DEUCE and AD in words, WIN or GG at the end, games as pips. The
logic is pure and tested (`view.ts`, `view.test.ts`).

**4. The phone is told the score and the serve** — `MatchInfo.score`
(`MatchScore`: games, points, who serves, and whether the ball is in hand, up
on the toss, or in play). Optional, so no protocol version bump. Guarded like
everything else (`isHostMessage`). The host sends it when it changes, a few
times a point, from `scoreLine` (`src/host/score-line.ts`, tested).

**5. The toss is drawn on the phone's own clock.** When the phone reads a swing
while the ball is in hand, the ball leaves the strings at once — from when the
swing actually happened, minus the detector's `lag` — and flies on
`TOSS_APEX`, the real toss's clock. The host's "toss" state is the fallback
for a phone that missed its own swing.

**6. Kept exactly:** the permission gate and its tap handler, the session,
the swing stream and what is sent, the colour-wash flash, the haptic tick, the
settings sheet.

## Alternatives rejected

- **Keep the dial and restyle it.** The complaint was the concept, not the
  paint: a gauge is a generic widget; a racket is the product.
- **WebGL on the phone.** A 2D canvas draws 47 strings and a frame at 60fps
  with nothing to install; a GPU context is one more thing to lose on a tab
  suspend ([[ios-safari-tab-suspension]]).
- **Small text as stencil.** At caption size a letter is crossed by two
  strings and cannot be read; captions and game pips are printed over the
  strings with a dark halo instead.
- **Translucent strings.** Measured: the ink landed (5,767 yellow pixels on
  the layer) and was invisible, because a stencil on a 58%-alpha string comes
  out olive. Strings are opaque grey; the ink is full strength.

## Not verified

On a phone: the frame rate of the canvas at 3x density (it is capped at 2x),
the tilt parallax from `accelerationIncludingGravity`, and whether the toss
animation lines up with the real toss by eye. Seen only in headless Chrome,
driven by a fake host over the real relay and by synthetic `devicemotion`
through the real detector.
