---
title: Split screen, and whose screen-left it is
updated: 2026-09-24
tags: [decision, host, sim, camera]
status: current
code:
  - `src/host/render/camera.ts`
  - `src/host/render/scene.ts`
  - `src/host/render/post.ts`
  - `src/host/main.ts`
  - `src/host/ui/settings.ts`
  - `src/shared/sim/shot.ts`
  - `src/shared/sim/rally.ts`
  - `src/shared/sim/bot.ts`
---

# 0019 — Split screen, and whose screen-left it is

Settled 2026-09-24, asked for by the user: when two people play, each gets
their own half of the screen.

**Amends decision 1 of [[0016-stroke-decides-direction]].** "Forehand goes to
screen-left" now means *the left of the screen that player is watching*. On
one shared screen that is still world -x for both; on a split screen the far
player's screen-left is world +x.

## Decision

**1. Side by side, each half from behind its own player** (`splitPose`). Near
on the left, far on the right. Each half is its own picture: its own
vignette, its own camera sliding with its own player, the scorebug over the
seam, a side-coloured tag at the foot of each half.

**2. The sim knows.** `MatchState.split`, fixed at `createMatch`, and
`screenLeftOf(side, split)` in `shot.ts`. On a split screen a far forehand
lands at +x. Fixed for the match because a mid-rally change would send the
ball the other way off the same stroke.

**3. It is a setting, on by default, for two people only.** Solo keeps the
chosen camera. `C` is ignored during a split match. Applies from the next
match.

**4. The match ends on a victory orbit** (`victoryPose`) whether split or not:
the camera comes down to the winner, from the front, while the result shows as
a lower third.

## Alternatives rejected

- **Top and bottom halves.** Each slice would be 3.2:1 — a letterbox that
  throws away the depth the game is built on ([[0003-threejs-renderer]]).
- **Mirror the far half horizontally** so world -x stays on the left. Every
  word in the stadium reads backwards and the far avatar becomes left-handed.
- **Swap forehand and backhand on the host** for the far player. The ball
  goes the right way, but the avatar then plays the wrong stroke, and the
  host would be lying to the sim about what was swung.

## Consequences

- Two views means two scene renders; the shadow map is rendered once and
  shared (`post.ts`, `ViewsPass`). Frame cost roughly doubles. Unmeasured.
- `camera.test.ts` holds the geometry: own player whole anywhere they can
  stand at half of 16:10 and 16:9, the opponent visible, and the far half's
  left really being +x — the property the sim change depends on.
- The painted wordmark behind the far baseline turns round for the far half.
