---
title: Vite's https server is an HTTP/2 server, not an https.Server
updated: 2026-09-20
tags: [platform, vite, networking, tooling]
status: current
code:
  - `scripts/relay-plugin.ts`
  - `tests/integration/tls-relay.test.ts`
---

# Vite's `https` server is HTTP/2

`resolveHttpServer` in Vite 7 (`vite/dist/node/chunks/config.js`) is four
lines long and decides the whole shape of the server:

```js
async function resolveHttpServer(app, httpsOptions) {
	if (!httpsOptions) return (await import("node:http")).createServer(app);
	const { createSecureServer } = await import("node:http2");
	return createSecureServer({ …, allowHTTP1: true }, app);
}
```

**Any** `https` option — `server.https` in dev, `preview.https` in preview —
produces an `Http2SecureServer`. There is no config flag involved and nothing
opts into it. Since this project always serves TLS (iOS refuses motion
sensors outside a secure context, [[ios-motion-permission]]), the relay has
*always* been attached to an HTTP/2 server, on every run that mattered.

`scripts/relay-plugin.ts` carried a comment for its whole life asserting the
opposite — "TLS here is always a plain `https.Server`". It was wrong from the
first HTTPS dev run.

## Why it works anyway

`allowHTTP1: true`. A client that negotiates `http/1.1` over ALPN is served by
the HTTP/1.1 path, which still emits `upgrade`, which is the only event `ws`
needs. Browsers do not put WebSockets over h2 by default (RFC 8441 is not the
common path) — they open a fresh HTTP/1.1 connection for `wss://`, which lands
exactly there.

Measured, not assumed: `tests/integration/tls-relay.test.ts` builds the same
shape from the committed `tests/fixtures/tls/` keypair and completes a real
`hello` → `assigned` exchange over `wss://`. Flipping `allowHTTP1` to `false`
in that test has been watched failing.

## What this costs

One cast. `ws` types its `server` option as `http.Server | https.Server`, and
an `Http2SecureServer` is neither, so `attachRelay`'s call site casts. The
cast is correct at runtime and the test is what keeps it honest — do not
"fix" it by widening `attachRelay`'s signature to a type `ws` cannot use.

## See also

[[0004-lan-https-via-local-ip-co]] · [[0010-vite-preview-as-production-server]]
· [[vitest-is-a-vite-serve]] — the sibling trap, same `apply: "serve"` surface
