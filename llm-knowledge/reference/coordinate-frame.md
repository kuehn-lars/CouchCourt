---
title: Coordinate frame and units
updated: 2026-09-20
tags: [reference, sim, geometry]
status: current
code:
  - `src/shared/sim/court.ts`
  - `src/shared/sim/state.ts`
  - `src/host/render/court.ts`
---

# Coordinate frame and units

Stated once, here, because it is assumed silently by every file in
`src/shared/sim/` and `src/host/render/` and a mistake in it produces a game
that is subtly mirrored rather than obviously broken.

Originally fixed in the simulation build plan, which has since been deleted
per the vault's delete-on-landing rule; this is the surviving half.

## Units

**Metres, seconds, radians.** No unit suffixes on names — there is only ever
one unit, so `BASELINE_Z` is metres and `CLEAN_WINDOW` is seconds without
saying so.

Two exceptions, both on the input side and both marked in their own files:
`MotionSample.rot` is **deg/s** (that is what `devicemotion` delivers) and
`MotionSample.t` is **milliseconds**.

## Axes

```
                    far baseline   z = -11.885
                   ─────────────────────────
                  │                         │
                  │                         │   -x ◀── ──▶ +x
       net  z = 0 ├ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤
                  │                         │        y is up
                  │                         │
                   ─────────────────────────
                    near baseline  z = +11.885
                          camera is behind here
```

- **`x`** across the court, `0` at the centre line.
- **`y`** up, `0` at the court surface.
- **`z`** along the court, `0` at the net. The **near** baseline is at
  `+BASELINE_Z`, the **far** one at `−BASELINE_Z`.

So `near` hits toward **−z** and `far` hits toward **+z**. `resolveShot`
encodes exactly that: `forward = side === "near" ? -1 : 1`.

The camera sits behind the near baseline looking toward −z, which makes the
near player the one at the bottom of the screen.

## Geometry constants

All ITF rulebook figures, **cited not tuned** — see
[[modules/shared-sim]] on why that distinction matters.

| Constant | Value | Meaning |
| --- | --- | --- |
| `COURT_LENGTH` | 23.77 | baseline to baseline |
| `BASELINE_Z` | 11.885 | `|z|` of each baseline (half the length) |
| `SINGLES_HALF_WIDTH` | 4.115 | centre to singles sideline |
| `SERVICE_LINE_Z` | 6.4 | `|z|` of each service line, **from the net** |
| `NET_POST_X` | 5.029 | `SINGLES_HALF_WIDTH + 0.914` |
| `NET_HEIGHT_CENTRE` | 0.914 | at the centre strap |
| `NET_HEIGHT_POST` | 1.07 | at the posts |
| `BALL_RADIUS` | 0.0335 | middle of the ITF 6.54–6.86mm diameter range |

Three of these are easy to get wrong and each has a test that has been watched
failing:

- **`SERVICE_LINE_Z` is measured from the net, not the baseline.** From the
  baseline it would be 18.29. A service box is less than a third of its own
  half of the court, which is smaller than it feels.
- **0.914 appears twice and means two unrelated things** — the centre net
  height in metres, and the post's offset outside the singles sideline. A
  coincidence, not a shared constant.
- **The net sags.** `netHeightAt(x)` interpolates linearly from the strap to
  the posts, so at the singles sideline the band is 1.042, not 1.07 — a wide
  ball meets ~13cm more net than one over the centre. A flat net silently
  makes wide shots easier than they are, and is invisible to any test that
  crosses at `x = 0`.

`netHeightAt` clamps past the posts: out there the sideline judges the ball,
not the net.

## Doubles is not modelled

`SINGLES_HALF_WIDTH` is the only width. The doubles alleys do not exist, and
the net posts are the **singles** post positions. v1 is singles —
the out-of-scope list in [[architecture]] is binding.

## See also

[[modules/shared-sim]] · [[tennis-scoring]] · [[architecture]] ·
[[modules/host]]
