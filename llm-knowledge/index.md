---
title: Index
updated: 2026-09-24
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
| [[architecture]] | How the whole thing connects: the swing path end to end, the match state machine, what each hop may assume, where state lives, and what has and has not been seen running |
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
| [[modules/host]] | `src/host/` | Match state machine, lobby, fixed-timestep loop, cameras (incl. split and victory), the stylised renderer, audio |
| [[modules/controller]] | `src/controller/` | The iOS permission gate, the swing stream, the socket, and the racket the match screen is drawn as |
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
| [[0009-streaming-swing-detection]] | **Superseded by 0015.** The decay-trigger live detector, and why `detectSwings` cannot be streamed |
| [[0010-vite-preview-as-production-server]] | `npm start` is `vite build && vite preview`. Why no hand-written Node entry point exists |
| [[0011-qrcode-generator-dependency]] | The one new dependency, and why the join code is not hand-rolled |
| [[0012-swing-kind-is-the-shot-direction]] | **Superseded by 0015.** The stroke you played decided where the ball went |
| [[0013-detector-latency-is-compensated]] | The phone reports how late its detector was and the host subtracts it. Every swing had been reading late |
| [[0014-players-run-to-the-ball]] | Players move in x and z, and one predictor says where they meet the ball and when. Amended by 0015 |
| [[0015-contact-model]] | **Why returns whiffed, and the fix.** One frozen contact per ball; early swings wait, late ones rewind; hardest peak wins; launches solved to land; toss-then-hit serve; peak detector on the phone. Its "timing is direction" rule is superseded by 0016 |
| [[0016-stroke-decides-direction]] | **Where the ball goes.** Forehand screen-left, backhand screen-right, overhead a smash only out of the air; timing is a trade (early wide, late long); bot skill is a timing spread. "Screen" amended by 0019 |
| [[0017-phosphor-icons-and-the-visual-system]] | The 2026-09-23 redesign: one icon dependency, system type, no UI framework, and the visual rules (dark, one accent, side colours) |
| [[0018-stylised-stadium-renderer]] | **The look.** Cel-shaded outlined athletes under real light, bloom and a grade, real player shadows, articulated rigs with layered poses, a living stadium. Overturns renderer rules 3, 5, 6 |
| [[0019-split-screen]] | Two people, two halves, each from behind their own player — and why the sim needed a per-side "screen-left" |
| [[0020-the-phone-is-the-string-bed]] | The match screen is a racket: stencil on the strings, ripples, a charging frame, a ball you toss. The score line on the wire |

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
| [[vite-https-is-http2]] | Every Vite server with TLS is an `Http2SecureServer`. The relay has always been on one |
| [[one-port-one-websocket-path]] | Sharing a port with Vite means sharing its upgrade handler, and `ws` does not decline politely |
| [[relay-survives-a-broken-client]] | One malformed frame from one phone ended the whole server. Every `ws` socket needs an `error` listener |
| [[msaa-target-is-discarded-after-resolve]] | **Why the host went black on a Mac.** three invalidates an MSAA target after every render; bloom drew into it again. SwiftShader hides it. How to test on the real GPU |
| [[nan-pixels-become-bloom-blocks]] | **Why black rectangles flickered on a Mac.** `pow` of a negative is NaN on Metal; bloom turns one NaN pixel into blocks. How to count NaNs in the HDR target |
| [[touch-action-is-an-intersection]] | A child cannot re-allow a gesture an ancestor's `touch-action` refused. Why the controller's gate is `pan-x` and the match screen `none` |

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
| [[2026-09-20-shot-envelope]] | **Superseded** by solved launches. The shot-feel constants, and two fixture-design bugs that cost more than the tuning |
| [[2026-09-20-serve-reachability-recheck]] | The "unreturnable serve" finding did not reproduce: every legal serve power gives a 0.48–0.67s return window |
| [[2026-09-20-streaming-swing-latency]] | **Superseded** by the peak detector. Batch detection is 1066ms late. Streaming is 117ms and fires on the backswing — and the fixtures are all denser than gameplay |
| [[2026-09-20-serve-that-lands]] | **Superseded** by solved serves. The serve landed at 7 powers in 21. Contact height and a power-lerped angle make it 21 of 21 |
| [[2026-09-20-spin-from-wrist-roll]] | Where `Swing.spin` comes from, and why no committed fixture can confirm it |
| [[2026-09-20-camera-framing]] | The far player rendered at 0.25x the near one. Why a frustum test could not catch it |
| [[2026-09-21-swing-direction-classifier]] | What actually tells a forehand from a backhand, the twelve statistics tried, and the grip-invariant idea that does not pay |
| [[2026-09-22-contact-model-feel]] | The whiff reproduced (−650ms), peak-detector latency (50ms median), and balancing against a simulated human: what made points end |
| [[2026-09-22-stroke-classifier]] | Overhead from the racket position going into the swing (8/8); side from alpha + 0.4·gamma at the peak (58/60, up from a silent 54/60); what failed |
| [[2026-09-22-stroke-direction-balance]] | Why pace was a knife-edge, the timing trade, bot skill as spread, and the shipped win rates |
| [[2026-09-21-camera-frames-a-moving-player]] | The camera framed a court, not the players in it — and the guard passed while the legs hung off the screen |
| [[2026-09-20-serve-reachability]] | **Superseded.** The original, wrong claim — kept so nobody re-derives it |

