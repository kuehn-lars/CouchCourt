---
title: Index
updated: 2026-09-20
tags: [meta]
status: current
---

# SwingCourt knowledge index

**Read this first.** It is the catalog: every note in the vault, one line
each. Find the rows that touch your task, open those, ignore the rest.

New here? Read [[architecture]] next — it is the only page that describes the
whole system. [[README]] explains how the vault is maintained.

## Start here

| | |
| --- | --- |
| [[architecture]] | How the whole thing connects: the swing path end to end, what each hop may assume, where state lives, and the one remaining seam that means **the game cannot currently be played end to end** |
| [[0002-host-authoritative-simulation]] | The most load-bearing decision in the codebase. Most of the structure follows from it |
| [[log]] | What happened, in order, and what each session promoted |

## Modules — what is wired to what

One page per subsystem: its files, its import graph, its invariants, and the
notes that constrain it. **Start at the row for the thing you are changing.**

| Module | Code | Covers |
| --- | --- | --- |
| [[modules/shared-protocol]] | `src/shared/protocol.ts` | The wire contract every folder imports. Guards, versioning, the dead `aim` stream |
| [[modules/shared-swing]] | `src/shared/swing/` | Trace format and swing detection. Tuned offline against 20 committed captures |
| [[modules/shared-sim]] | `src/shared/sim/` | The game: `tick`, ball flight, shot feel, scoring, court geometry |
| [[modules/server]] | `src/server/` | The relay: slots, resume, liveness. No game state |
| [[modules/host]] | `src/host/` | Fixed-timestep loop, socket wiring, Three.js renderer and its performance rules |
| [[modules/controller]] | `src/controller/` | The iOS permission gate and the trace recorder. The real controller is **not built** |
| [[modules/tooling]] | `vite.config.ts`, `scripts/`, `.github/workflows/ci.yml` | Build, the three tsconfig projects, CI, the vault checker |

## Decisions

Choices we made and will not casually revisit, with the alternatives rejected.

| | |
| --- | --- |
| [[0001-single-package-vite-mpa]] | One package, not a monorepo |
| [[0002-host-authoritative-simulation]] | Sim in the host browser; the server is a relay. How purity is enforced by the typechecker |
| [[0003-threejs-renderer]] | Three.js over Phaser — tennis is a depth game |
| [[0004-lan-https-via-local-ip-co]] | Publicly trusted certificates for LAN addresses, and its five known costs |
| [[0005-raw-websockets-over-socket-io]] | `ws` over Socket.IO — the reconnection argument inverts |
| [[0006-relay-session-policy]] | Host replacement, no slot reclaim, liveness defaults |
| [[0007-host-arrival-time-for-swing-timing]] | Swing timing uses host arrival, never the phone's clock |
| [[0008-timing-not-aim-for-shot-direction]] | Direction comes from timing's sign; the `aim` stream is dead |
| [[0009-streaming-swing-detection]] | The phone emits a swing before it finishes. Why `detectSwings` cannot be streamed, and what firing early costs |

## Platform

How the outside world behaves. Not our code, not fixable — only workable
around. **These are the ones that cost an afternoon if you skip them.**

| | |
| --- | --- |
| [[ios-motion-permission]] | HTTPS *and* a tap, or no sensors at all. Missing either is silent |
| [[lan-https-dns-rebind]] | Why the QR code may not resolve on a home router |
| [[lan-https-cert-chain]] | Why it can still fail on the phone once it does, and why macOS hides it |
| [[ios-safari-tab-suspension]] | The phone will drop its socket. By design, not as an edge case |
| [[vitest-is-a-vite-serve]] | `apply: "serve"` is not a dev-only gate |

## Reference

How our own system and its domain are defined.

| | |
| --- | --- |
| [[wire-protocol]] | Why the messages are shaped the way they are |
| [[tennis-scoring]] | The scoring rules the sim implements, and what is deliberately simplified |
| [[coordinate-frame]] | Axes, units and the ITF geometry constants |
| [[llm-wiki]] | The pattern this vault is built on. Source material, not a project note |

## Experiments

Something measured, with a date and numbers. Tuned constants live here next to
the evidence that produced them.

| | |
| --- | --- |
| [[2026-09-19-lan-tls-verification]] | Proving the LAN HTTPS approach works, and two conclusions that were wrong |
| [[2026-09-19-ios-devicemotion-sampling]] | The real sample rate (60.00Hz), stall behaviour, and why a peak threshold cannot separate a backhand from a hand gesture |
| [[2026-09-19-swing-detector-tuning]] | The duration/merge/classification thresholds that do separate them |
| [[2026-09-20-shot-envelope]] | The shot-feel constants, and two fixture-design bugs that cost more than the tuning |
| [[2026-09-20-serve-reachability-recheck]] | The "unreturnable serve" finding did not reproduce: every legal serve power gives a 0.48–0.67s return window |
| [[2026-09-20-streaming-swing-latency]] | Batch detection is 1066ms late. Streaming is 117ms and fires on the backswing — and the fixtures are all denser than gameplay |
| [[2026-09-20-serve-reachability]] | **Superseded.** The original, wrong claim — kept so nobody re-derives it |

## Sessions

`sessions/` holds one gitignored log per session — raw, honest, local scratch.
They are an inbox, not the product: what survives gets promoted into the
folders above and recorded in [[log]]. See `llm-knowledge/sessions/README.md`.

## Known gaps

Things that are true today and that a session should not be surprised by.

- **The game cannot be played end to end.** The controller is built
  (2026-09-20) but there is no `src/server/main.ts`, so the relay exists only
  in dev. [[architecture]] has the detail.
- **Nothing has been seen running.** No session has opened the host page or
  the controller page in a browser, or played a rally on real phones. The
  renderer, phase 9's tuned constants, and the whole controller (permission
  gate, swing streaming, reconnect) are all unverified against how the game
  actually feels and behaves on real hardware. See [[modules/controller]]'s
  "What is and is not verified".
- **The streaming detector's backswing-misfire finding is against
  multi-rep fixtures only.** Every committed trace is a multi-swing capture;
  the game only ever sees single swings. [[0009-streaming-swing-detection]]'s
  "What would overturn this" names six single-swing traces, recorded with
  rally-like spacing, as the next thing to check with a phone in hand.
- **Nothing decides who serves first.** `main.ts` hardcodes `near`; there is
  no lobby UI and no protocol message for it.
- **How long iOS waits before suspending a backgrounded tab is unmeasured**,
  which is why the relay's 15s ping interval is a guess rather than a tuned
  constant.
