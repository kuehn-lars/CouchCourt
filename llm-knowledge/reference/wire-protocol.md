---
title: Wire protocol intent
updated: 2026-09-20
tags: [reference, networking, protocol]
status: current
code:
  - `src/shared/protocol.ts`
  - `src/shared/protocol.test.ts`
---

# Wire protocol intent

The types are in `src/shared/protocol.ts` and that file is the source of truth.
This note records *why* they are shaped that way, which the types cannot say.

## Detection happens on the phone

The single most important property. The controller runs swing detection locally
and sends **semantic events** — a handful of swings per rally plus a ~20Hz aim
stream. It never streams raw `devicemotion` samples.

Three things follow:

- Bandwidth stays trivial, which is why transport choice barely matters
  ([[0005-raw-websockets-over-socket-io]]).
- The host receives intent, not signal, so the simulation never contains
  filtering or peak-detection code.
- The detector is a **pure function over a sample stream** and can therefore be
  tuned offline against recorded traces, with no phone in hand. This is the
  main testing leverage the project has.

## Three participants, four message unions

`ControllerMessage` and `HostMessage` go *to* the server; `ControllerBoundMessage`
and `HostBoundMessage` come *from* it. Keeping them separate means a message the
host should never receive cannot typecheck its way into a controller handler.

The server translates rather than blindly forwarding: a controller sends
`{ t: "swing", ... }` with no identity, and the host receives
`{ t: "swing", playerId, swing }`. Identity is attached by the server, from the
socket it arrived on. A client that claims its own `playerId` on every message
is a client that can claim someone else's.

## The server owns slots and nothing else

Side assignment (`near`/`far`) is the server's, not the player's. The server
knows how many slots are free; a phone does not, and two phones racing to pick a
side is a bug waiting for a party.

## Everything from a socket is untrusted

`isControllerMessage` is a real runtime guard, not a cast. It rejects `NaN` and
`Infinity` explicitly — those survive an in-process send intact, sail through a
naive `typeof x === "number"` check, and then poison the simulation silently
several frames later. Finding that after the fact is miserable.

This deliberately covers only the two directions arriving *at the server*
(`isControllerMessage`, `isHostMessage`): a phone's controller software is
arbitrary and untrusted, but the host's own `WebSocket` only ever receives
`HostBoundMessage`/`ControllerBoundMessage` from the relay we wrote, using
types we control on both ends. `src/host/main.ts` (phase 7) parses those with
a plain cast, not a guard — there is no third, equally-untrusted party on that
edge the way there is on the other two. Revisit only if the host ever needs to
trust a relay it did not write.

## Versioning

`PROTOCOL_VERSION` is sent in `hello` and a mismatch is rejected with
`bad-version`. Phones cache aggressively; a guest can easily be running last
week's controller against today's host. Rejecting loudly beats debugging a
desync.

## Deliberately absent

- **No time synchronisation.** `Swing.at` is the phone's own
  `performance.now()`, useful only for ordering and relative timing within one
  device. Do not compare it across devices without solving clock offset first.
- **No sim state on the wire.** The host renders what it simulates; nothing
  sends game state anywhere. See [[0002-host-authoritative-simulation]].
- **No acknowledgements or sequence numbers.** A dropped aim update is replaced
  20ms later. If swings ever start getting lost on real hardware, that is the
  point to reconsider — not before.

**Code map:** [[modules/shared-protocol]] · [[architecture]]
