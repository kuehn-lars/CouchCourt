# SwingCourt

Motion controlled tennis for your living room, no console required.

Your MacBook is the screen. Everyone's iPhone is a racket. Nothing to install on
either end — players scan a QR code and start swinging.

See [`PRODUCT.md`](PRODUCT.md) for what it is and what v1 deliberately is not.

> **Status: playable end to end, and never yet played by a person.**
> `npm start` builds and serves both pages over LAN HTTPS with the relay
> attached, so a guest can scan the code on the host screen and be swinging.
> There is a lobby, a solo opponent, three camera modes, sound and a scoring
> umpire. What has **not** happened is a phone: everything has been verified
> by 300 tests and by driving the real pages in headless Chrome, which has no
> motion sensors and renders in software. How it *feels* is still unmeasured.
> See [`llm-knowledge/architecture.md`](llm-knowledge/architecture.md).

## Requirements

- Node 24 (see `.nvmrc`)
- An iPhone on the same Wi-Fi as the Mac
- A router that does not block DNS rebinding — see below, this bites most people

## Getting started

```bash
npm install
npm run certs   # fetch TLS certificates for your LAN address
npm start       # build, serve, and host the relay
```

`npm run dev` is the same thing against source, with hot reload and the motion
trace recorder attached.

`npm run certs` prints the URLs to open. HTTPS is not optional: iOS refuses
motion sensors outside a secure context.

Use the URLs from `npm run certs`, not the `Network:` line Vite prints. Vite
shows the raw IP, which the certificate does not cover, so Safari will warn.

If it warns that the hostname does not resolve, your router is running DNS
rebind protection and dropping the answer. It is a one-time fix on the router
and the script tells you where to look — details in
[`llm-knowledge/platform/lan-https-dns-rebind.md`](llm-knowledge/platform/lan-https-dns-rebind.md).

## Playing

1. `npm start` on the Mac, and open the host URL `npm run certs` printed.
2. The screen shows a QR code. Scan it with an iPhone camera.
3. Tap **Enable motion** once. That tap is also your ready signal.
4. On the host screen: **Start the match** with two phones in, or **Play the
   machine** with one.
5. Swing. The first player who was ready serves.

`C` cycles the camera (broadcast, follow, side-on); `F` is fullscreen. If a
phone drops out mid-match the game freezes and waits for it.

## Commands

| Command | What it does |
| --- | --- |
| `npm start` | Build, then serve both pages **and** the relay. This is how you play |
| `npm run dev` | Vite dev server, HTTPS when `./certs` exists, trace recorder attached |
| `npm run certs` | Fetch LAN certificates, diagnose router DNS |
| `npm run check` | Biome lint and format check |
| `npm run format` | Biome, writing fixes |
| `npm run typecheck` | All three tsconfig projects |
| `npm test` | Vitest |
| `npm run build` | Production build into `dist/` |
| `npm run vault:check` | Knowledge vault integrity |

CI runs everything except `dev` and `certs` on each pull request.

## Layout

```
src/shared/       pure logic — protocol, simulation, swing detection
src/server/       WebSocket relay and player slots (Vite serves the files)
src/host/         the Mac display (Three.js)
src/controller/   the iPhone racket (iOS Safari)
tests/            integration tests and recorded motion traces
llm-knowledge/    Obsidian vault — the project's long-term memory
```

`src/shared` is pure: no DOM, no Node APIs. This is enforced by the typechecker,
not by convention, and it is why the simulation is testable without a browser or
a phone. See [`CLAUDE.md`](CLAUDE.md).

## The knowledge vault

`llm-knowledge/` is an Obsidian vault holding what is expensive to re-derive —
how the pieces are wired together, platform gotchas, measured constants, and
decisions with the alternatives that were rejected. Open it by pointing
Obsidian at that folder; no plugins needed.

| Start at | For |
| --- | --- |
| [`index.md`](llm-knowledge/index.md) | The catalog. Every note, one line each |
| [`architecture.md`](llm-knowledge/architecture.md) | How the whole system connects, end to end |
| [`modules/`](llm-knowledge/modules) | One page per subsystem: files, imports, invariants, gaps |
| [`log.md`](llm-knowledge/log.md) | What happened, in order |

Contributors and Claude Code sessions alike read it before working and write to
it after. `npm run vault:check` keeps it from rotting.
