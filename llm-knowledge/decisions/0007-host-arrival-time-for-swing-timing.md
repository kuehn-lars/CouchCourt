---
title: Swing timing uses host arrival time, never the phone's swing.at
updated: 2026-09-20
tags: [decision, sim, protocol]
status: current
code:
  - `src/shared/sim/rally.ts`
  - `src/shared/protocol.ts`
---

# Swing timing uses host arrival time, never the phone's `swing.at`

Decided up front, before any simulation code, in the simulation build plan
that has since been deleted (recoverable at `git show 0d95ed4^`). The plan
flagged it as "a trap" worth its own note once it landed, which is this note.
Its sibling decision is [[0008-timing-not-aim-for-shot-direction]]; between
them they are the whole of how a swing is read.

## The decision

`rally.ts`'s `timingErrorFor` measures a swing's timing error against
`RallyInput.time` — the sim-time the **host** stamps on a swing the moment it
arrives — never against `Swing.at`, the timestamp the phone attached using its
own `performance.now()`.

## Why

The phone and the host do not share a clock epoch, and nothing in the
protocol reconciles the two ([[wire-protocol]], "No time synchronisation").
Comparing `Swing.at` directly to a host-side sim time would be comparing two
numbers from unrelated clocks — not "slightly off", meaningless. LAN latency
between phone and host is on the order of 5ms, far inside `shot.ts`'s
`CLEAN_WINDOW` (120ms), so treating arrival time as "when the swing happened"
costs negligible accuracy and needs no synchronisation protocol at all.

## What was rejected

A clock-offset handshake (phone and host periodically exchange timestamps to
estimate skew) would make `Swing.at` usable directly, but that is real
protocol surface — round trips, drift correction, edge cases when a
connection resumes — for a problem the 5ms LAN latency already makes moot.
Not worth building until real hardware shows the arrival-time approximation
actually costs something.

`Swing.at` is not deleted from the protocol: it is still used for ordering
and dedupe within a single phone's own event stream, where its clock is
self-consistent. See [[wire-protocol]]'s "Deliberately absent" section.
