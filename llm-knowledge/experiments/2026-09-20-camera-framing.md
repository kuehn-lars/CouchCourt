---
title: The far player rendered at 0.25x the near player
updated: 2026-09-20
tags: [experiment, rendering, camera]
status: current
code:
  - `src/host/render/camera.ts`
  - `src/host/render/camera.test.ts`
  - `src/host/render/scene.ts`
---

# The camera, measured

## The complaint

"Better camera controls — you can currently only see one character. It really
sucks right now."

## The wrong first answer

The obvious reading is framing: the far player must be outside the view. So
the first thing written was a frustum test — build the camera basis from
position and target, project each player's anchor, compare against the half
FOV.

**The old camera passes it.** Both players are inside the frustum, at 55°
from 7.5m behind the near baseline, and the far player's head clears the top
edge with room. A test written to catch the reported bug did not catch it.

## The number that does describe it

Apparent size goes as 1/distance, so the ratio of the two players' distances
from the camera *is* the ratio of their heights on screen.

| camera | near player | far player | ratio |
| --- | --- | --- | --- |
| old: 4.4m up, 7.5m back, 55° | 7.9m | 31.5m | **0.25** |
| 8.6m up, 12.5m back, 50° | 14.2m | 37.0m | 0.38 |
| 11m up, 26m back, 28° | 27.7m | 50.7m | 0.55 |
| 12m up, 30m back, 25° | 31.8m | 54.8m | 0.58 |

At 0.25 the near player is four times the height of the far one: one figure
filling the bottom of the frame and a smudge at the top. That is what "you
can only see one character" looks like, and it is a **focal length** problem,
not a framing one. A tennis broadcast's main camera is a long lens a long way
back for exactly this reason.

`camera.test.ts` guards the ratio at > 0.5, and writes the old camera's 0.25
into the same test so the guard is known to bite.

## The second number: how much frame the court fills

Moving back without narrowing the lens makes everything smaller. At 26m back:

| FOV | near baseline (frac. of half-height) | far baseline | 7m lob |
| --- | --- | --- | --- |
| 28° | -0.60 | +0.15 | +0.61 |
| **19°** | **-0.89** | **+0.21** | **+0.89** |

19° puts the near baseline just inside the bottom edge, the far baseline
above centre, and still clears a 7m lob. 28° left the court spanning barely a
third of the picture with empty sky above and below — which is what the first
screenshot of the fix showed.

## What follow mode promises, and does not

A follow camera that always frames both players *is* the broadcast camera.
Once the ball is at the far baseline the near player is behind the camera,
and no height or lens fixes that without undoing the follow. So the test
asserts per mode: broadcast and side frame both players, every mode frames
the ball, and follow frames the ball and whoever is about to hit it.

## See also

[[modules/host]] — renderer rule 7 is superseded by this ·
[[0003-threejs-renderer]] · [[coordinate-frame]]
