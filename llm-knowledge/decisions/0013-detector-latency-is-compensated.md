---
title: The phone reports how late it is, and the host subtracts it
updated: 2026-09-21
tags: [decision, swing, protocol, latency, core]
status: current
code:
  - `src/shared/protocol.ts`
  - `src/shared/swing/stream.ts`
  - `src/shared/sim/rally.ts`
  - `src/server/relay.ts`
---

# 0013 — The phone reports how late it is, and the host subtracts it

Found on 2026-09-21 while buying direction accuracy with detector latency. The
bug it fixes was already there and had never been noticed, because nothing had
been played by a person.

## Decision

`Swing` carries **`lag`**: milliseconds between the swing's peak and the
moment the detector announced it. The host subtracts it from arrival time
before judging the swing:

```
swingTime = arrivalTime − lag
```

Optional, exactly as `spin` is, so an older controller is still a playable
controller. Absent means `DEFAULT_SWING_LAG_MS` (200, the measured median of
the current detector) rather than zero — assuming zero would punish an older
phone for a delay it is still incurring. Bounded by `MAX_SWING_LAG_MS` at the
wire guard, and clamped again in the sim, because `RallyInput` is also built
by `bot.ts`, which never passes through the guard.

## Why

`CLEAN_WINDOW` is 120ms and `MISS_WINDOW` is 280ms. The streaming detector's
median announcement was already **133ms after the peak** before this change,
and nothing anywhere compensated for it. Every swing a real player made was
therefore being judged as a late one, at roughly half quality, and the p90
would have read as an outright whiff.

Holding `EMIT_HOLD_MS` to classify direction properly
([[0012-swing-kind-is-the-shot-direction]]) pushed the median to 200ms and the
p90 to 334ms — past `MISS_WINDOW`. That is what forced the issue, but the bug
predates it.

## Why this does not violate 0007

[[0007-host-arrival-time-for-swing-timing]] refuses to trust the phone's
clock, because two devices' `performance.now()` origins are unrelated and
unknowable. `lag` is not a timestamp. It is the **difference between two reads
of the same phone's own clock**, taken milliseconds apart. Clock skew cancels
exactly; clock *drift* over 200ms is unmeasurable. The host still stamps
arrival itself and still never reads `swing.at` for timing.

## Alternatives rejected

- **A fixed compensation constant in the sim.** Simpler, and wrong whenever
  the detector changes or a phone runs an older build. The phone is the only
  thing that knows what it actually did.
- **Emitting earlier to avoid the problem.** That was the status quo, and it
  cost 5 swings in 55 of direction accuracy — the thing the game now rests on.
- **Syncing the clocks.** A round-trip estimate over a LAN socket, to solve a
  problem that a subtraction inside one device already solves.

## Consequences

- **Every producer of a `Swing` must set `lag` honestly, including test
  fixtures.** `playability.test.ts` builds swings that name their own timing
  error; without `lag: 0` the default would silently have turned every
  "well-timed" case in it into a 200ms-early one. `bot.ts` sets `lag: 0` for
  the same reason: it has no phone between it and the sim.
- **The relay must forward it.** It rebuilds the swing field by field rather
  than passing the message through, so a new field is dropped unless it is
  added there too. This happened, on the day the field was added, and
  `tests/integration/relay.test.ts` is the thing that catches it — there is a
  comment in that file warning about exactly this trap, written before it was
  sprung.
- Raw emit latency is no longer the guard in `stream.test.ts`. `lag`'s
  *accuracy* is, because a wrong lag is worse than a big one.

## See also

[[0007-host-arrival-time-for-swing-timing]] · [[0009-streaming-swing-detection]] ·
[[0012-swing-kind-is-the-shot-direction]] · [[wire-protocol]] ·
[[modules/shared-protocol]]
