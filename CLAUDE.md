# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.


Guidance for Claude Code sessions working in this repository.

## Read this first, every session

**Before doing anything else, read `llm-knowledge/index.md`.**

It is a short router into the knowledge vault — the project's long-term memory.
Then read whichever notes it points to that touch your task. The vault exists
because this project's hard parts are not visible in the code: iOS permission
rules, router behaviour, certificate chains, and decisions whose alternatives
are no longer on disk.

Skipping it means rediscovering something that already cost someone an evening.
At minimum, before touching:

| Area | Read |
| --- | --- |
| anything in `src/shared` | `decisions/0002-host-authoritative-simulation.md` |
| the controller or motion input | `platform/ios-motion-permission.md` |
| networking, sockets, reconnection | `platform/ios-safari-tab-suspension.md`, `decisions/0005-*` |
| HTTPS, certificates, the QR flow | `decisions/0004-*`, `platform/lan-https-dns-rebind.md` |
| protocol or message shapes | `reference/wire-protocol.md` |
| scoring | `reference/tennis-scoring.md` |

## Write back before you finish

Every session ends by updating the vault. Two steps:

1. **Log it.** Write `llm-knowledge/sessions/YYYY-MM-DD-<slug>.md` — what you
   did, what surprised you, what you tried that did not work. This folder is
   gitignored scratch; be honest and rough.
2. **Promote it.** Anything in that log which will **still be true in a month**
   becomes a note in `decisions/`, `platform/`, `reference/` or `experiments/`,
   and gets linked from `llm-knowledge/index.md`.

Step 2 is the one that matters. A vault where knowledge only accumulates in
dated logs is a diary, and nobody greps a diary.

### What belongs in the vault

**The test: would a future session spend more than a few minutes re-deriving
this?**

Yes — write it down:
- Platform behaviour found the hard way (iOS, Safari, routers, certificates)
- Constants discovered by measurement, stored next to the evidence
- A decision, and specifically the alternatives rejected and why
- Why something surprising is the way it is

No — leave it out:
- The folder structure, or what a file contains
- Our own code's API or function behaviour
- Anything `grep` would answer in under a minute

The second list duplicates the repo and goes stale at the next refactor. **A
confidently wrong note is worse than a missing one.**

When a note stops being true, do not delete it. Set `status: superseded` and
link its replacement, so a future session learns the note is old instead of
acting on it.

Full rules: `llm-knowledge/README.md`. Format is enforced by
`npm run vault:check`, which runs in CI.

## Architecture in one paragraph

A Node server serves two pages and relays WebSocket messages. The **host** page
(Mac, Three.js) runs the authoritative simulation. The **controller** page
(iPhone, Safari) reads motion sensors, detects swings *on the phone*, and sends
semantic events — never a raw sensor stream. The server owns player slots and no
game state.

## The invariant that matters

**`src/shared` is pure.** No DOM, no Node APIs, no I/O, no ambient clock or
randomness. It holds the protocol, the simulation and the swing detector.

This is why the entire simulation is testable headless, with no browser, no
server and no phone. It is enforced by the typechecker, not by convention:
`src/shared` is compiled by both `tsconfig.web.json` (DOM, no `@types/node`) and
`tsconfig.node.json` (`@types/node`, no DOM), so a violation in either direction
fails `npm run typecheck`.

Two consequences that are easy to get wrong:

- The simulation is a fixed-timestep pure function, `tick(state, inputs, dt)`.
  Anything non-deterministic is passed *in*, never read inside. Breaking this
  silently breaks replay-based tests.
- The swing detector is a pure function over a sample stream. It must not
  subscribe to `devicemotion` itself — the listener lives in `src/controller`.
  This is what allows detection to be tuned offline against recorded traces.

## Commands

```bash
npm run dev        # Vite dev server, HTTPS if ./certs exists
npm run certs      # fetch LAN certificates; also diagnoses router DNS problems
npm run check      # Biome lint + format
npm run format     # Biome, writing fixes
npm run typecheck  # both tsconfig projects
npm test           # Vitest
npm run build      # Vite production build
npm run vault:check
```

CI runs `check`, `typecheck`, `test`, `build` and `vault:check` on every pull
request. Run them locally before pushing.

## Conventions

- **TypeScript, erasable syntax only.** The server runs via
  `node src/server/main.ts` using Node's native type stripping, so no `enum`, no
  namespaces, no parameter properties. `erasableSyntaxOnly` fails the typecheck
  rather than letting it fail at runtime.
- **Relative imports carry the `.ts` extension**, because Node's resolver
  requires it and Vite accepts it.
- **Biome**, not ESLint or Prettier. One tool, one config.
- **Tests colocate** as `*.test.ts` next to the source. `tests/` holds only
  integration tests and fixtures.
- **Do not add a dependency** without a note in `llm-knowledge/decisions/`
  saying what it replaces and what was rejected. The project's premise is zero
  install and a small surface.

## Testing strategy

Test the pure parts hard; do not chase the rest.

- **Scoring** — pure, fiddly, easy to get subtly wrong. Highest value per test.
- **Physics and rally state** — fixed timestep makes these deterministic.
- **Swing detection** — against **recorded motion traces** in
  `tests/fixtures/motion/`. Record real swings on a phone once, commit the JSON,
  then tune forever in Vitest with no phone in hand. Include negatives: setting
  the phone down, gesturing while talking. This is the project's main testing
  leverage — preserve it.
- **Server** — integration test covering join, slot assignment, and
  resume-after-drop.

Not tested: rendering, audio, anything needing real hardware. Motion input
cannot be verified in CI, so say in the PR which iPhone and iOS version you
tried.

## Scope discipline

`PRODUCT.md` lists what v1 is not: doubles, manual movement, online play,
accounts, persistent stats. Do not build them, and do not add abstractions in
anticipation of them.

The bar in `PRODUCT.md` is "feels good to play with friends", not technical
accuracy. When those two conflict, feel wins.

## Current state

Repository harness only. Configuration, CI, the knowledge vault, the wire
protocol contract and two placeholder HTML pages. **No gameplay code exists
yet** — no server, no renderer, no simulation, no swing detection.