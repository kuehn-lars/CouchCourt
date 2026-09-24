---
title: One package, not a monorepo
updated: 2026-09-19
tags: [decision, build]
status: current
code:
  - `package.json`
  - `vite.config.ts`
  - `tsconfig.json`
---

# 0001 — One package, not a monorepo

## Context

CouchCourt ships three things: a Node server, a host page for the Mac, and a
controller page for the phone. They share the wire protocol and the swing and
physics maths.

## Decision

A single `package.json` with a Vite multi-page build. `src/shared`, `src/server`,
`src/host`, `src/controller` are folders, not packages.

## Why

Three deliverables that are heavily *coupled* but have no *independence*.
Nothing here versions, publishes, or is consumed by anyone outside this repo —
which is the entire problem a workspace exists to solve.

The cost of getting this wrong in the "too much structure" direction is paid on
every single change: build orchestration, cross-package version bumps, a lint
config per package, and a CI matrix. The cost in the other direction is one
`npm init -w` on the day a fourth deliverable genuinely needs its own lifecycle.
That day is not in the v1 scope, and may never come.

## Alternatives rejected

- **pnpm workspaces** — buys cross-package version management for packages that
  will never be published. Also: pnpm is not installed on the dev machine, so it
  adds a prerequisite for a hobby project whose selling point is zero friction.
- **Three separate repos** — the wire protocol would immediately need a fourth
  repo to live in, or be duplicated and drift. Drift in a protocol shows up as a
  bug you debug from both ends at once.

## Consequences

- One lockfile, one tsconfig set, one lint config, one test runner, one CI job.
- Boundaries between the folders are not enforced by the package manager, so
  they have to be enforced another way — see [[0002-host-authoritative-simulation]]
  for how `src/shared` purity is enforced by the typechecker instead.

**Code map:** [[modules/tooling]] · [[architecture]]
