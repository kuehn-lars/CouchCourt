---
title: Project log
updated: 2026-09-25
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
CI. `src/shared/protocol.ts` with runtime guards and 12 tests. The product
brief rewritten around the actual thesis; `CLAUDE.md` written as a working contract.

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

## [2026-09-20] build | Controller (seam 1): the phone streams swings

Design-then-implement across two sessions on `feature/controller`. Design
session measured that a rolling buffer into `detectSwings` cannot be fast
(median 1066ms) and that firing early costs almost nothing the simulation
reads, then wrote a 7-task TDD plan. Implementation session executed it via
`superpowers:subagent-driven-development` — a fresh implementer + reviewer
per task, six tasks reviewed clean, one parked finding.

Shipped: `src/shared/swing/stream.ts` (`createSwingStream`, the live
counterpart to `detectSwings`, sharing its classification code via a newly
exported `swingFromPeak`); `src/controller/session.ts` (socket identity,
`sessionStorage`-backed resume, exponential backoff); `src/controller/wake-lock.ts`
(extracted from the recorder, now shared); `src/controller/main.ts` (the real
entry point — `detectSwings` finally has a production sibling calling into
its shared code). 260→263 tests, all green; `npm run build` confirmed to emit
a working `dist/controller/`.

Promoted: `stream.ts` added to [[0009-streaming-swing-detection]]'s `code:`.
Rewrote [[modules/controller]] and [[modules/shared-swing]];
[[architecture]]'s "two open seams" is now one.

**Not verified: nothing has met a phone.** No session has opened the
controller page on real hardware, so the wake lock's behavior over a whole
match, the reconnect logic against a real suspend/resume cycle, and the
streaming detector's backswing-misfire finding (measured only against
multi-rep fixtures, never a single-swing capture) all remain open. Recording
six single-swing fixtures and playing a rally on real phones is the next
session's first task, not this one's — see [[modules/controller]]'s "What is
and is not verified".

