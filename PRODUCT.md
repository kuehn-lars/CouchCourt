# SwingCourt

Motion controlled tennis for your living room, no console required.

## What it is

SwingCourt turns a MacBook and a couple of iPhones into a local multiplayer
motion tennis game. The Mac is the screen and the game host. Each player opens a
web page on their phone, which becomes their racket. Swings, timing and
direction are read from the phone's motion sensors and turned into shots on the
court shown on the Mac.

No app installs, no accounts, no internet beyond the Wi-Fi everyone is already
on.

## The real idea

The tennis is the excuse. The idea is that **a format we lost is buildable
again, out of hardware everyone already carries.**

**1. Local multiplayer disappeared for distribution reasons, not design ones.**
Consoles solved "everyone in one room" and people loved it. Phones inherited the
audience and lost the format — not because gathering around one screen stopped
being fun, but because the app store put a download, an account and an update
between a guest and the game. The format didn't fail. Its delivery did.

**2. Every guest is already carrying a motion controller.** An iPhone has an
accelerometer, a gyroscope, haptics and a browser. The only missing piece was
permission to use the sensors from a web page, and iOS grants that with one tap.
Nobody has to buy, charge, pair or find anything.

**3. The constraints are the product, not a limitation.** Zero install, zero
account, local only — these read like engineering modesty and they are actually
the whole proposition. The moment one person has to download something, they
stop being a player and start being a queue. Any feature that reintroduces a
download, a login or a cloud dependency defeats the point, however good it is
otherwise.

**4. Feel beats fidelity.** The motion games people remember were not accurate.
They read timing and intent and threw away most of the rest, and that is *why*
they felt good — the game met you more than halfway. Chasing 1:1 tracking would
cost enormous effort to make the game worse. We are building a game that is
generous about what counts as a forehand.

**5. The hard problem is the first thirty seconds, not the physics.** Ball
physics is a known quantity. Getting a guest from "here, scan this" to "I'm
playing" with no instructions, no warning screens and nothing typed is the part
that actually decides whether this works at a party.

That last point is not a prediction. Every genuinely hard problem solved on this
project so far has been in those thirty seconds — iOS refusing motion sensors
outside a secure context, certificate chains iOS rejects that macOS silently
repairs, home routers dropping the DNS answer that makes the whole scheme work.
None of it was tennis. **Treat onboarding as the core engineering problem and
the gameplay as the part that comes after.**

## What good looks like

Concrete bars, in rough order of importance:

- A guest who has never seen the game goes from **scanning the code to swinging
  in under a minute**, with nobody explaining anything and nothing typed.
- A swing that felt like a forehand **reads as a forehand**, and setting the
  phone down mid-conversation **never** reads as a shot.
- The delay between the swing and the ball leaving the racket is **not
  something a player notices**.
- A player who locks their phone, takes a notification, and comes back is
  **still the same player on the same side** — they did not become a spectator.
- Someone who has played real tennis is not annoyed by the scoring.

If those hold, the game is good. None of them are about graphics.

## Core experience

1. Host opens the game on their MacBook; a local server starts.
2. The host screen shows a QR code.
3. Players scan it with the iPhone camera and the controller opens in Safari.
4. Each phone asks for motion permission once, with one tap and a clear reason.
5. Players see their assigned side and a ready state.
6. The host starts the match; swings on the phone drive shots on screen.

## Scope for v1

- 1v1 singles
- Forehand, backhand, serve
- Shot power from swing speed
- Ball physics with automatic player movement — players do not run the court
  manually
- Score tracking per game and set
- Sound for hits, bounces and points

## Explicitly out of scope for v1

Doubles. Manual player movement. Play across different networks. Custom
characters. Accounts or stats that persist between sessions.

These are not "later" — they are not v1, and building toward them now would add
structure the game does not need yet.

## Design principles

