<p align="center">
  <img src=".github/assets/header.svg" alt="CouchCourt — living-room tennis where your phone is the racket." width="100%" />
</p>

<p align="center">
  <b>An experiment in giving a coding agent long-term memory, and holding it to test-first discipline.</b><br />
  <sub>Built with <a href="https://claude.com/claude-code">Claude Code</a>, and a knowledge vault it reads before every session and writes back to after.</sub>
</p>

<p align="center">
  <a href="https://github.com/kuehn-lars/CouchCourt/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/kuehn-lars/CouchCourt/ci.yml?branch=main&style=plastic&label=CI&logo=githubactions&logoColor=white" /></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-dcff4a?style=plastic" /></a>
  <br />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-7-3178C6?style=plastic&logo=typescript&logoColor=white" />
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-24-5FA04E?style=plastic&logo=nodedotjs&logoColor=white" />
  <img alt="Three.js" src="https://img.shields.io/badge/Three.js-r186-000000?style=plastic&logo=threedotjs&logoColor=white" />
  <img alt="Vite" src="https://img.shields.io/badge/Vite-7-646CFF?style=plastic&logo=vite&logoColor=white" />
  <img alt="ws" src="https://img.shields.io/badge/ws-8-010101?style=plastic" />
  <img alt="Vitest" src="https://img.shields.io/badge/Vitest-3-6E9F18?style=plastic&logo=vitest&logoColor=white" />
  <img alt="Biome" src="https://img.shields.io/badge/Biome-2-60A5FA?style=plastic&logo=biome&logoColor=white" />
  <img alt="Phosphor Icons" src="https://img.shields.io/badge/Phosphor_Icons-2-5ac8fa?style=plastic" />
  <img alt="qrcode-generator" src="https://img.shields.io/badge/qrcode--generator-2-ff5d73?style=plastic" />
</p>

---

## Your laptop is the stadium. Every phone is a racket.

CouchCourt turns a laptop and a couple of iPhones into a local multiplayer
tennis game you play by swinging. The laptop shows the court. Each guest scans a QR code,
taps once to allow the motion sensors, and their phone **is** the racket — a
forehand sends the ball one way, a backhand the other, and how hard you swing is
how hard you hit.

Nothing to install on either end. No app, no account, no controller to charge,
no internet beyond the Wi-Fi everyone is already on.

<table>
  <tr>
    <td width="76%"><img src=".github/assets/host.jpg" alt="The host screen on a Mac: a floodlit night stadium behind the join QR code and two open seats" /></td>
    <td width="24%"><img src=".github/assets/phone.jpg" alt="The controller on an iPhone: 'This phone is your racket.' above a Let's play button" /></td>
  </tr>
  <tr>
    <td align="center"><sub>The host: scan the code to take a side</sub></td>
    <td align="center"><sub>The iPhone: one tap and it's a racket</sub></td>
  </tr>
</table>

### The idea

Consoles solved *everyone in one room*, and people loved it. Phones inherited
the audience and lost the format — not because gathering round one screen
stopped being fun, but because an app store put a download, an account and an
update between a guest and the game.

Meanwhile every guest already carries a motion controller: an accelerometer, a
gyroscope, haptics and a browser. The only missing piece was permission to read
the sensors from a web page, and iOS grants that with one tap. So the
constraints — **zero install, zero accounts, local only** — are not modesty.
They are the whole proposition.

## Features

- 🎾 **Swing to play.** Forehand, backhand, overhead smash and serve are read
  from the phone's gyroscope on the phone itself; swing speed is shot power.
- ⏱️ **Timing is the skill.** On time is a paced, angled ball. Early goes wide,
  late goes long. Players run to the ball automatically — you only swing.
- 📱 **Scan and play.** A QR code on the TV, one tap on the phone. Lock your
  phone mid-match and you come back as the same player on the same side.
- 🤖 **Play the machine** with one phone, or a friend with two — split screen,
  each half from behind its own player.
- 🏟️ **A floodlit night stadium**: cel-shaded athletes, a living crowd, bloom,
  an umpire who calls the score, and synthesised sound. No image or audio files
  — every asset is drawn or generated in code.
- 🔒 **Real HTTPS on your LAN** with a publicly trusted certificate, so guests
  never see a warning or install a profile. Its private key is public by
  design, so this buys the browser's trust, not privacy from others on the
  same Wi-Fi.

