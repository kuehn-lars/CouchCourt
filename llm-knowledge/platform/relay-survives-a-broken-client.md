---
title: An unhandled socket error ends the whole server
updated: 2026-09-21
tags: [platform, server, websocket, node]
status: current
code:
  - `src/server/relay.ts`
---

# An unhandled socket error ends the whole server

Node's rule for an `EventEmitter` that emits `'error'` with nothing listening
is to **throw it**. For a `ws` socket that means the process exits. For
CouchCourt that means the host page, every controller, the static files and
the relay all die together, because they are one process
([[0010-vite-preview-as-production-server]]).

## How it happened

Watched on 2026-09-21, driving the game from a script that was killed
mid-send:

```
RangeError: Invalid WebSocket frame: invalid status code 51066
    at Receiver.controlMessage (ws/lib/receiver.js:663:30)
Emitted 'error' event on WebSocket instance at:
    at Receiver.receiverOnError (ws/lib/websocket.js:1218:15)
[the Vite dev server exits]
```

A half-written close frame is enough. So is any client that sends a malformed
frame, deliberately or otherwise — and at a party that is one guest whose
phone drops off the Wi-Fi mid-frame.

## Why the existing guards did not cover it

`src/shared/protocol.ts` is emphatic that everything off a socket is
untrusted, and it is — at the **JSON** layer. `parseControllerMessage` rejects
anything malformed, including NaN and Infinity.

The **frame** layer sits underneath that and never reaches the guard at all.
`ws` fails before a message event is ever emitted. A validator on the payload
cannot protect a parser that never produced a payload.

## The fix

```ts
ws.on("error", () => ws.terminate());   // per connection
wss.on("error", () => {});              // and on the server itself
```

Drop the socket, keep the game. `close` follows and does the lobby
bookkeeping, so a player whose phone glitches is treated exactly like one who
walked out of Wi-Fi range — which [[0006-relay-session-policy]] already
handles.

The server-level handler matters too: a failed upgrade or a socket that dies
during the handshake emits there instead.

## The general rule

**Every `ws` socket this project creates needs an `error` listener, including
in tests and tools.** It is not defensive tidiness; it is the difference
between one dropped guest and a dead party.

## See also

[[one-port-one-websocket-path]] · [[0006-relay-session-policy]] ·
[[modules/server]] · [[modules/shared-protocol]]
