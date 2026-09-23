---
title: Phosphor icons, system type, no UI framework
updated: 2026-09-23
tags: [decision, dependency, host, controller, design]
status: current
code:
  - `package.json`
  - `src/host/raw.d.ts`
  - `src/host/host.css`
  - `src/controller/index.html`
---

# 0017 — Phosphor icons, system type, and no UI framework

## Decision

The 2026-09-23 redesign of the lobby, score overlay, settings and phone
controller adds **one dependency, `@phosphor-icons/core`** (MIT, zero
transitive dependencies), and nothing else. Icons are imported one file at a
time as `?raw` SVG strings, so only the dozen glyphs actually used reach the
bundle; the package's 6MB is almost all glyphs nobody imports.

Everything else is native: CSS custom properties, `@property`, keyframes,
`backdrop-filter`, scroll-snap, the Web Animations API, `<dialog>`.

## Why an icon set at all

The redesign needs a settings button, close, fullscreen, sound, camera, a
phone, a ball, a robot for the machine, a trophy, and direction arrows.
Hand-drawn SVG paths for those are the thing that makes a page look home
made, and emoji (the old controller used 🎾) render differently on every
OS. One consistent set at one weight (`regular`) is what reads as designed.

## What was rejected

**React + Tailwind + Motion**, the usual stack for this kind of page. Both
surfaces are overlays on a canvas with a handful of states each, written in
plain DOM that works. A framework would be a second rendering model beside
Three.js on the host and a larger bundle on the phone that has to load over
party Wi-Fi, for no behaviour the platform does not already have.

**A webfont.** `PRODUCT.md` says local first, and the only screens this runs
on are a Mac and iPhones, which already ship SF Pro. `system-ui` *is* the
Apple typeface on the target hardware; on anything else it degrades to that
platform's UI font, which is an acceptable failure for a page nobody is
meant to open there. `ui-rounded` (SF Pro Rounded) is used for big numerals
only.

**Lucide / Heroicons.** Fine sets; Phosphor was picked for its `tennis-ball`
and `robot` glyphs and for shipping raw SVG files rather than a component
package.

## The visual rules this came with

Recorded so the next change does not drift from them:

- **Dark only.** It is a night stadium; the host is a 3D scene and the phone
  sits in a dim living room. No light theme.
- **One accent: optic yellow `#dcff4a`**, the ball. The two player colours,
  coral `#ff5d73` (near) and ice `#5ac8fa` (far), are semantic — they are
  the avatars on court — and appear only where a side is meant. Far used to
  be amber `#ffd166`, which sat too close to the ball's yellow.
- **Radii:** pill for every button and chip, 28px for panels and sheets,
  20px for cards inside them.
- **Motion** eases on `cubic-bezier(.2,.8,.2,1)` (decelerate) and springs on
  the Web Animations API; everything collapses to instant under
  `prefers-reduced-motion`.

## See also

The phone's match screen described here was replaced on 2026-09-24 by
[[0020-the-phone-is-the-string-bed]]; the visual rules above still hold.

[[0011-qrcode-generator-dependency]] · [[modules/host]] ·
[[modules/controller]]
