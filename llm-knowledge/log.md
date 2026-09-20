---
title: Project log
updated: 2026-09-20
tags: [meta]
status: current
---

# Project log

Append-only, newest at the bottom. One entry per session that landed
something, written **when the session's work is promoted**, not while it runs.

This exists because `sessions/` is gitignored: a fresh clone has the code, the
vault and `git log`, and otherwise no idea what order any of it happened in or
what was tried and abandoned. This file is the committed half of that memory.
The session log is the raw account; this is the one line that survives it.

Every entry starts `## [YYYY-MM-DD] <kind> | <title>`, so
`grep '^## \[' log.md | tail -5` gives the last five.

Kinds: `build` (something shipped), `fix`, `tune` (constants moved), `doc`
(vault only), `spike` (explored, kept nothing).

---

## [2026-09-19] build | Repository harness, CI and the vault

Single package, Vite MPA, Biome, Vitest, three-project typecheck, five-step
CI. `src/shared/protocol.ts` with runtime guards and 12 tests. `PRODUCT.md`
rewritten around the actual thesis; `CLAUDE.md` written as a working contract.

Promoted: ADRs [[0001-single-package-vite-mpa]] through
[[0005-raw-websockets-over-socket-io]], four platform notes, [[wire-protocol]],
[[tennis-scoring]], [[2026-09-19-lan-tls-verification]].

**The through-line, and why `CLAUDE.md` §3 insists on watching a test fail:**
three separate times in one session a green result meant less than it looked
like — a broken certificate chain `curl` silently repaired, an edit that
silently did not apply while the suite stayed green, and a type-safety guard
destroyed by an unrelated fix with nothing turning red. Every one was caught
by breaking something on purpose, never by the suite passing.

## [2026-09-19] fix | LAN HTTPS, twice

Two independent causes, one symptom ("the page will not load on the phone"),
found a day apart. Router DNS rebind protection dropping the answer
([[lan-https-dns-rebind]]), and local-ip.co's published chain being stale
relative to its leaf ([[lan-https-cert-chain]]).

The second cost a full debugging cycle because `openssl verify` had failed
from the very first run and **the failure was explained away** as openssl not
reading the macOS keychain. It was not. When two tools disagree about a
certificate, the stricter one is describing reality.

## [2026-09-19] build | Trace recorder, and 20 committed motion traces

`src/controller/record.ts`, `src/shared/swing/trace.ts`, a dev-only save
endpoint. Both iOS gates proven on an iPhone 14 Pro / iOS 26.6.1: the LAN
HTTPS path and `DeviceMotionEvent.requestPermission()`.

20 traces across all seven labels, including the negatives that matter more —
phone on a table, in a pocket, someone walking, someone talking with their
hands.

Promoted: [[2026-09-19-ios-devicemotion-sampling]],
[[vitest-is-a-vite-serve]]. **The finding that shaped everything after:** peak
angular velocity cannot separate a soft backhand from a hand gesture. The
ranges overlap and no threshold exists that works.

## [2026-09-19] build | Swing detector

`src/shared/swing/detector.ts`. Duration-at-a-moderate-threshold plus episode
merging, not peak. 0 misclassifications, 0 false positives, 0 misses across
all 20 traces.

Promoted: [[2026-09-19-swing-detector-tuning]]. Every threshold checked at
nearby values to confirm it sits on a plateau rather than a knife-edge fit.

## [2026-09-19] build | WebSocket relay

`src/server/lobby.ts` (pure, socket-free) and `src/server/relay.ts` (real
`ws`), split so the slot logic gets unit tests and only the wiring needs an
integration test. Resume-by-`playerId` and a ping/pong heartbeat.

Promoted: [[0006-relay-session-policy]] — three gaps the protocol left open,
decided here rather than blocked on.

Flagged and deliberately not built: a standalone production entry
(`src/server/main.ts`). Still not built — [[architecture]]'s seam 2.

## [2026-09-19] doc | Simulation build plan

Nine phases committed to a `plans/` folder so a multi-session branch was
legible to a session that did not start it. Four decisions settled up front
because each changed the shape of several phases: camera, shot direction,
serve lets, swing timing source.

The plan was deleted when phase 9 landed, per its own rule. What survived it
is [[coordinate-frame]], [[0007-host-arrival-time-for-swing-timing]],
[[0008-timing-not-aim-for-shot-direction]], the renderer rules now in
[[modules/host]], and the let decision recorded in [[tennis-scoring]].

## [2026-09-20] build | Simulation phases 1–6: geometry, ball, scoring, players, shot, rally

`src/shared/sim/` from nothing to a complete, deterministic, replayable game.
Ends with `tick` and the full-set replay test that is the regression net under
every later tuning change.

Mutation testing ran on every phase and repeatedly earned its keep: it found
two tests that were vacuous by construction, a bounce reflecting the wrong
velocity (invisible in any single measurement), a flat net no test could see,
and two deliberately-added pieces of logic in `shot.ts` with zero coverage.

Nothing promoted from phases 1–5 on purpose — those design calls are
load-bearing comments three lines from the code they describe.

## [2026-09-20] build | Simulation phases 7–8: host loop and renderer

`src/host/loop.ts`'s fixed-timestep `advance`, the rAF loop and socket wiring
in `main.ts`, and six files of Three.js under `src/host/render/`.

Promoted: one paragraph in [[wire-protocol]] on why `main.ts` does *not*
validate `HostBoundMessage` — it reads like a missing guard otherwise.

**Not verified:** no session has opened the host page in a browser. Still
true.

## [2026-09-20] tune | Phase 9: the playability envelope, and a note that was wrong

`sim/playability.test.ts` as a permanent envelope. `GROUND_SPEED_MAX` 30→28
and `HEIGHT_ANGLE_BOOST` 0.3→0.5 — both together, because each alone made the
other end worse.

Also: the existing `2026-09-20-serve-reachability` note's central claim did
not reproduce. Re-run rather than trusted, superseded by
[[2026-09-20-serve-reachability-recheck]]. A hand-derived physics claim needs
the same treatment as any other guard.

Promoted: [[2026-09-20-shot-envelope]],
[[0007-host-arrival-time-for-swing-timing]]. The plan was deleted.

## [2026-09-20] doc | Vault rebuilt around the llm-wiki pattern

The vault's four folders all answered *why* and nothing answered *what is
wired to what*, so it could not describe the system it was about. Added
[[architecture]], `modules/` (seven pages), this log, and two lint rules that
keep the structure from decaying — orphan detection and module coverage of
`src/*`.

Recovered the deleted simulation plan from git history and re-promoted what
outlived it. Nothing was dropped.

**Found while tracing imports, and previously unrecorded anywhere:** the game
cannot currently be played. The host is wired end to end, the controller is a
placeholder, `detectSwings` has no production caller, and there is no
production server entry. Every subsystem is individually finished and tested.
See [[architecture]]'s "two open seams".
