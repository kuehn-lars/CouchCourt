---
title: touch-action is the intersection of every ancestor's
updated: 2026-09-23
tags: [platform, controller, ios, css]
status: current
code:
  - `src/controller/controller.css`
  - `src/controller/main.ts`
---

# `touch-action` is the intersection of every ancestor's

A child cannot grant itself a gesture its ancestors refused. The browser
takes the intersection of `touch-action` on the element and **every**
ancestor, so `touch-action: none` on `html` or `body` switches off panning in
the whole page, including a horizontal scroller that declares `pan-x` for
itself.

## Why it matters here

The controller must never scroll, rubber-band or pinch-zoom while a player
is swinging the phone ([[modules/controller]]). It used to get that from
`touch-action: none` on `html, body`, which was fine while the page had
nothing to swipe. The 2026-09-23 redesign added swipeable how-to cards to the
permission gate, and with `none` on `body` they could never have moved.

iOS Safari has ignored `user-scalable=no` since iOS 10, so the viewport meta
does not stop pinch zoom on its own. `touch-action` is what does.

## What the page does now

- `html, body { touch-action: pan-x }` on the gate. The cards can pan
  sideways, and pinch zoom stays off because `pinch-zoom` is not in the set.
  The page itself cannot scroll sideways because `body` is `overflow: hidden`.
- `main.ts` adds `html.playing` when the match screen takes over, which sets
  `touch-action: none` on both. Nothing on the match screen pans.

**Unverified on a phone.** Seen only in headless Chrome with a touch-emulated
viewport, where the cards scroll programmatically. A finger on an iPhone has
not swiped them.

## See also

[[ios-motion-permission]] · [[modules/controller]] ·
[[0017-phosphor-icons-and-the-visual-system]]
