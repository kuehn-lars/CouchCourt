---
title: Simulation runs in the host browser
updated: 2026-09-19
tags: [decision, architecture, core]
status: current
code:
  - `src/shared/`
  - `tsconfig.web.json`
  - `tsconfig.node.json`
---

# 0002 — Simulation runs in the host browser, server is a relay

**This is the most load-bearing decision in the codebase.** Most of the
structure follows from it.

## Decision

The authoritative game simulation runs in the host browser's animation loop.
The Node server owns player slots and forwards messages; it owns no game state.

The simulation itself lives in `src/shared/sim` as **pure, framework-free,
deterministic code**: `tick(state, inputs, dt)` with a fixed timestep and no
access to the DOM, the network, the clock, or `Math.random` via ambient state.

## Why

Putting the sim next to the renderer removes a network round trip from every
frame, which matters in a game about swing timing.

The usual objection — "server-authoritative is more testable" — is answered by
the purity constraint instead of by relocating the code. Because `tick` is pure
and the timestep is fixed, the entire simulation is testable headless in Vitest
with no browser, no server, and no phone. Where it *runs* stops being an
architectural question at all; it becomes a deployment detail we can change
later without touching the logic.

Fixed timestep also buys replays for free: record the input stream, replay a
whole match in a test.

## How purity is enforced

Not by convention, and not by a lint plugin. By the typechecker:

`src/shared` is compiled by **both** `tsconfig.web.json` (has DOM, no
`@types/node`) and `tsconfig.node.json` (has `@types/node`, no DOM). Code in
`shared` that touches `document` fails the node project; code that touches
`process` fails the web project. Both directions, no extra tooling.

Verified 2026-09-19 — a probe file using `document` and one using `process` each
produced exactly one typecheck failure.

## Alternatives rejected

- **Node server authoritative, host as dumb renderer.** Adds a round trip per
  frame and requires a second protocol for render state. The testability win it
  promises is already obtained by the purity constraint above.
- **Peer-to-peer WebRTC between phone and Mac.** Removes the server we need
  anyway for serving pages, and buys latency we are not short of on a LAN.

## Consequences

- `src/shared` must never import from `src/host`, `src/server` or `src/controller`.
- Anything non-deterministic — wall clock, RNG seed, input timing — is passed
  *into* `tick`, never read inside it. Breaking this silently breaks replays.
- The host page is trusted. There is no anti-cheat story and there does not need
  to be one; everyone is in the same room.
