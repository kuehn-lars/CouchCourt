---
title: "`vite preview` is the production server"
updated: 2026-09-20
tags: [decision, tooling, server]
status: current
code:
  - `vite.config.ts`
  - `scripts/relay-plugin.ts`
  - `package.json`
  - `tests/integration/preview-relay.test.ts`
---

# 0010 — `vite preview` is the production server

## Decision

`npm start` is `vite build && vite preview`. The relay plugin gains a
`configurePreviewServer` hook alongside `configureServer`, so the same
`attachRelay` call serves both. There is **no** hand-written Node entry point under `src/server/`.

This closes [[architecture]]'s seam 2.

## Why

The thing being served is two static pages and one WebSocket. Vite already
owns the static half — correct MIME types, byte ranges, no path traversal,
compression — and already owns the TLS half, reading the same `./certs`
keypair in `preview` that it reads in `server` ([[0004-lan-https-via-local-ip-co]]).
Writing a Node static server to replace it would be ~80 lines whose entire
job is to re-earn trust Vite already has, and every one of those lines is a
path-handling line, which is the category where a hand-rolled server is
actually dangerous.

`apply: "serve"` already covers preview — Vite resolves a preview config with
command `serve` — so the hook is the only new code. Three lines.

## What was rejected

**A hand-written `node:http` static server.** The obvious reading of "seam 2",
and the reason it was deferred rather than written. Rejected on the above: it
is MIME tables and traversal guards, for a LAN party game run out of a
checkout.

**Express or `sirv`.** A dependency, needing this note anyway (`CLAUDE.md` §7),
to do less than what is already installed.

**A second process for the relay.** Two ports in the QR code, a CORS story,
and a second command to explain. The one-port property is the whole point of
the plugin — see [[architecture]], "Three participants, one port".

## What it costs

- **Vite is required at runtime**, so it can never move to `dependencies`-only
  deployment. Acceptable: this is designed to run on the
  host's own Mac, on the LAN, from a checkout. There is no deployment.
- **`vite preview` is documented as a preview tool, not a production server.**
  The caveat is about exposing it to the internet. This never leaves the LAN.
- **`isPreview` has to gate the recorder.** `traceEndpoint` writes into
  `tests/fixtures/motion/` and must stay a dev-only plugin; preview now gets
  the relay alone. Vite 7's `ConfigEnv.isPreview` is what makes that
  expressible.

## See also

[[architecture]] · [[vite-https-is-http2]] — found while proving this works ·
[[vitest-is-a-vite-serve]] · [[modules/tooling]] · [[modules/server]]
