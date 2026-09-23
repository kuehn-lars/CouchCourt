---
title: The stylised stadium renderer
updated: 2026-09-24
tags: [decision, rendering, host, design]
status: current
code:
  - `src/host/render/scene.ts`
  - `src/host/render/post.ts`
  - `src/host/render/toon.ts`
  - `src/host/render/athlete.ts`
  - `src/host/render/poses.ts`
  - `src/host/render/players.ts`
  - `src/host/render/stadium.ts`
  - `src/host/render/crowd.ts`
  - `src/host/render/officials.ts`
  - `src/host/render/ball.ts`
  - `src/host/render/effects.ts`
---

# 0018 — The stylised stadium renderer

Settled 2026-09-24. The user asked for the 3D scene to look like a
professional game — "realistic comic style", real lighting, cool characters,
better animation — matching the app's colour scheme, and gave explicit
permission to break the earlier rendering rules to get there. Sound, feel and
haptics were to stay exactly as they were.

**Supersedes renderer rules 3, 5 and 6** in [[modules/host]] (blob shadow
only; procedural primitives only; no post-processing) and replaces the
primitive capsule players of `entities.ts`, which is deleted. Rules 1
(interpolate) and 2 (no allocation in the frame loop) stand and are kept.
[[0003-threejs-renderer]] still stands: this is the same renderer, rebuilt.

## Decision

**1. Drawn people in a lit place.** Characters, props and the umpire's chair
are cel-shaded (`MeshToonMaterial`, four bands) with a hard stepped rim light
and inverted-hull ink outlines (`toon.ts`). The court and stands are
physically shaded, so the floodlights can put a sheen across the court from a
prefiltered environment of lamp panels. The split is the style: drawn figures
under real light.

**2. Post-processing: bloom and a grade.** One HDR multisampled target, bloom
at half resolution (threshold 0.92, only emissives and highlights), ACES tone
mapping in `OutputPass`, then a display-space grade: vignette, a chromatic
fringe toward the corners that kicks on a hard hit, a gentle S-curve and
moving grain. All passes ship inside `three` — no new dependency.

**3. Real shadows for people, a blob for the ball.** One 2048 directional
shadow map fitted to the court (not the stadium), rendered once per frame
however many views there are. The ball keeps its blob: the depth cue is the
shadow *directly under* the ball, and a real shadow from a light at 60° is not
under it.

**4. Articulated athletes with authored poses.** Thirteen joints; poses are
flat `Float32Array`s blended in layers — stance, run or side-shuffle (driven by
distance covered, so feet never skate), the racket coiling as the ball
approaches, the stroke, and a fist pump or a hung head after a point
(`players.ts`). The pose data and sampler are pure and tested (`poses.test.ts`).
A stroke is only known once the ball is struck, so playback joins **just
before the contact frame** (`strokeEntry`) — the racket is seen meeting the
ball. Feet are grounded by measuring the ankles after posing, so no pose knows
a leg length. Secondary motion: a ponytail on a spring; a swing smear drawn
behind the racket head.

**5. An inhabited stadium.** A bowl with an upper deck, an LED ribbon board
and scrolling court-side boards, a lit roof ring, four floodlight towers with
lamp grids and volumetric beams, a crowd of 3,860 in one draw call that
fidgets, jumps and throws its arms up on a point and does a wave in the lobby,
camera flashes, a chair umpire and four ball kids whose heads follow the ball.

**6. Comic impact.** A starburst sprite at contact, sparks, a shockwave ring
under hard shots, dust and a skid mark on a bounce, squash and stretch on the
ball, confetti in the winner's colour, a small camera shake on a smash.

**7. The frame rate protects itself.** The pixel ratio steps between 1.75 and
0.8 on sustained slow or fast frames (`scene.ts`, `adapt`). Resolution is the
one thing that can go without anyone noticing; a dropped frame is felt.

## Alternatives rejected

- **glTF characters and animation clips.** Needs an artist or borrowed assets
  (`PRODUCT.md`: own assets only), a loader, files to fetch over party Wi-Fi,
  and a pipeline. The primitives-plus-toon approach reads as a style rather
  than as a placeholder once it has outlines, rim light and good poses.
- **A screen-space outline pass** (`OutlinePass` or a depth/normal edge
  shader). One more full-screen pass per view, and it outlines the crowd and
  the stands too, which turns the stadium into line-art noise. The hull
  outline is per-object and free to leave off.
- **Four real spotlights for the towers.** Four more shadow maps for
  highlights the environment map already gives. The towers are emissive only.
- **SSAO / GTAO.** Real cost for little on a mostly flat court at night.
- **A cutaway replay camera after each point.** The sim holds `point-over` for
  **one tick** and sets up the next serve immediately; a cutaway would steal
  time from the server. The celebration plays on the broadcast camera instead,
  and a toss cancels it.

## Trade-offs accepted

- **Frame time is unmeasured on real hardware.** Everything was seen through
  SwiftShader, whose frame rate means nothing. Rough budget: ~7 rigs × ~40
  meshes with hulls ≈ 600 draws plus the stadium, doubled on a split screen,
  plus a shadow pass and bloom. The adaptive pixel ratio is the safety net,
  not a measurement. **Check on a MacBook before trusting it.**
- The host bundle grew from 598 kB to 665 kB (177 kB gzipped).
- The ball's felt spins about an axis computed in world space inside a rotated
  parent; the spin direction is approximate. Cosmetic.

## How it was checked

Headless Chrome screenshots of every state (lobby, solo, split, a close-up of
the athletes, the victory orbit), a throwaway pose-preview page and a
throwaway close-up page (both deleted). Harness traps are in [[modules/host]].
