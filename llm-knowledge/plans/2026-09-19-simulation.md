---
title: Simulation build plan
updated: 2026-09-19
tags: [plan, sim, in-progress]
status: current
code:
  - `src/shared/sim`
  - `src/host`
---

# Simulation build plan

**This is live work on the `feature/simulation` branch. Nothing in it is built
yet.** If you are a session picking this up, start here, then check
`git log --oneline` on the branch to find the last completed phase.

A plan is not normally vault material — it stops being true the moment it is
executed. This one is committed anyway because the work spans more sessions
than one branch's session logs (which are gitignored) can carry, and because
the decisions in it are load-bearing for phases nobody has started.

When the last phase lands, **this note gets deleted**, not superseded. What
survives it is the [[tennis-scoring]] update, the constants note the [[index]]
still lists as missing, and whatever ADRs the table below earns.

## Why

`src/shared/sim/` is an empty `.gitkeep`. The swing detector produces `Swing`
events and the relay carries them to the host, where nothing consumes them.
Until `tick` exists there is nothing to render and nothing to score.

[[0002-host-authoritative-simulation]] fixes the shape: pure, deterministic
`tick(state, inputs, dt)` at a fixed timestep — no DOM, no Node, no ambient
`Math.random`. That purity is enforced by the two production tsconfig projects,
so a violation fails `npm run typecheck` rather than review.

## Decisions taken up front

Confirmed with the user on 2026-09-19, before any code. Each of these changes
the shape of several phases, which is why they were settled first rather than
discovered halfway.

| Question | Decision | Why, and what was rejected |
| --- | --- | --- |
| Camera | Elevated behind the near baseline | The whole court is visible and the ball travels in depth, which is the skill the swing timing is built on. Side-on broadcast is fairer to both players but removes the depth cue and would argue against [[0003-threejs-renderer]]. A camera that follows the hitter flips the world every shot and disorients both players. |
| Shot direction | Swing **timing** — early is cross-court, late is down the line | Phone yaw needs a trustworthy compass zero, and the two players face opposite directions, so it costs a per-player calibration tap in the thirty seconds `PRODUCT.md` calls the core problem. The 20Hz `aim` stream stays in the protocol and **no v1 code reads it.** |
| Serve lets | Ignored — a net clip that lands in plays on | Replaying is real tennis, and it means the player swung and the game took it back. `reference/tennis-scoring.md` asks for this decision by name; record it there when the rally machine lands. |
| Swing timing source | Host **arrival** time, not `swing.at` | The phone's `performance.now()` is a different epoch from the host's, and nothing reconciles them. LAN latency is ~5ms, far inside the hit window, so arrival time is simply better. `swing.at` is used only for ordering and dedupe. This one is a trap and earns a note of its own when Phase 7 lands. |

## Not being built

No physics engine dependency — three planes and a sphere is about forty lines,
and a new dependency needs a decision note per `CLAUDE.md` §7. No ECS. No
renderer abstraction. No spin vector or Magnus force: topspin is one gravity
multiplier. No doubles hooks, no best-of-three, no manual movement —
`PRODUCT.md` §Explicitly out of scope is binding.

## Coordinates and units

Metres, seconds, radians. Stated once, no unit suffixes on names.

`x` across the court (0 at centre), `y` up, `z` along the court. Net at `z = 0`,
near baseline at `z = +11.885`, far at `z = -11.885`.

## Phases

Each is one session or less, each ends with a test **watched failing first**
(`CLAUDE.md` §3), each ends with a session-log append (§2). 1 through 7 are
strictly ordered. 9 is the only phase needing a real phone.

### 1 — Geometry and state types

`sim/court.ts`, `sim/state.ts`. ITF constants, cited not tuned: court 23.77 long,
singles half-width 4.115, service line 6.40 from the net, net 0.914 at centre
and 1.07 at the posts, ball radius 0.0335.

Net height varies linearly with `|x|`, so `netHeightAt(x)` is a function — a
ball clipping the band near the post is a real outcome and a flat net fakes it.

`state.ts` is plain flat data, no methods. `tick` returns a **new** state; the
previous one is what the renderer interpolates from, so a small flat graph
matters more than a clever one.

**Test:** service box corners inside the court and on the right side of the net;
`netHeightAt` correct at centre and posts and monotonic outward.

### 2 — Ball flight

`sim/ball.ts`. `stepBall(ball, dt, env)` returning the new ball plus what it
crossed. Gravity times a `gravityScale` knob (1.0–2.0, standing in for topspin),
and quadratic drag `a = -k·|v|·v` with