## How it works

```mermaid
flowchart LR
    subgraph phones["📱 iPhones — Safari"]
        A["Racket<br/>motion 60 Hz → swing detector"]
        B["Racket<br/>motion 60 Hz → swing detector"]
    end
    subgraph mac["💻 Host computer"]
        R["Relay — Node + ws<br/>player slots, no game state"]
        H["Host page<br/>authoritative sim at 120 Hz<br/>Three.js renderer"]
    end
    A -- "swing {stroke, power, lag}" --> R
    B -- "swing" --> R
    R -- "swing + playerId" --> H
    H -- "phase · score · feedback" --> R
    R -- "score · feedback" --> A & B
```

- **The phone does the sensing.** Swing detection runs on the device, so the
  wire carries a few small events per rally instead of a sensor firehose.
- **The host browser is the game.** The simulation is a pure, deterministic
  `tick(state, inputs, dt)` that runs in the host's browser. The server is only
  a relay — it holds player slots and nothing else.
- **Latency is measured, not guessed.** The phone reports how late its detector
  fired, and the host subtracts it. Swings are judged against one frozen
  contact point per ball: early swings wait for it, late ones are rewound to it.

## Engineering highlights

The interesting problems turned out not to be tennis at all.

| | |
| --- | --- |
| **Purity enforced by the compiler** | `src/shared` — the whole simulation and swing detector — cannot see the DOM or Node. Three tsconfig projects make an accidental `window` a type error, which is why more than 450 tests run in two seconds without a browser or a phone. |
| **Tuned against real motion** | 26 recorded iPhone motion traces are committed as fixtures: forehands, backhands and serves, plus the negatives that matter more — a phone on a table, in a pocket, someone walking, someone talking with their hands. None of those may ever read as a swing. |
| **HTTPS on a LAN, with no warning** | iOS refuses motion sensors outside a secure context. The fix is a publicly trusted wildcard certificate for hostnames that resolve to private IPs — and a diagnosis script for the home routers that silently drop that DNS answer. |
| **Found on real GPUs** | Two rendering bugs that only Apple's Metal driver shows — a multisampled target discarded after resolve, and a `pow()` of a slightly negative number returning NaN that bloom smeared into black blocks — were reproduced in headless Chrome on the real GPU and fixed at the cause. |
| **Every decision written down** | More than twenty architecture decision records, each with the alternatives that were rejected: why Three.js over Phaser, why raw WebSockets over Socket.IO, why swing timing uses the host's clock and never the phone's. |

## The experiment: an AI with a memory

