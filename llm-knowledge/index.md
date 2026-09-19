---
title: Index
updated: 2026-09-19
tags: [meta]
status: current
---

# SwingCourt knowledge index

**Read this first.** It is a router, not a database — it stays short enough to
read at the start of every session. If it grows past roughly one screen, that
is the signal to consolidate notes, not to add a scrollbar.

New to the vault? [[README]] explains what belongs here and what does not.

## Where things live

Concept to code, so a session can go straight to the file instead of searching
for it. Every path here is verified by `npm run vault:check`; a pointer that
lies costs more than no pointer.

| Concept | Code | Note |
| --- | --- | --- |
| Wire protocol, message validation | `src/shared/protocol.ts` | [[wire-protocol]] |
| Simulation, physics, scoring | `src/shared/sim/` | [[tennis-scoring]] |
| Swing detection | `src/shared/swing/detector.ts` | [[2026-09-19-swing-detector-tuning]] |
| Purity boundary enforcement | `tsconfig.web.json`, `tsconfig.node.json`, `tsconfig.test.json` | [[0002-host-authoritative-simulation]] |
| WebSocket relay, player slots | `src/server/` | [[0005-raw-websockets-over-socket-io]], [[0006-relay-session-policy]] |
| Host display, Three.js rendering | `src/host/` | [[0003-threejs-renderer]] |
| Controller, motion permission gate | `src/controller/index.html` | [[ios-motion-permission]] |
| Reconnection and session identity | `src/shared/protocol.ts` | [[ios-safari-tab-suspension]] |
| TLS certificates, LAN hostname | `scripts/setup-certs.mjs` | [[0004-lan-https-via-local-ip-co]] |
| Motion trace fixtures | `tests/fixtures/motion/` | [[ios-motion-permission]] |
| Motion permission gate | `src/controller/motion.ts` | [[ios-motion-permission]] |
| Trace recorder page | `src/controller/record.ts` | [[ios-motion-permission]] |
| Motion trace format, validation | `src/shared/swing/trace.ts` | [[ios-motion-permission]] |
| Trace save endpoint (dev only) | `scripts/trace-endpoint.ts` | [[vitest-is-a-vite-serve]] |
| Vault format and CI enforcement | `scripts/check-vault.mjs` | [[README]] |
| Build, dev server, test config | `vite.config.ts` | [[0001-single-package-vite-mpa]] |

Each note carries the same pointers in its `code:` frontmatter, so the trail
works from either direction.

## Start here

- [[0002-host-authoritative-simulation]] — where the game logic lives, and why
  `src/shared` must stay pure. The single most load-bearing constraint in the
  codebase.
- [[wire-protocol]] — the controller/server/host contract and its intent.

## Decisions

- [[0001-single-package-vite-mpa]] — one package, not a monorepo
- [[0002-host-authoritative-simulation]] — sim in the host browser, server is a relay
- [[0003-threejs-renderer]] — Three.js over Phaser
- [[0004-lan-https-via-local-ip-co]] — publicly trusted certs for LAN addresses
- [[0005-raw-websockets-over-socket-io]] — `ws` over Socket.IO
- [[0006-relay-session-policy]] — host replacement, no slot reclaim, liveness defaults

## Platform

The things that will cost you an afternoon if you do not read them first.

- [[ios-motion-permission]] — HTTPS *and* a tap, or no sensors at all
- [[lan-https-dns-rebind]] — why the QR code may not resolve on a home router
- [[lan-https-cert-chain]] — why it can still fail on the phone once it does
- [[ios-safari-tab-suspension]] — the phone will drop its socket, by design
- [[vitest-is-a-vite-serve]] — `apply: "serve"` is not a dev-only gate

## Reference

- [[wire-protocol]] — message shapes and why they are shaped that way
- [[tennis-scoring]] — the scoring rules the sim implements

## Experiments

- [[2026-09-19-lan-tls-verification]] — proving the LAN HTTPS approach works
- [[2026-09-19-ios-devicemotion-sampling]] — the real sample rate, and why a
  peak threshold cannot separate a backhand from a hand gesture
- [[2026-09-19-swing-detector-tuning]] — the duration/merge/classification
  thresholds that do separate them, tuned against the traces

## Not yet written

Deliberately empty of links, because CI rejects links to notes that do not
exist. These are the gaps a future session should fill:

- Court geometry and ball physics constants, once tuned