```
k = ½·ρ·Cd·A / m = ½·1.21·0.55·3.53e-3 / 0.057 ≈ 0.0206  (1/m)
```

At 30 m/s that is ~18.5 m/s² — drag dominates the trajectory here. Leaving it
out is not a simplification, it is a different game.

**The part that needs care:** at 120Hz a 30 m/s ball moves 25cm per tick and
tunnels clean through both the net plane and the court surface. Integrate, then
test the *segment* from old to new position against `y = 0` and `z = 0`, solve
for the crossing fraction, resolve there. Two analytic plane tests, no
substepping.

**Tests:** with drag off, a known launch lands within 1cm of the closed-form
parabola; with drag on it lands shorter, monotonically in `k`; a 40 m/s ball
aimed just short of the net and one aimed at the surface both register the
crossing — delete the segment test and watch both fail, because that is the
guard most likely to be silently wrong; bounce apexes fall by `restitution²`;
1000 steps run twice are identical.

### 3 — Scoring

`sim/scoring.ts`. Pure `awardPoint(score, winner)`. The specification already
exists in [[tennis-scoring]] — implement that note, do not re-derive it. Single
set, per its Match section. No ball, no geometry, no timing in this file.

**Tests:** straight from the note — the 15/30/40 ladder, deuce and advantage
repeatedly, 6–4 takes the set and 6–5 does not, 7–5 does, 6–6 opens a tiebreak,
8–6 and 9–7 tiebreaks, the set recorded as 7–6.

**The one that matters:** tiebreak serve rotation, one point then alternating
every two, asserted as an explicit table of who serves points 1 to 13. The note
calls this the classic bug and says it is invisible until someone who plays
tennis watches a match. Thirteen expected values are cheaper than that.

### 4 — Automatic player movement

`sim/players.ts`. v1 has no manual movement, so the sim positions each player:
predict where the ball crosses the receiver's strike plane, ease toward that `x`
at a capped speed.

Reuse `stepBall` for the prediction, run forward on a copy with a capped
lookahead. One physics implementation — a second approximate predictor would
drift out of sync with the first.

Positioning is generous by construction: the player essentially always arrives.
Whether the shot is good is decided by timing in Phase 5, not by whether the
avatar got there. That is what keeps the game about swinging.

**Tests:** a ball to the far corner targets inside the court; per-tick movement
never exceeds the speed cap; a ball headed out still yields a clamped target
rather than a runaway; predictor and `stepBall` agree on the crossing.

### 5 — Shot resolution

`sim/shot.ts`. The feel core: `resolveShot(swing, timingError, contact, side)`
to an outgoing velocity.

Timing error is signed, host arrival minus ideal contact. Inside ~120ms is clean
contact, degrading to a whiff at ~280ms — wide on purpose, both for "generous
input" and because the detector's own latency is already inside it. The **sign**
sets direction, which is the timing decision above and one `lerp`. Power
(0.15–1.0 from the detector) maps to launch speed: groundstrokes ~15–30 m/s,
serves ~18–35. Cleaner contact launches flatter and faster; a mishit still
clears the net most of the time.

Every constant is a named export with a comment. Phase 9 changes all of them —
do not inline one.

**Tests:** a perfect max-power forehand from the baseline lands in; 250ms of
error lands short but does not whiff; past the miss window returns no shot;
early and late produce opposite lateral signs; power is monotonic in speed.

### 6 — Rally machine and `tick`

`sim/rally.ts`, `sim/index.ts`. Phases `waiting-serve → serve-flight → rally →
point-over`, with game and set endings derived from the score rather than stored
twice.

`tick(state, inputs, dt)` takes the swings that arrived since the last tick,
each already stamped with sim-time by the host. Nothing else enters: no clock
read, no RNG. If serve placement wants jitter the seed lives in the state and
advances inside `tick`, per [[0002-host-authoritative-simulation]].

Point resolution in one place, in order: out of bounds, second bounce, into the
net, double fault. A net clip that lands in plays on — the crossing solver from
Phase 2 damps and deflects it, and the rally continues.

**Tests:** each terminal condition awards to the right player; fault, second
serve, double fault; a serve landing outside the service box is a fault even
though it is inside the court (easy to get wrong, silent when wrong).

**The replay test, and the reason 0002 fixed the timestep:** a scripted array of
`{tick, playerId, swing}` driven through `tick` to a completed set, asserting
the exact final score, run twice for identical output. This is the regression
net for every later tuning change.