CouchCourt was built almost entirely by pair-programming with
[Claude Code](https://claude.com/claude-code). The real subject of the
experiment was not the game but the memory.

A coding agent starts every session knowing nothing. This project's hard parts
— platform quirks, constants found by measurement, the dead ends — are exactly
the things the code does not show. So the repository carries its own long-term
memory:

- [`llm-knowledge/`](llm-knowledge) is an [Obsidian](https://obsidian.md) vault
  of 60-odd notes: an [architecture map](llm-knowledge/architecture.md), one page
  per module, decision records, platform notes and measured experiments.
- [`CLAUDE.md`](CLAUDE.md) is the working contract. Read the vault's
  [index](llm-knowledge/index.md) first. Keep a session log while working.
  Work test-first, and watch every test fail before trusting it. Promote
  anything that will still be true in a month into the vault before finishing.
- `npm run vault:check` runs in CI. It fails on a broken link, an orphaned note,
  a pointer to a file that no longer exists, or a source folder with no module
  page — so the memory cannot quietly rot.
- [`llm-knowledge/log.md`](llm-knowledge/log.md) is the project's history in
  the agent's own words, including what was tried and abandoned.

What held up: sessions stopped re-deriving the same platform behaviour, and
"a green test you never saw fail" became a rule after it bit three times on
the first day. What did not: a note is a claim, not evidence, and at least one
confidently wrong note had to be caught by re-running the experiment behind it.

## Getting started

**You need:** a computer with Node 24.3 or newer ([`.nvmrc`](.nvmrc) picks the Node 24 LTS) and a recent
desktop browser; an iPhone on the same Wi-Fi; and a router that does not
block DNS rebinding (most don't; the setup script checks).

Developed and played on macOS. Nothing in it is Mac-specific: the server is
plain Node, and certificate setup uses Node's own crypto, not `openssl`. So
Windows and Linux should work too, but neither has been tested yet. On
Windows, allow Node through the firewall on **private networks** when it asks,
or the phones cannot connect.

```bash
npm install
npm run certs   # fetch TLS certificates for your LAN address and print the URLs
npm start       # build, serve both pages, host the relay, and print the URLs
```

Then open the **Host** URL that `npm start` prints. It is a
`*.my.local-ip.co` name for your LAN address, the only kind of name the
certificate covers; the same address as a bare IP would get a certificate
warning, and the QR code on the host page would hand that warning to every
phone.

> [!NOTE]
> HTTPS is not optional: iOS only exposes the motion sensors to a secure page.
> If Safari says the hostname does not resolve, your router is dropping the DNS
> answer. It is a one-time router setting, and `npm run certs` tells you where to
> look — details in
> [`platform/lan-https-dns-rebind.md`](llm-knowledge/platform/lan-https-dns-rebind.md).

### Playing

1. Open the host URL on the computer. The title screen shows a QR code.
2. Scan it with an iPhone camera and tap **Let's play** — that one tap grants the
   motion sensors and is also your ready signal.
3. **Start match** with two phones in, or **Play the machine** with one.
4. Hold the phone like a racket handle, top edge up, and swing.

| Key | |
| --- | --- |
| `C` | Cycle the camera: broadcast, follow, side-on |
| `F` | Full screen |
| `S` | Settings |

### Commands

| Command | What it does |
| --- | --- |
| `npm start` | Build, then serve both pages and the relay, and print the URLs to open. This is how you play |
| `npm run dev` | Vite dev server with hot reload and the motion trace recorder |
| `npm run certs` | Fetch LAN certificates, diagnose router DNS |
| `npm test` | Vitest |
| `npm run typecheck` | All three tsconfig projects |
| `npm run check` | Biome lint and format check (`npm run format` writes fixes) |
| `npm run build` | Production build into `dist/` |
| `npm run vault:check` | Knowledge vault integrity |

CI runs everything except `dev` and `certs` on every pull request, on Linux,
Windows and macOS.

## Project layout

```
src/shared/       pure logic: wire protocol, simulation, swing detection
src/server/       the WebSocket relay and player slots
src/host/         the host display: match state machine, Three.js renderer, audio
src/controller/   the iPhone racket: permission gate, swing stream, string bed
scripts/          Vite plugins, certificate setup, the vault checker
tests/            integration tests and 26 recorded motion traces
llm-knowledge/    the Obsidian vault: the project's long-term memory
```

## Status

**Played and working on real phones** — an iPhone 14 Pro and an iPhone 16e,
over LAN HTTPS, against a Mac host that holds 60 fps on an Apple M3. Before any
phone touched it, a full set was played to 6–0 and rematched in headless
Chrome, driven through the real pages over the real relay.

What is next is measurement rather than proof: how often a swing is read as the
wrong stroke, and tuning the timing window against real players instead of a
simulated one. Single swings recorded at rally spacing are the most useful
contribution anyone could make.

Out of scope, on purpose: doubles, manual player movement, play across
networks, custom characters, and accounts or stats.

## License

[MIT](LICENSE) © 2026 Lars Kuehn

## Acknowledgements

CouchCourt stands on some excellent open-source work:

- [three.js](https://threejs.org) — the renderer behind the whole stadium.
- [ws](https://github.com/websockets/ws) — the small, fast WebSocket server the relay is built on.
- [Vite](https://vite.dev) — dev server, build, and the production server that hosts the relay.
- [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) by Kazuhiko Arase — the join code.
- [Phosphor Icons](https://phosphoricons.com) by Helena Zhang and Tobias Fried — the UI's icons.
- [local-ip.co](https://local-ip.co) — publicly trusted certificates for LAN addresses, which make zero-warning HTTPS possible.
- [Vitest](https://vitest.dev), [Biome](https://biomejs.dev) and [TypeScript](https://www.typescriptlang.org) — the test runner, the linter and formatter, and the type system that keeps the simulation pure.
- [Obsidian](https://obsidian.md) — for making a folder of Markdown pleasant to think in.
- [Claude Code](https://claude.com/claude-code) by Anthropic — the pair programmer on the other end of the experiment.

And to every living room that ever had four controllers and one TV.