## Sessions

`sessions/` holds one gitignored log per session — raw, honest, local scratch.
They are an inbox, not the product: what survives gets promoted into the
folders above and recorded in [[log]]. See `llm-knowledge/sessions/README.md`.

## Known gaps

Things that are true today and that a session should not be surprised by.

- **The renderer's frame time is measured once, in the lobby only**
  ([[0018-stylised-stadium-renderer]]). 60fps (p95 16.7ms) on an M3 at 2880px
  wide, after the MSAA fix ([[msaa-target-is-discarded-after-resolve]]).
  rAF caps at 60, so the headroom is unknown. A match and the split screen
  are unmeasured on a real GPU. Likewise the
  phone's racket canvas has never run on a phone.

- **Stroke classification is measured on multi-rep captures only**, and the
  overhead rule rests on eight serve swings — no recorded smash exists. The
  controller's corner readout is there to check it per swing with a phone in
  hand ([[2026-09-22-stroke-classifier]]).
- **The 2026-09-22 feel rewrite is tuned against a simulated human.** The
  balance constants and `TIMING_IDEAL` (network + display latency) need a real
  phone and a real person; the iOS 18 switch-haptic trick is untried. See
  [[2026-09-22-contact-model-feel]].
- **Seen running in a browser, never on a phone.** 2026-09-21: the whole
  loop again — lobby, countdown, a game played out, the scoreboard ticking
  through 0 all / 15 / 30 / 40 / Game — in headless Chrome with **no console
  errors**, and it found four bugs no test had
  ([[relay-survives-a-broken-client]], [[one-port-one-websocket-path]], a
  dropped `lag` on the wire, [[2026-09-21-camera-frames-a-moving-player]]).
  Still no motion sensors and still SwiftShader, so frame rate, the wake
  lock, reconnect-after-suspension and `Swing.spin`'s axis remain unverified
  against real hardware.
- **The direction classifier's 94.5% is the pessimistic figure, and the
  optimistic one is unmeasured.** Every committed trace is a multi-rep
  capture; the 96.2% "isolated swing" number is cut out of those, so both the
  ready position and the pause between swings are synthetic. Six genuine
  single swings at rally spacing would settle it — the same recording
  [[0009-streaming-swing-detection]] has been asking for since it was
  written. See [[2026-09-21-swing-direction-classifier]].
- **Adding traces has made the detector look worse twice.** Nine 6s captures
  said 100%; six 30s captures said 53%. Treat any current accuracy figure as
  an upper bound.
- **`Swing.spin`'s rotation axis is still a design decision, not a
  measurement** ([[2026-09-20-spin-from-wrist-roll]]). Unchanged by the
  2026-09-21 work, which only touched the direction axis.
- **Two perfect bots rally forever** ([[modules/shared-sim]]). Solo mode uses
  skill 0.7, which beats a novice and loses to a decent player; no
  rally-length cap exists.
- **How long iOS waits before suspending a backgrounded tab is unmeasured**,
  which is why the relay's 15s ping interval is a guess rather than a tuned
  constant.
