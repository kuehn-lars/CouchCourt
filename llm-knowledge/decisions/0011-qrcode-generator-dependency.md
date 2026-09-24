---
title: qrcode-generator for the join code
updated: 2026-09-20
tags: [decision, dependency, host, onboarding]
status: current
code:
  - `src/host/ui/lobby.ts`
  - `package.json`
---

# 0011 — `qrcode-generator` for the join code

## Decision

One new runtime dependency, `qrcode-generator` (~15KB, **zero transitive
dependencies**), used in `src/host/ui/lobby.ts` to render the controller URL
as an inline SVG.

`CLAUDE.md` §7 requires this note for any new dependency: what it replaces,
and what was rejected.

## Why not write it

A QR encoder is not a rendering problem, it is Reed-Solomon error correction
over GF(256), eight mask patterns with a penalty score for each, mode and
version selection, and a bit-interleaving step. That is 250+ lines of code
whose only acceptance test is "does a phone camera read it", which is the one
test this project cannot run in CI.

The project is unusually direct about which part of this system is load
bearing: *"the hard problem is the first thirty seconds"*, and the code is
the first three of them. Hand-rolling the one component whose failure mode is
"a guest points a camera at it and nothing happens" is the worst possible
place to save a dependency.

## What was rejected

**Writing it.** Above.

**`qrcode`, the more popular package.** Pulls a CLI, a PNG renderer and
several transitive dependencies for a function we call once. `qrcode-generator`
is the same algorithm with none of that.

**A QR web service.** Dead on arrival: "local first —
gameplay never depends on an internet connection", and the LAN this runs on
may have no route out at all.

**No QR at all, just the URL as text.** This was the real alternative, and it
is what the lobby falls back to anyway (the URL is printed under the code).
But typing `https://192.168.1.42:5173/controller/` on a guest's phone is
exactly the "nothing typed" bar the product sets, and it is the difference
between a party trick and a support call.

## See also

[[0001-single-package-vite-mpa]] · [[modules/host]] ·
[[0004-lan-https-via-local-ip-co]] — where the URL in the code comes from
