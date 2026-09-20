---
title: "Module: build, typecheck, test and CI"
updated: 2026-09-20
tags: [module, tooling, build, ci]
status: current
code:
  - `vite.config.ts`
  - `tsconfig.base.json`
  - `tsconfig.web.json`
  - `tsconfig.node.json`
  - `tsconfig.test.json`
  - `biome.json`
  - `scripts/setup-certs.mjs`
  - `scripts/trace-endpoint.ts`
  - `scripts/relay-plugin.ts`
  - `scripts/check-vault.mjs`
  - `.github/workflows/ci.yml`
---

# Module: build, typecheck, test and CI

One package, one lockfile, one lint config, one test runner, one CI job —
[[0001-single-package-vite-mpa]]. The folders under `src/` are folders, not
packages, so boundaries are enforced by the typechecker instead of by the
package manager.

## Commands

| Command | Does |
| --- | --- |
| `npm run dev` | Vite dev server; HTTPS when `./certs` exists; relay + trace endpoint attached |
| `npm run certs` | Fetch LAN certificates, diagnose router DNS |
| `npm run check` | `biome ci .` — lint and format |
| `npm run format` | `biome check --write .` |
| `npm run typecheck` | **Three** tsc projects |
| `npm test` | Vitest |
| `npm run build` | `vite build` — two static pages into `dist/` |
| `npm run vault:check` | Vault integrity |

CI runs everything except `dev` and `certs` on every PR, each step guarded by
`if: ${{ !cancelled() }}` so one lint error does not mask every test failure —
one run reports everything that is wrong.

## The three tsconfig projects

**Not interchangeable.** Two enforce a boundary, the third deliberately
enforces none.

| Project | `lib` | `types` | Covers |
| --- | --- | --- | --- |
| `tsconfig.web.json` | ES2023 + DOM | `[]` | `src/shared`, `src/host`, `src/controller` |
| `tsconfig.node.json` | ES2023 | `node` | `src/shared`, `src/server`, `vite.config.ts`, `scripts/` |
| `tsconfig.test.json` | ES2023 + DOM | `node` | every colocated test, plus `tests/` |

`src/shared` is in **both** production projects, which is the entire purity
mechanism: `document` fails the node project, `process` fails the web project.

**Both production projects must exclude every `*.test.ts`.** This is the
load-bearing detail. Importing `vitest` pulls `@types/node` in transitively
and silently re-grants `process` to the web project; `types: []` cannot stop
it. That is why a third project exists at all — full account in
[[0002-host-authoritative-simulation]].

`tsconfig.base.json` sets `erasableSyntaxOnly`, so no `enum`, no namespaces,
no parameter properties: the server is meant to run under Node's native type
stripping with no build step, and this fails the typecheck instead of failing
at runtime.

## `vite.config.ts` — and the gate that is easy to get wrong

```ts
const serving = command === "serve" && mode !== "test";
```

**`apply: "serve"` does not mean "dev only".** Vitest runs the Vite config as
`command: "serve"` with `mode: "test"`, so a plugin gated on `apply` alone is
installed during `vitest run` too. For `trace-endpoint.ts` that would put a
filesystem-writing HTTP handler inside the thing meant to be verifying the
code. Gate plugins on `serving`; keep `apply: "serve"` as well, since that is
what keeps them out of `vite build`. Measured, not assumed —
[[vitest-is-a-vite-serve]].

Other things this file decides:

- `root: ./src` so the build emits `dist/host/` and `dist/controller/` rather
  than burying both under `dist/src/`.
- `server.host: true` — guests reach this from their phones, so it must not
  bind to localhost.
- HTTPS **falls back to HTTP** rather than failing when `./certs` is absent.
  Unit tests, the host page and the lobby are all workable over plain HTTP;
  only motion input actually needs TLS.
- The port is read from `package.json`'s `config.port`, the single source of
  truth shared with `scripts/setup-certs.mjs`.
- `test.environment: "node"` — no jsdom. Everything worth testing is pure or
  server-side.

## The three scripts

| Script | Runs when | Does |
| --- | --- | --- |
| `scripts/setup-certs.mjs` | `npm run certs` | Fetches the leaf, **rebuilds the chain from its AIA extension**, verifies before writing, and diagnoses router DNS rebind protection |
| `scripts/trace-endpoint.ts` | dev only, gated on `serving` | POST endpoint that validates a trace and writes it into `tests/fixtures/motion/` |
| `scripts/relay-plugin.ts` | dev only | Attaches `attachRelay` to Vite's own `httpServer` — one port, one code path |

`setup-certs.mjs` must not use local-ip.co's published `chain.pem`: it is
stale relative to the leaf and produces a chain macOS silently repairs by AIA
fetching while **iOS rejects it**. [[lan-https-cert-chain]] is the write-up,
and the transferable lesson in it is worth more than the fix.

## Biome, not ESLint or Prettier

One tool, one config. Tab indent, double quotes, `noNonNullAssertion: error`.

`tests/fixtures/motion/**/*.json` is excluded — Biome reformats JSON, and the
one-sample-per-line trace format would break `npm run check` on the first
committed trace. The exclusion is scoped to `*.json`, **not** the whole
directory: an earlier broad exclusion also silenced `fixtures.test.ts`, which
lives there, leaving it typechecked but never linted.

## `scripts/check-vault.mjs`

Guards the vault against its only real failure mode: silent rot. Rules,
deliberately few — a linter nobody can satisfy gets disabled, and then it
guards nothing:

1. Every note has frontmatter with a valid ISO `updated:` date.
2. A `status: superseded` note links to a successor.
3. Every wikilink resolves.
4. Every path in `code:` frontmatter **and in a table cell** exists.
5. Every note is reachable from `index.md` by following wikilinks.
6. Every top-level `src/*` directory is named by some `modules/` page.

Rules 5 and 6 are what keep the structure from decaying back into a pile of
notes. Prose is exempt from rule 4 on purpose, so a note may still name a file
nobody has written yet — checking prose would make forward references
impossible and the check would get switched off.

`sessions/` and `.obsidian/` are skipped.

## See also

[[architecture]] · [[0001-single-package-vite-mpa]] ·
[[0002-host-authoritative-simulation]] · [[vitest-is-a-vite-serve]] ·
[[0004-lan-https-via-local-ip-co]] · [[lan-https-cert-chain]] ·
[[lan-https-dns-rebind]] · [[modules/server]]