Also found: a cosmetic, twice-repeated defect in this session's own process —
two of six task commits (Tasks 2 and 4) carry a `Co-Authored-By` trailer
naming the implementing subagent's own model rather than the literal text the
dispatch asked for. Parked rather than fixed (see the plan's ledger); harmless
to the code, worth a rebase if the history bothers anyone.

## [2026-09-20] build | Playable: entry point, lobby, solo, camera, stadium, sound

One session on `feature/playable`, working from a six-part request: build the
production entry point, a lobby, a single-player mode, better camera controls
("you can currently only see one character"), sound, a better-looking scene,
and ball physics that depend on phone motion.

**Seam 2 closed** — `npm start` is `vite build && vite preview` with the relay
attached by the same plugin that attaches it in dev
([[0010-vite-preview-as-production-server]]). Found while proving it: Vite's
TLS server is an `Http2SecureServer` in every mode, and `relay-plugin.ts`'s
comment had claimed the opposite since the day it was written
([[vite-https-is-http2]]). Both hops now have integration tests, the TLS one
against the real server shape.

**Phone motion reaches the ball.** `Swing.spin` from the peak's `beta` axis
→ `MatchState.spin` → per-shot `gravityScale`. Measuring it exposed something
worse: **the serve landed in the box at only 7 powers in 35**, and two
committed fault fixtures were depending on that brokenness. A serve is hit
overhead and aimed, so contact is at 2.6m and the launch angle lerps by power
along the measured landing band — a flat serve now lands at every power, and
spin is what makes it missable ([[2026-09-20-serve-that-lands]],
[[2026-09-20-spin-from-wrist-roll]]).

**Solo mode** — `createBot(side, skill)`, an input source rather than a
simulation feature. Skill is a planned timing error. Two perfect bots rally
indefinitely, which is why 0.7 is the default.

**The camera complaint had a number behind it.** A frustum test passed for
the old camera; the thing that was wrong is apparent size — the far player
rendered at 0.25x the near player's height. 26m back with a 19° lens makes it
0.55, and the test pins the ratio with the old value written in beside it
([[2026-09-20-camera-framing]]). Three modes, cycled with `C`.

**Lobby, stadium, sound.** A QR join code (one new dependency,
[[0011-qrcode-generator-dependency]]), a roster, solo/versus/rematch, a
countdown, and who-serves-first finally decided. A tiered bowl with a
1,400-instance crowd. Synthesised hit/bounce/point, no asset files.

**Nothing here had ever been seen running.** With no browser tooling in the
session, headless Chrome plus a ~40-line CDP client over the `ws` dependency,
and a fake phone speaking the wire protocol from Node, produced screenshots
and console capture. Three bugs came straight out of that and no test would
have found any of them: `el.hidden` beaten by a `display` rule, a crowd
buried inside the concrete, and a lobby that jammed forever once both phones
had disconnected once — which amended [[0006-relay-session-policy]]'s "a
slot is never reclaimed".

300 tests, typecheck, lint and vault green. The whole match loop was then
watched end to end in that same headless Chrome — lobby, countdown, a set
played out to 6-0, the winner screen, rematch — after the first attempt at it
failed for a harness reason worth remembering: a single CDP socket held open
across a 20-minute wait dies, so poll with short-lived connections and attach
to an existing tab instead of opening one.

**Still not verified: a real phone, a real swing, a real frame rate.**

## 2026-09-21 — The swing decides where the ball goes, and the players go and get it

The report was blunt: a forehand and a backhand played identically, and the
game should feel like Wii Tennis. Both halves turned out to be one problem —
nothing downstream of the phone believed anything the phone said about the
swing, and nothing on the court moved to meet the ball.

**Six new 30-second captures were the first thing, and they broke the
detector.** Nine 6s traces had said it was perfect; the new ones said 53%,
with `forehand-06` at **0 out of 10**. Two separate faults:
`SERVE_GAMMA_THRESHOLD_DEG_S` was measuring swing *speed* (hard forehands hit
`|γ|` of 1063), and alpha was being read at the magnitude peak, which in a
fast swing is often almost pure gamma. The signed alpha integral over a whole
episode is 52/52 correct, but cannot be streamed; **alpha at the largest-|α|
sample**, held 150ms past the decay trigger, gets 52/55 and 50/52 on
gameplay-shaped swings with zero false positives. The phone stopped guessing
serves entirely — the sim knows from `phase`.
[[0012-swing-kind-is-the-shot-direction]],
[[2026-09-21-swing-direction-classifier]].

**Holding 150ms exposed a bug that predated it.** Detector latency was already
133ms against a 120ms clean window and **nothing anywhere compensated for
it** — every swing a person made was reading late. `Swing.lag` now carries
the delay, measured inside the phone's own clock so 0007 still holds, and the
host subtracts it. [[0013-detector-latency-is-compensated]].

**Direction from the stroke, aimed at a place.** The first version was the
"one lerp" 0008 called for and it broke three tests immediately; dropping the
constant would have hidden the real problem, which only appears once players
move — a fixed sideways push from `x = +3` lands out at all 20 powers.
Aiming instead lands 150 of 200 across five contact positions and both
strokes. `MISHIT_SPRAY_MAX` deliberately restores the "a bad mishit does not
land in" property that had been resting on direction-from-timing.

**Players run in x and z, and one predictor says where and when.**
[[0014-players-run-to-the-ball]]. Volleys fall out of asking "can I get
behind the bounce in time" rather than from a rule about when a volley is
allowed. Three bugs on the way, all found by instrumenting a rally that had
gone quiet: a predictor that did not know the ball had already bounced, a
strike time computed from the player's speed instead of the ball's (~130ms
late on every groundstroke), and a reachability test that a ball moving away
faster than a player runs can never satisfy.

**Four distinct swing animations**, driven by a new `MatchState.stroke`, and
`detectEvents` pulled into its own `render/events.ts` so it could be tested —
it had none, and it is now the branch deciding which animation plays.

**Watching it run found four more bugs, and none of them were in the game.**
The server *died* on the first attempt: `relay.ts` had no `error` listener on
any socket, and Node throws an unhandled `'error'`, so one malformed frame
takes down the host page, every controller and the relay together
([[relay-survives-a-broken-client]]). The relay dropped `lag` on the wire, on
the day the field was added, exactly as a comment in its own test file had
warned. The relay was killing Vite's HMR socket, and the first fix for that —
`path` — **did not work**, because `ws` answers 400 and destroys a
non-matching upgrade rather than declining it; the browser kept saying so
after a test said otherwise ([[one-port-one-websocket-path]]). And a
screenshot showed a player with their legs off the bottom of the frame:
the camera was framing the range players used to occupy
([[2026-09-21-camera-frames-a-moving-player]]).

Two tests had to be rewritten because they were measuring the wrong thing.
`bot.test.ts`'s skill check counted score *changes*, which reads backwards
once a hopeless bot loses 6-0 and stops. The first relay-path test asserted a
second listener was *called* — which an EventEmitter does either way, so it
passed under the mutant while throwing in the background.

391 tests, typecheck, lint, build and vault green. The match was then watched
through a full game in headless Chrome with no console errors.

**Still not verified: a real phone, a real swing, a real frame rate.** And the
direction accuracy is still measured only against multi-rep captures — six
single swings at rally spacing remain the recording this project keeps asking
for.

## 2026-09-22 — The contact model: returns connect, and it plays like Wii Tennis

**Why every return whiffed.** The user reported that only the serve ever
connected. Driving the real sim showed it: `applySwing` re-predicted the strike
*when the swing arrived*, and a swing announced ~200ms after its peak arrived
after the ball had passed, so the predictor invented a strike further on and a
perfectly timed swing read as **650ms early**. Latency compensation was right
and useless — the thing it was compared with had moved. The serve has no
timing, so it always worked.

**Rebuilt around one frozen contact per ball** ([[0015-contact-model]],
superseding [[0012-swing-kind-is-the-shot-direction]] and
[[0009-streaming-swing-detection]]): early swings are held and struck at the
contact, late ones are rewound, the hardest peak in the window wins. Direction
is timing (the Wii rule) and forehand/backhand comes from where the ball is.
Launches are solved through `stepBall` to land where aimed. The serve is
toss-then-hit. The phone announces each rotation peak ~50ms after it instead
of ~200ms. The renderer coils the racket before contact, runs the legs, swings
at air on a whiff, and draws a rewound ball off the racket. The controller page
was redesigned around a live swing meter.

**Balanced against a simulated human**, which found that nothing could ever be
beaten on the run (1.1-1.3s flights, 1.8m reach) and humans never missed
([[2026-09-22-contact-model-feel]]). Shipped: a σ=60ms player beats the 0.7
bot 25-14 in points, a σ=100ms one loses 16-29. The balancing also caught
`revise` judging a late swing by its arrival instead of when it happened, and
a net-lift step that made harder swings fly slower.

382 tests, typecheck, lint, build green; watched in headless Chrome with a
scripted phone, no console errors. **Not verified: a real phone, a real person,
`TIMING_IDEAL`, the iOS 18 haptic trick.**

## 2026-09-22 — The stroke decides where the ball goes; timing decides how well

**The ask.** Forehand, backhand and overhand should decide the direction
instead of the physics; the overhand only on a ball in the air; balls landing
in the court rather than on the baseline; more depth, skill-based without
being frustrating; and a corner readout on the phone of the move it reads, to
debug the classifier. Permission to break ADRs.

**What landed** ([[0016-stroke-decides-direction]], superseding decision 4 of
[[0015-contact-model]]): forehand to screen-left, backhand to screen-right —
screen space, so the far player's ball follows their own sweep — and an
overhead is a smash down the middle that only connects out of the air. The
predictor now offers high balls out of the air as smash chances. Timing is a
trade: on time is paced and wide of the middle, early goes wider then out,
late goes central, deeper, and long if hit hard. Clean balls land 5.5–8.8m
past the net. The bot picks its stroke and its skill is a timing spread.
The phone reads overhead from the racket position going into the swing and
the side from `alpha + 0.4·gamma` at the peak.

**Found on the way** ([[2026-09-22-stroke-classifier]]): the peak detector's
side reading had quietly fallen to 54/60 when 0015 replaced the hold
detector — nobody measured it because the sim ignored `kind`. Now 58/60, and
8/8 overhands. **Balance** ([[2026-09-22-stroke-direction-balance]]): pace is
a knife-edge under auto-movement when every shot lands in one place (27 m/s:
all winners; 23 m/s: nobody beatable); the gradient came from timing moving
width and pace together. Shipped: decent player wins 57% of points against the
0.65 solo bot, a newcomer 43%; rallies 8–11 strokes.

398 tests, typecheck, lint green; watched in headless Chrome — a scripted
phone sending mixed strokes against the bot, and the controller's readout
driven by synthetic `devicemotion` — no console errors. **Not verified: a real
phone, a real person, recorded smashes (only serves back the overhead rule).**

## [2026-09-23] build | The host and the phone, redesigned

Lobby as a title screen: headline, join QR, two animated seats, how-to
slides, and two machines rallying behind it under a slow crane camera
(`attractPose`, tested at 16:9 and 16:10). Broadcast scorebug, wipe-in
umpire's call ("Game, Near", no dashes), cinematic countdown, pause and
result screens, a settings sheet (camera, machine level, sound, lobby rally,
full screen). Phone: animated swing on the gate, swipeable cards, a 270°
power dial in the player's colour, stamped feedback, a settings sheet.
Far player amber → ice. Near plane 0.1 → 1 (court striped against the
apron from the crane). 408 tests.

Promoted: [[0017-phosphor-icons-and-the-visual-system]],
[[touch-action-is-an-intersection]]; [[modules/host]] and
[[modules/controller]] updated. Seen in headless Chrome only; nothing on a
phone.

## [2026-09-24] build | A stadium worth playing in, split screen, and a racket on the phone

**The ask.** Go all the way on the 3D scene (lighting, comic-realistic look,
characters, animation) without touching the feel, sound or haptics; split
screen for two players; and a phone match screen that is not a generic
gauge. Permission to overturn earlier decisions.

**What landed.** A rebuilt renderer ([[0018-stylised-stadium-renderer]]):
cel-shaded, ink-outlined, articulated athletes (layered poses: stance, run or
shuffle, coil, stroke, reaction; strokes join at the contact frame; a smash
jumps; a ponytail on a spring; a racket smear), real player shadows, bloom and
a grade, a night stadium with an upper deck, LED boards, floodlight beams, a
3,860-strong crowd that reacts and does a wave, a chair umpire and ball kids
who watch the ball, comic impact effects, and a victory orbit round the
winner. Split screen ([[0019-split-screen]]) with the sim told whose
screen-left is whose. The phone's match screen is now a racket whose strings
carry the message as a stencil ([[0020-the-phone-is-the-string-bed]]), fed
by a new optional score line on the wire.

**Found:** the pause after a point is one tick (no room for a cutaway); a
stencil on translucent strings is invisible even when it is there; vitest
passed while one launch path missed the split flag, typecheck caught it; a
canvas rendered once after a long synchronous loop screenshots black.

449 tests (up from 408), lint, typecheck, build green; every state seen in
headless Chrome. **Not verified: a real GPU's frame rate, a real phone.**


## [2026-09-24] fix | The host went black on a real GPU

On an M3 the host flashed the stadium, then went black. The cause was not
GPU power. three invalidates a multisampled target after every render, and
bloom (and a split screen's second view) drew into it again. Apple GPUs
discard it, SwiftShader does not. The composer target is now `samples: 0`.
Checked on the real Metal GPU through headless Chrome: renders, 60fps in
the lobby. Promoted: [[msaa-target-is-discarded-after-resolve]]. Not
verified: split screen and a full match on the real GPU.

## [2026-09-24] fix | Black rectangles flickering on the host

On an M3, black rectangles flickered across the host screen on about 5% of
frames. The floodlight beam shader took `pow` of a value that interpolation
pushes just below zero at the court end. Metal returns NaN for that, and
bloom spread the NaN into blocks. The base is now clamped. With the host read
back on the real Metal GPU in the lobby, frames with NaN went from 3–7 in
100–150 to 0 in 251. Promoted: [[nan-pixels-become-bloom-blocks]]. Not
verified: a full match and the split screen on the real GPU.

## [2026-09-24] build | CouchCourt: renamed, a logo, a README, and PRODUCT.md retired

SwingCourt is now CouchCourt everywhere, including the storage keys. The mark
is a tennis ball whose rim and seam are two Cs (`src/logo.svg`). It was
chosen from four drawn in parallel, and it is now the favicon and both brand
headers. `PRODUCT.md` was deleted: its out-of-scope list moved into
[[architecture]], and ~35 citations were rewritten to stand alone. The README
was rewritten with an SVG header, real screenshots (host on the Metal GPU,
controller at iPhone size), and a section on the persistent-memory experiment.
MIT `LICENSE` added. Promoted: [[0021-couchcourt-name-and-mark]]. Not
verified: the README as GitHub renders it (Mermaid, badges, header fonts on
non-Apple systems).

**Reported by the user the same day:** played end to end on an iPhone 14 Pro and
an iPhone 16e, working on both. That is the first real-phone play recorded
here. [[architecture]] and the README status were updated. Nothing was measured
(misread rate, latency, balance).

## [2026-09-24] build | `npm run certs` without openssl, so the host can be Windows

The only thing tying the host to macOS or Linux was `setup-certs.mjs`
shelling out to `openssl`. The certificate work moved to `scripts/cert-chain.ts`
on `node:crypto`, test-first against a throwaway chain in `tests/fixtures/certs/`
(11 tests; the hostname and expiry guards were each broken on purpose and
caught). Run live with only `node` on the PATH, it rebuilt a byte-identical
`cert.pem`. `vitest` and `tsconfig.test.json` now include `scripts/**/*.test.ts`.
Updated [[modules/tooling]] and [[lan-https-cert-chain]]. Not verified: an
actual Windows machine, including the firewall prompt the README now warns
about.

## [2026-09-24] build | CI on Linux, Windows and macOS

`verify` is now a three-OS matrix, and `.gitattributes` forces LF so Windows
checkouts pass Biome and the vault checker. The workflow validates against the
Actions schema. Not yet run: it needs a push. [[modules/tooling]].


## [2026-09-25] refactor | Review fixes: certs checked before writing, setup-certs is TypeScript

From a code-quality review of the rebrand. `npm run certs` now checks the chain
in memory and writes only one that passes; a failing chain already on disk is
deleted before the rebuild, so `./certs` only ever holds a checked chain. The
script is `setup-certs.ts`, typechecked by `tsconfig.node.json`; `engines` is
`>=24.3` because type stripping warns through 24.2.0 (bisected), which lets
the `--disable-warning` flag go. `issuerUrl` throws on a non-certificate
instead of reporting "no AIA". Dead `color` rules on the logo and the favicon
comments trimmed. A PII sweep of the tree and history found nothing beyond one
RFC1918 LAN address, replaced in the tree; history was not rewritten. All three
cert paths run live on Node 24.3.0. [[modules/tooling]].

## [2026-09-25] fix | Pre-pin review: guards proven, the right URLs printed, host.css split

`npm run dev` and `npm start` printed Vite's `https://<ip>:5173/`, which the
certificate does not cover, and the host puts its own origin in the QR code.
`scripts/lan-urls.ts` now replaces `printUrls` in both servers with the
local-ip.co Host and Controller URLs (test-first; both servers started, the
printed URL answered 200 with a verified chain). `setup-certs` shares its
hostname and output lines, and checks the downloaded key matches the leaf
(`keyProblem`). A mutation run showed that removing the signature,
root-validity or not-before check in `chainProblem` left every test green;
new fixtures (an impostor intermediate, a short-lived root) make each one
fail. `host.css` (1256 lines) is now an `@import` list over
`src/host/styles/`, with the built CSS proven identical apart from one moved
rule. `chunkSizeWarningLimit` 700, because three.js alone is 543 kB.
`.nvmrc` → `lts/krypton`. The README drops "vibe coding", stale counts, "v1",
and the Network-line advice, and says what the public key costs. Comments
that still quoted `PRODUCT.md` now state their reason. [[modules/tooling]],
[[modules/host]], [[0004-lan-https-via-local-ip-co]]. The GitHub repo was
renamed to `CouchCourt` the same day, matching the CI badge. Not verified: a
phone scanning the QR from a host opened at the printed URL.

## [2026-09-25] fix | Windows vault check, dependency majors

`vault:check` failed only on Windows: `path.relative` gives backslashes and
the module-coverage rule matched on `llm-knowledge/modules/`. Normalised to
`/`, proven by simulating backslashes on macOS. Took Dependabot's Vite 8,
Vitest 5, `actions/checkout@v7` and `actions/setup-node@v7`; all checks green
and dev/preview smoke-run. Declined `@types/node` 26: the runtime is Node 24,
and Dependabot now ignores its majors. [[modules/tooling]],
[[vite-https-is-http2]].

## [2026-09-25] fix | Haptic feedback removed

It never fired on an iPhone: iOS Safari has no `navigator.vibrate`, and the
`<input switch>` label-click trick was closed in iOS 26.5 (and needed a user
gesture, which a swing is not). Removed the `buzz`, the hidden switch, its CSS
and the "Haptic tick" setting. A stored `haptic` pref is ignored by
`parsePrefs`. Promoted: [[ios-web-haptics]].

## [2026-09-25] process | Session logs open with a handover

Each session log now starts with a `## Handover` section (goal, state, open,
next), rewritten after every response, so a new chat can resume from the
newest log even when the last one ended mid-session. The iterations below it
stay append-only. Rules are in `CLAUDE.md` §2. Also bumped the README badges to
Vite 8 and Vitest 5.

## [2026-09-25] verify | QR join from the printed URL works

Reported by the user: a phone scanning the join QR code from a host opened at
the local-ip.co URL that `npm run dev` / `npm start` now print joins
correctly. This closes the "Not verified" in the pre-pin review entry above.
Still not verified: a real Windows host.
