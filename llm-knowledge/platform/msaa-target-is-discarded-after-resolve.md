---
title: A multisampled render target is discarded after every render
updated: 2026-09-24
tags: [platform, host, renderer, webgl, macos]
status: current
code:
  - `src/host/render/post.ts`
---

# A multisampled render target is discarded after every render

**Symptom (2026-09-24, M3 MacBook, Chrome):** the host showed the stadium
for a fraction of a second, then went black, except for a hard-edged strip
down the left. It was not the GPU being too slow: with the fix it holds 60fps.

**Cause.** At the end of every `renderer.render()` into a target with
`samples > 0`, three (0.186, `updateMultisampleRenderTarget`) blits the
multisampled colour renderbuffer into the texture and then calls
`invalidateFramebuffer` on the renderbuffer. Anything that draws into the
*same* target again afterwards blends onto undefined contents and then
resolves over the good texture:

- `UnrealBloomPass` has `needsSwap = false` and blends its glow back into
  the composer's `readBuffer`. The frame became bloom on black.
- A split screen's second view renders into the same target after the
  first view was resolved and invalidated. Its half would survive and the
  other be lost. This path was not seen directly.

Apple GPUs (ANGLE on Metal, tile-based) really do throw invalidated contents
away. SwiftShader ignores the hint, which is why every headless screenshot
before 2026-09-24 looked right.

**Evidence, with system Chrome on the Metal GPU:** bloom off → renders;
bloom on and `samples: 0` → renders; bloom on and `samples: 4` with the
viewport and scissor code bypassed → still black. So the cause is the MSAA
target, not the scissor.

**Rule:** the composer's target has no MSAA. If anti-aliasing is wanted
back, it has to be a separate pass (FXAA or SMAA) or one multisampled target
per render call, never several draws into one multisampled target.

**Harness:** headless Chrome *can* use the real GPU on macOS:
`--headless=new --use-angle=metal --enable-gpu`, driven over CDP. Test
renderer changes with that, not with SwiftShader.