### 7 — Host loop

`host/loop.ts`, `host/main.ts`. This is the phase that makes it look smooth, and
it is almost all one small pure function.

`advance(accumulator, frameDt)` returns ticks to run, the new accumulator, and
`alpha`, the leftover fraction. Fixed step 1/120s, capped at 5 catch-up ticks so
a stalled tab cannot spiral. **Rendering a fixed-step sim without interpolating
by `alpha` is what makes it judder**, whatever the materials look like. It is
the highest-value code in the visual stack and it is pure, so it is tested.

`main.ts` holds the rAF loop, the socket wiring and the two state references,
nothing else. On a `swing` message, stamp it with the current tick and queue it;
send `feedback` back on hit, miss and point, which is what the protocol's
`FeedbackKind` already exists for.

**Tests:** 16.6ms frames at a 120Hz step alternate 2 and 1 ticks with a bounded
accumulator; `alpha` always in `[0,1)`; a 3-second frame — a tab restored from
suspension, see [[ios-safari-tab-suspension]] — yields 5 ticks, not 360. Remove
the cap and watch that last one fail.

### 8 — Renderer

`host/render/`. Not unit tested, per [[0003-threejs-renderer]]. The rules that
keep it fast, in priority order:

1. **Interpolate.** Every visual reads `lerp(prev, current, alpha)`. Nothing
   reads sim state directly.
2. **Zero allocation in the frame loop.** Geometries, materials and vectors
   built once at setup; per frame only mutate `.position` and `.rotation`. No
   `new THREE.*` inside rAF, ever. This is the difference between steady frame
   time and periodic GC hitches, and hitches are what "not smooth" means.
3. **A blob shadow, not a shadow map.** A flat dark circle under the ball scaled
   by height. Free, and it is the primary cue for judging an approaching ball —
   it reads better than a real soft shadow at this ball size. Shadow maps only
   if the tuning pass says the court looks flat.
4. **Ball trail** as a ring buffer of past interpolated positions, no per-frame
   allocation. Cheap, and it does most of the "looks expensive" work.
5. Court, net and players are procedural primitives (0003: no artist, no
   sprites). Lines as one merged geometry, not twenty meshes.
6. ACES filmic tone mapping, one directional light plus hemisphere ambient, a
   gradient background. No post-processing — bloom costs real frame time and
   buys little at this art level.
7. Camera fixed high behind the near baseline, with a small eased lateral offset
   toward the receiver. Ease it, never cut.

**Verification is manual and says so:** `npm run dev`, open the host page,
confirm a rally renders with no console errors and steady frame time in the
Chrome performance panel.

### 9 — Tuning, and the note the index is waiting for

The [[index]] lists court geometry and ball physics constants as not yet
written, and says they need measurement rather than guessing. Phase 1's geometry
is a rulebook citation; the rest gets the treatment the swing detector got, and
the measurement loop is headless.

`sim/playability.test.ts` sweeps power against timing error against swing kind
through the real `tick` and asserts an **envelope**, not exact numbers:

- A well-timed shot from the baseline lands in at least ~60% of the time across
  the power range. Below that the game is frustrating.
- A max-power shot with worst-case timing essentially never lands in. Above
  that there is no skill in it.
- No legal power reaches the far fence — the ceiling is inside the physics, not
  bolted on as a clamp.
- A minimum-power serve still clears the net.

Tune until those hold, then play it on real phones and adjust for feel, with the
Phase 6 replay test and this envelope as the net that says when a feel change
broke something measurable.

**Then harvest** (`CLAUDE.md` §5): write the constants note with the measured
values and how they were measured, add its row to **Where things live**, drop
the "Not yet written" line, record the let decision in [[tennis-scoring]] where
that note asks for it, add the phone-versus-host timestamp note, promote any of
the decisions above that earned an ADR, and delete this plan.

## Verification

Per phase: `npm test` green with the new test watched failing first, and
`npm run typecheck` green across all three projects — that last one is what
proves nothing DOM- or Node-shaped leaked into `src/shared`.

End to end after Phase 9:

```bash
npm run check && npm run typecheck && npm test && npm run build && npm run vault:check
npm run certs && npm run dev    # two phones and the host page, play a set
```

The manual pass has one question: does a swing that felt like a forehand produce
a forehand that goes where the player expected, with no noticeable delay? That
is `PRODUCT.md`'s bar and no test replaces it.
