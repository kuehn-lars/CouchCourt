---
title: CouchCourt — the name, the mark, and where the brief went
updated: 2026-09-25
tags: [decision, design, host, controller, meta]
status: current
code:
  - `src/logo.svg`
  - `src/host/ui/icons.ts`
  - `src/controller/icons.ts`
  - `src/host/index.html`
  - `src/controller/index.html`
  - `.github/assets/header.svg`
  - `README.md`
---

# 0021 — CouchCourt: the name, the mark, and where the brief went

Settled 2026-09-24. The project was renamed from SwingCourt to **CouchCourt**,
given a logo, and `PRODUCT.md` was deleted as outdated.

## The mark

`src/logo.svg`, 64×64, two fills. The ball's rim is one C, open to the
right; the seam curling in from the right edge is a second C. Together they
make a circle: "CC" up close, a tennis ball as a favicon. Optic yellow
`#dcff4a` on an opaque `#272f16` body — the colour the original 16%-opacity
yellow body had over `#05080c`, made opaque so the ball still reads on a white
browser tab and in GitHub's light theme.

The gap between the two Cs is cut along a circle concentric with the seam,
not radially. Radial cuts taper to nothing at the counter. Every edge lands
on a whole pixel at 16px.

It is two-colour, so it ignores `currentColor`. It sits in both `ICON` maps as
`logo`, next to the Phosphor glyphs. The brand headers use it. Every other
`tennisBall` glyph (serve indicator, gate animation, cards) means an actual
ball and stays Phosphor.

**The favicon is now that file**, `<link rel="icon" href="../logo.svg">`,
where it used to be an inline data URI. Vite resolves the relative path from
source in dev and emits a hashed asset in the build (checked:
`dist/assets/logo-*.svg`, referenced from both built pages). The old reason
for inlining was "zero new files". It lapsed once the brand header needed the
same SVG.

## Alternatives rejected

Four marks were drawn in parallel, rendered in headless Chrome at 512px and
16px, and compared (renders were scratch, not committed):

- **A sofa whose backrest is a court**, with the ball above it. The pun reads
  instantly at 512px. At 16px it is a white blob with a yellow dot, and it is
  near-invisible on white.
- **Monoline: a racket whose head is an iPhone**, Phosphor-weight. It tells the
  story best, but the strings go to grey mush at 16px, and next to the Phosphor
  glyphs it reads as one more icon rather than a mark.
- **An app-icon badge**: a night court in perspective with a glowing ball. The
  most atmospheric, but too busy for a favicon, and its court read as a road.
- **Rejected inside the chosen direction**: "CC" letters inside a ball (too
  close to the Creative Commons logo), and dark grooves on a solid ball (moon
  phases, a wifi icon).

## The name everywhere

Code and vault text, the court wordmark and LED boards
(`render/textures.ts`), the phone's rim label (`controller/view.ts`), the
plugin names, and **the storage keys**: `couchcourt.host.settings`,
`couchcourt.controller.prefs`, `couchcourt-player-id` and the recorder's two
keys. Changing the keys drops saved prefs and any in-flight resume token once,
which is harmless for an unreleased game.

One `swingcourt` string is deliberately kept:
[[2026-09-19-lan-tls-verification]] quotes it as recorded command output, and
rewriting evidence would falsify it.

The GitHub repository was renamed to `kuehn-lars/CouchCourt` on 2026-09-25;
GitHub redirects the old `SwingCourt` URLs. The README's CI badge points at
the new name.

## Where `PRODUCT.md`'s content went

- The v1 out-of-scope list, which was binding, now lives in [[architecture]]
  under "What is deliberately not here". `CLAUDE.md` §8 points there.
- The pitch, the features and the status are in `README.md`, which
  `CLAUDE.md` §1 now names as the place for **what** the project is.
- The design principles (zero install, local first, own assets only, generous
  input, feel beats fidelity) were cited from about 35 notes and comments. Each
  citation was rewritten so its reason stands on its own.

## See also

[[0017-phosphor-icons-and-the-visual-system]] — the palette and the
one-accent rule this mark keeps. [[modules/host]] · [[modules/controller]]
