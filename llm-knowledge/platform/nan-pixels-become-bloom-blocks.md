---
title: One NaN pixel becomes a black rectangle under bloom
updated: 2026-09-24
tags: [platform, host, renderer, webgl, macos]
status: current
code:
  - `src/host/render/stadium.ts`
  - `src/host/render/post.ts`
---

# One NaN pixel becomes a black rectangle under bloom

**Symptom (2026-09-24, M3, Chrome):** the game played fine, but black
rectangles flickered across the host screen. Screenshots never caught it:
it was on about 5% of frames.

**Cause.** The floodlight beam shader did `pow(1.0 - vAlong, 1.3)`, with
`vAlong` being `uv.y`, which is 1.0 at the court end. Interpolation overshoots
1 by a hair on some pixels, and on Metal `pow` of a negative base gives NaN.
The beam is additive, so NaN + floor = NaN in the half-float HDR target.
`UnrealBloomPass` then downsamples and blurs that one pixel through its mip
chain, and every level it touches turns NaN too. The result is black blocks
that grow with the mip level. SwiftShader does not give NaN there.

**Evidence** (headless Chrome on Metal, lobby, reading the HDR target back
every 5th frame and counting half-floats with exponent 0x1f): before the fix,
3–7 frames in 100–150 had 1–3 NaN values after the scene pass and up to
12,779,880 after bloom. All three RGB channels were NaN (`0x7e00`) and alpha
was not. With `pow(max(1.0 - vAlong, 0.0), 1.3)`: 0 in 251.

**Rule:** in any shader that feeds the HDR target, clamp the base of `pow`
to be ≥ 0 and never `normalize` a vector that can be zero. A single bad
pixel is not a single bad pixel once bloom has run.

**Probe:** in a throwaway copy, read the composer's `readBuffer` with
`renderer.readRenderTargetPixels` into a `Uint16Array` and count values
where `(v & 0x7c00) === 0x7c00`. Run it through the Metal harness in
[[msaa-target-is-discarded-after-resolve]] and on a separate port, so that
nothing hot-reloads into a tab someone is using.
