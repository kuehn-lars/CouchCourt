---
title: Sharing a port with Vite means sharing its upgrade handler
updated: 2026-09-21
tags: [platform, server, vite, websocket]
status: current
code:
  - `src/server/relay.ts`
  - `src/shared/protocol.ts`
  - `scripts/relay-plugin.ts`
---

# Sharing a port with Vite means sharing its upgrade handler

A `ws` `WebSocketServer` constructed as `new WebSocketServer({ server })`
attaches to that server's `upgrade` event and **answers every upgrade on it**,
whatever the path. Two such servers on one HTTP server both answer the same
handshake, and the client gets two overlapping responses.

SwingCourt runs exactly that arrangement on purpose: the relay shares Vite's
port and origin ([[0010-vite-preview-as-production-server]]), and Vite runs
its own WebSocket server on that port for HMR.

## What it looks like when it bites

In the browser console, on the host page, in dev:

```
WebSocket connection to 'wss://127.0.0.1:5199/?token=X7LCQa-6NpZ4' failed:
  Invalid frame header
[vite] server connection lost. Polling for restart...
```

then the page reloads, reconnects, fails again, and loops. Every symptom
points at Vite or at TLS. Neither is at fault.

On the server side the same collision can be fatal rather than noisy: a
half-written frame from the confused client reaches `ws`'s frame parser,
which raises `error` on the socket, and an unhandled `'error'` event ends the
Node process — see [[relay-survives-a-broken-client]].

## The fix, and why it is a shared constant

`new WebSocketServer({ server, path: RELAY_PATH })`. `ws` then declines any
upgrade on another path and leaves it for whoever else is listening.

`RELAY_PATH` lives in `src/shared/protocol.ts` rather than in the server,
because the host page, the controller and all three integration tests have to
agree with it. A path is part of the wire contract in the same way the message
shapes are.

## Why no test caught it

Every relay test connected to the relay's own URL and got the relay. The bug
only exists when **something else** is listening on the same server, which no
unit or integration test arranges and which only dev and preview do. It was
found by opening the game in a browser and reading the console.

`tests/integration/relay.test.ts` now asserts the relay declines an upgrade on
another path, which is as close as a test can get without standing up Vite.

## See also

[[0010-vite-preview-as-production-server]] · [[vite-https-is-http2]] ·
[[relay-survives-a-broken-client]] · [[modules/server]]