- **Zero install** — everything runs in a browser, on both ends.
- **Zero friction setup** — one QR code from picking up a phone to playing.
- **Local first** — gameplay never depends on an internet connection.
- **Own assets only** — no characters, music or branding borrowed from existing
  motion sports games, so the project stays clean to publish and share.
- **Generous input** — when in doubt about what a player meant, guess in their
  favour.

## Non goals

SwingCourt is not a precise motion tracking system and not a competitive title.
Timing and intent matter more than motion capture. The bar is "feels good to
play with friends", and it is higher than the bar for "technically accurate."
When the two conflict, feel wins.

## Technical shape

How the pieces connect is `llm-knowledge/architecture.md`. The decisions and,
more usefully, the alternatives rejected are recorded as ADRs in
`llm-knowledge/decisions/`. In brief:

| | |
| --- | --- |
| Server | Node, serving both pages and relaying WebSocket messages |
| Simulation | Runs in the host browser; the server holds no game state |
| Transport | Raw `ws` — swing detection happens on the phone, so the wire carries a few semantic events per rally, not a sensor firehose |
| Rendering | Three.js — tennis is a depth game, and there are no sprites to draw |
| Motion input | DeviceMotion / DeviceOrientation in iOS Safari |
| Local HTTPS | A publicly trusted certificate for the LAN address, so guests install no CA and see no warning |

`llm-knowledge/index.md` is the catalog, and `llm-knowledge/modules/` has one
page per subsystem mapping it to the files responsible for it.

## Status

**Playable end to end, and never yet played by a person.**

`npm start` builds and serves both pages over LAN HTTPS with the WebSocket
relay attached, so a guest can scan the code on the host screen and be
swinging. Built and tested: the swing detector, the streaming detector the
phone actually uses, the relay with slot assignment, resume and liveness, the
full simulation (ball physics, shot feel, automatic movement in both axes,
volleys, scoring, a deterministic replayable rally machine), a solo opponent,
the Three.js renderer with three camera modes and a distinct animation per
stroke, a lobby with a join QR code, and synthesised sound. 398 tests.

**The swing decides the shot.** A forehand sends the ball to the left of the
screen, a backhand to the right, and an overhead smashes a high ball taken out
of the air. Timing decides how well: on time is a paced, angled ball; early
goes wider and eventually out, late goes deeper and eventually long. The
phone shows which stroke it read, in a corner of the controller.
Players run to where the ball will be — in and back as well as side to side —
and take it out of the air when they cannot get behind the bounce in time.

**Seen running, in headless Chrome only** (2026-09-20, again 2026-09-21): the
lobby, the countdown, a match played out with the scoreboard ticking through
0 all / 15 / 30 / 40 / Game, the winner screen and a rematch, plus the
controller's join flow through its permission gate, with no console errors on
either page. Watching it, rather than testing it, is what has found almost
every serious bug in this project — seven so far, across two sessions, none
of which any test caught.

**Not verified: a real phone, a real swing, a real frame rate.** Headless
Chrome has no motion sensors and renders in software, so how the game *feels*
— the bar this document actually sets — is still unmeasured. So is whether
`Swing.spin`'s rotation axis tracks the wrist the way it assumes
(`llm-knowledge/experiments/2026-09-20-spin-from-wrist-roll.md`).

**And the direction classifier's accuracy is an upper bound.** 26 motion
traces are committed in `tests/fixtures/motion/` — forehands, backhands and
serves, plus the negatives that matter more: a phone on a table, in a pocket,
someone walking, someone talking with their hands. Every one of them is a
multi-rep capture, and the game only ever sees single swings. Adding traces
has made the detector look worse twice now; assume it will again. Six single
swings recorded at rally spacing are the most valuable thing anyone could add
to this repository.

**Both iOS gates of those first thirty seconds are proven** on an iPhone 14
Pro running iOS 26.6.1: the LAN HTTPS path, and `requestPermission()` for the
motion sensors. The riskiest part of the onboarding was cleared before any
tennis was written, which is the order this project argues for.
