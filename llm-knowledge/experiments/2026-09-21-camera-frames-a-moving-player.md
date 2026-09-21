---
title: The broadcast camera framed a court, not the players in it
updated: 2026-09-21
tags: [experiment, renderer, camera, measurement]
status: current
code:
  - `src/host/render/camera.ts`
  - `src/host/render/camera.test.ts`
  - `src/shared/sim/players.ts`
---

# 2026-09-21 — The broadcast camera framed a court, not the players in it

Found in a screenshot, mid-rally, at 40–15: the near player had run back for
a deep ball and their **legs were off the bottom of the frame**.

Nothing was wrong with the camera. It was framing the range players used to
occupy. Once [[0014-players-run-to-the-ball]] gave `Player` a `z`, they can
stand anywhere from `NET_KEEP_OUT` (0.9) to `BASELINE_Z + RUN_BACK` (13.885),
and the camera had been tuned for a fixed 11.885.

## Why the test did not catch it

Two reasons, and the second is the interesting one.

1. `playerAnchor` in `camera.test.ts` hardcoded `z: ±BASELINE_Z`. Players had
   never been anywhere else, so it was true when written.
2. Extending it to the new range **still passed**, because the anchor is a
   single point at chest height (`y: 0.9`). A camera can frame a player's
   chest perfectly while their legs hang off the bottom of the screen — which
   is precisely what the screenshot showed. The anchor now checks feet
   (`y = 0.05`) and head (`y = 1.8`).

That second pass is worth remembering: the guard was extended to the right
*range* and stayed green because it was checking the wrong *point*.

## The sweep

`BROADCAST_HEIGHT` × `BROADCAST_BACK` × `BROADCAST_FOV` against the real
frustum, requiring every one of these to hold at once:

- both players' feet and heads visible at z-depths 0.9, 2, 4, 6, 8, 10,
  11.885 and 13.885, on both sides;
- at x = 0 and both extremes of `SINGLES_HALF_WIDTH + RUN_WIDE`;
- at all three extremes of the camera's own lateral drift;
- the ball visible every metre down the court at 0.1m, 1.5m and 7m (a lob).

Results over 6 × 6 × 6 = 216 combinations:

| | |
| --- | --- |
| **current (11, 26, 19)** | **fails** |
| combinations that hold | 189 |
| best both-players-in-scale ratio | 0.615, at height 14 / back 34 |
| **nearest to current that holds** | **height 11 / back 28 / fov 19** |

`BROADCAST_BACK` 26 → 28. One constant, one number, and the
both-players-at-comparable-size ratio that
[[2026-09-20-camera-framing]] exists to protect goes **up**, from 0.55 to
0.564 — so the fix for the old bug is not weakened by the fix for this one.

Height and lens are unchanged, which keeps everything
[[2026-09-20-camera-framing]] measured about how much of the frame the court
fills.

## See also

[[2026-09-20-camera-framing]] · [[0014-players-run-to-the-ball]] ·
[[modules/host]] · [[coordinate-frame]]
