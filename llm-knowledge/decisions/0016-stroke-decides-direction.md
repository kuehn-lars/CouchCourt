---
title: The stroke you swing decides where the ball goes; timing decides how well
updated: 2026-09-24
tags: [decision, sim, input, swing, core, feel]
status: current
code:
  - `src/shared/sim/shot.ts`
  - `src/shared/sim/rally.ts`
  - `src/shared/sim/players.ts`
  - `src/shared/sim/bot.ts`
  - `src/shared/swing/stream.ts`
  - `src/shared/protocol.ts`
  - `src/controller/main.ts`
---

# 0016 — The stroke decides direction

Settled on 2026-09-22, the evening after [[0015-contact-model]] landed. The
user found that version playable and asked for one change: *forehand,
backhand and overhand should decide where the ball goes, not the physics* —
more playable and more fun even if less realistic — with the overhand only
working on a ball in the air, balls landing in the court rather than on the
baseline, and more depth. Explicit permission to break earlier decisions.

**Amended by [[0019-split-screen]]:** "screen space" below means the screen
that player is watching; on a split screen the far player's screen-left is
+x.

**Supersedes decision 4 of [[0015-contact-model]]** (direction is timing, the
Wii rule; stroke side from the ball's position; the phone's `kind` ignored).
Everything else in 0015 — the frozen contact, arm/rewind/revise, hardest peak
wins, solved launches, toss-then-hit — still holds. It returns to the idea of
[[0012-swing-kind-is-the-shot-direction]] with a better classifier and a
different role for timing. The numbers are in [[2026-09-22-stroke-classifier]]
and [[2026-09-22-stroke-direction-balance]].

## Decision

**1. Three motions, three directions, in screen space.** A forehand sends the
ball to the **left of the screen**, a backhand to the right, an overhead
straight down the middle and hard (`smash`). Screen space, not the avatar's
own left: both players stand in the room facing the same screen, and for the
far-court player the avatar's left is screen-right — their ball would go the
opposite way to their physical sweep. `SCREEN_LEFT` in `shot.ts`.

**2. Timing is how well, and it is a trade.** Dead on time is a paced ball
~0.9m inside the line. Early takes it wider, toward and then past the line;
late holds it toward the middle and pushes it deeper — past the baseline if it
was hit hard. A mistimed ball also floats and slows; a late one pops up.
Monotonic in both directions, so a player can feel which way they missed.
Inside `SAFE_TIMING` nothing is an error.

**3. The overhead only works out of the air.** An overhead at a contact the
ball has already bounced for is a swing at air (a whiff), unless a real
stroke is already armed — then it is that stroke's backswing. So that
overheads have something to hit, the predictor now prefers taking a high
ball out of the air: coming down through `SMASH_HEIGHT` (2.3m) before the
bounce, within reach (`predictStrike`, `canSmash`). A late, popped-up ball is
what usually creates one.

**4. The phone reads the stroke at the peak.** Overhead if the racket went
into the swing held up — the device x axis near horizontal in a gravity
estimate frozen when the rotation lobe starts; otherwise forehand/backhand
from `alpha + 0.4·gamma` at the peak. 8/8 overhands, 59/65 groundstroke
sides, 2/65 groundstrokes read as overhead.

**5. Clean balls land in the court.** Depth 5.5–8.8m past the net by power
(the baseline is 11.89), with launch angles raised so a shorter ball is not
simply a faster one.

**6. The bot's skill is a timing spread.** It chooses the stroke that sends
the ball away from its opponent, smashes high air balls, and mistimes by a
roughly normal error whose spread shrinks with skill. Its errors are what the
shot rules do with that — the same as a person's. The separate error *rate*
from 0015 is gone. Solo mode plays 0.65.

**7. The controller shows the move it reads.** A corner readout: *Now* (the
lobe in progress, `stream.current`) and *Last* (the peak the ring shows,
which is the one the host plays). For checking the classifier with a phone
in hand and deciding what needs more training data.

## Alternatives rejected

- **Keep direction from timing and add the stroke as a bias.** The user's
  request is that the motion decides; a bias is the thing 0012 already
  rejected for being invisible.
- **Direction in the avatar's frame (0012's rule).** Correct for the near
  player only. The far player would learn that a forehand goes right.
- **Overhead as "any swing at a high contact".** Makes the motion irrelevant,
  which is the opposite of the request.
- **An overhead at a bounced ball as a weak mishit instead of a whiff.** More
  forgiving of a misread, but it is not "only works in the air"; the readout
  shows the player what the phone saw instead.
- **Off-time = toward the middle, then suddenly out (first cut).** Not
  monotonic: getting earlier first made the ball safer, then lost the point.
  Novices almost never erred at all.
- **Shorter landings at the old flat angles.** 33 m/s median, every rally ball
  a winner — see [[2026-09-22-stroke-direction-balance]].
- **Classifiers that failed**: rotation at the peak for overhead (serve and
  hard-forehand peaks look the same), gyro-integrated gravity vs rotation
  axis, a quiet-gated gravity estimate, alpha integrated from lobe start.

## Trade-offs accepted

- **One swing in ~11 goes the wrong way**, and one groundstroke in ~30 reads
  as an overhead (a whiff on a bounced ball). Measured on multi-rep fixtures;
  the [[2026-09-21-swing-direction-classifier]] warning applies — treat both as
  upper bounds until single swings at rally spacing exist.
- **The overhead rule depends on the grip.** It reads a device axis, so the
  fixtures' grip convention (`tests/fixtures/motion/README.md`) is now load
  bearing for the overhead too.
- **Only 8 overhand swings** back the overhead threshold.
- **The far avatar's animation** swings a forehand toward its own left while
  the ball goes to its right. The player's swing and the ball agree; the
  avatar is secondary.
- **Balance is against a simulated human**, as in 0015.
