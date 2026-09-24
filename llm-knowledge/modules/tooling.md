---
title: "Module: build, typecheck, test and CI"
updated: 2026-09-25
tags: [module, tooling, build, ci]
status: current
code:
  - `vite.config.ts`
  - `tsconfig.base.json`
  - `tsconfig.web.json`
  - `tsconfig.node.json`
  - `tsconfig.test.json`
  - `biome.json`
  - `scripts/setup-certs.ts`
  - `scripts/cert-chain.ts`
  - `scripts/cert-chain.test.ts`
  - `scripts/lan-urls.ts`
  - `scripts/lan-urls.test.ts`
  - `scripts/trace-endpoint.ts`
  - `scripts/relay-plugin.ts`
  - `scripts/check-vault.mjs`
  - `.github/workflows/ci.yml`
  - `.nvmrc`
---

# Module: build, typecheck, test and CI

One package, one lockfile, one lint config, one test runner, one CI job —
[[0001-single-package-vite-mpa]]. The folders under `src/` are folders, not
packages, so boundaries are enforced by the typechecker instead of by the
package manager.

## Commands

| Command | Does |
| --- | --- |
| `npm run dev` | Vite dev server; HTTPS when `./certs` exists; relay + trace endpoint attached; prints the local-ip.co URLs |
| `npm start` | `vite build && vite preview` — **this is production**, [[0010-vite-preview-as-production-server]]. Relay attached, trace endpoint **not**; prints the local-ip.co URLs |
| `npm run certs` | Fetch LAN certificates, diagnose router DNS |
| `npm run check` | `biome ci .` — lint and format |
| `npm run format` | `biome check --write .` |
| `npm run typecheck` | **Three** tsc projects |
| `npm test` | Vitest |
| `npm run build` | `vite build` — three static pages into `dist/`: the `/` redirect, the host and the controller |
| `npm run vault:check` | Vault integrity |

CI runs everything except `dev` and `certs` on every PR, each step guarded by
`if: ${{ !cancelled() }}` so one lint error does not mask every test failure —
one run reports everything that is wrong.

**The job is a matrix: Ubuntu, Windows and macOS** (since 2026-09-24),
`fail-fast: false`. Every step runs on all three, lint and vault check
included, because those are where line endings and path separators would
break first. `workflow_dispatch` lets it run on a branch from the Actions tab
once the workflow is on `main`. `npm run certs` is still not run in CI: it
downloads from local-ip.co, a third party, and a PR should not depend on it.

`.gitattributes` forces `eol=lf`. Without it Git for Windows checks out CRLF,
which fails Biome's format check on every file and stops the vault checker's
`code:` regex at the first `\r` (`.` does not match `\r`).

## The `serving` gate now has three cases, not two

`vite.config.ts`'s predicate used to separate "actually serving a browser"
from Vitest. There is a third case now, and it needs `isPreview` from
Vite's `ConfigEnv` (7 and 8):

| | dev (`vite`) | preview (`vite preview`) | vitest | build |
| --- | --- | --- | --- | --- |
| `command` | serve | **serve** | serve | build |
| `mode` | development | production | test | production |
| `isPreview` | false | **true** | false | — |
| relay plugin | yes | **yes** | no | no |
| trace endpoint | yes | **no** | no | no |

The trace endpoint writes into `tests/fixtures/motion/`, so it belongs only
to dev. The relay belongs to both real servers. `apply: "serve"` alone
distinguishes none of these — that is [[vitest-is-a-vite-serve]]'s trap, and
preview is its third case.

And: **any `https` option makes Vite's server an `Http2SecureServer`**, not
an `https.Server`, in dev and preview alike. [[vite-https-is-http2]].

## The three tsconfig projects

**Not interchangeable.** Two enforce a boundary, the third deliberately
enforces none.

| Project | `lib` | `types` | Covers |
| --- | --- | --- | --- |
| `tsconfig.web.json` | ES2023 + DOM | `[]` | `src/shared`, `src/host`, `src/controller` |
| `tsconfig.node.json` | ES2023 | `node` | `src/shared`, `src/server`, `vite.config.ts`, `scripts/` |
| `tsconfig.test.json` | ES2023 + DOM | `node` | every colocated test (`src/` and `scripts/`), plus `tests/` |

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
  truth shared with `scripts/setup-certs.ts`.
- `build.chunkSizeWarningLimit: 700`. The host bundle is ~672 kB on Vite 8
  (665 kB on Vite 7), and three.js alone is 543 kB minified, so a `three`
  manualChunk still trips Vite's default 500 kB and only adds a request (measured 2026-09-25). The limit sits
  just above today's size, so the warning still means "this grew"; a 600 kB
  limit was run and does warn.
- `test.environment: "node"` — no jsdom. Everything worth testing is pure or
  server-side.

## The scripts

| Script | Runs when | Does |
| --- | --- | --- |
| `scripts/setup-certs.ts` | `npm run certs` | Fetches the leaf, **rebuilds the chain from its AIA extension**, verifies it in memory before writing, and diagnoses router DNS rebind protection |
| `scripts/cert-chain.ts` | imported by `setup-certs.ts` | The certificate work, pure and tested: AIA URL, DER→PEM, expiry, `chainProblem` (chain to a trusted root, for the hostname) and `keyProblem` (the key belongs to the leaf) |
| `scripts/lan-urls.ts` | dev and preview, gated on `serving`; imported by `setup-certs.ts` | Prints the local-ip.co Host and Controller URLs in place of Vite's `Local:` / `Network:` lines; `localIpHostname` is the one place the name is built |
| `scripts/trace-endpoint.ts` | dev only, gated on `serving` | POST endpoint that validates a trace and writes it into `tests/fixtures/motion/` |
| `scripts/relay-plugin.ts` | dev and preview, gated on `serving` | Attaches `attachRelay` to Vite's own `httpServer` — one port, one code path |

**No `openssl`, since 2026-09-24.** `setup-certs` used to shell out to it
four times: to read AIA, convert DER to PEM, run `verify -verify_hostname`, and
read the expiry. Windows does not ship `openssl`, so `npm run certs` could not
run there. `cert-chain.ts` does the same on `node:crypto` `X509Certificate`,
verifying against `tls.rootCertificates` — the Mozilla store bundled with Node,
so the answer no longer depends on which OS trust store `openssl` happened to
read. Verified by running it with a PATH holding only `node`: the rebuilt
`cert.pem` was byte-identical to the one the openssl version wrote. Roots and
the clock are parameters. Its tests use the throwaway chain in
`tests/fixtures/certs/`, so they need neither network nor `openssl`.

The ignore rule is `/certs/`, anchored. Unanchored, `certs/` also swallowed
`tests/fixtures/certs/`: the tests passed locally and would have failed in CI
for missing files.

**`./certs` only ever holds a chain that passed `chainProblem`.** A new chain
is checked in memory and written only if it passes; a chain already on disk
that fails the check is deleted *before* the rebuild, so a failed download
cannot leave it behind for `npm run dev` to serve. A chain that passes but is
within `RENEW_WITHIN_DAYS` of expiry is kept until the rebuild succeeds. All
three paths were run on 2026-09-24 against the real local-ip.co.

`setup-certs` is `.ts`, run by `node` directly, and typechecked by
`tsconfig.node.json` like the other scripts. That is why `engines` is
`>=24.3`: type stripping prints an `ExperimentalWarning` through Node 24.2.0
and is silent from 24.3.0 (bisected with `npx node@24.x`), and a warning in
setup output only reads as something going wrong.

The throwaway chain has two fixtures whose only job is to make a guard fail:
`impostor-intermediate.pem` (right name, signed by the root, wrong key, **no**
subject key identifier, so `checkIssued` passes and only the signature check
rejects it) and `short-lived-root.pem` (the root's key and name, expired in
2026, so only the root's own dates are wrong). Before them, removing the
signature check, the root-validity check or the not-before check left every
test green. `keyProblem` exists because the leaf and the key are two
downloads and a rotation between them fails every handshake silently; its
tests use the `tests/fixtures/tls/` keypair, so the chain fixtures still keep
no private keys.

**What `npm run dev` and `npm start` print.** Vite's banner offers
`https://<ip>:5173/`, which the certificate does not cover, and the host page
puts its own origin in the join QR code. `lan-urls.ts` replaces the server's
`printUrls` (Vite's CLI calls it after `listen` for both dev and preview, and
the `u` shortcut calls it too) with the local-ip.co Host and Controller URL
for each IPv4 network address, the same lines `npm run certs` prints. Over
plain HTTP, or with no network, it defers to Vite's own output. Verified
2026-09-25 by starting both servers: the printed Host URL answered 200 with
a verified chain.

`.nvmrc` is `lts/krypton`, the Node 24 LTS line (first release 24.11.0), not
`24`: `nvm use 24` picks the newest *installed* 24.x, which can be below the
`engines` floor. `actions/setup-node` reads the same file.

`setup-certs.ts` must not use local-ip.co's published `chain.pem`: it is
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

**Paths inside the checker are always `/`.** A note's `where` comes from
`path.relative`, which returns `\` on Windows, and rule 6 matches it against
`llm-knowledge/modules/`. On Windows no page matched and every `src/` folder
was reported uncovered (CI, 2026-09-25), so `where` is normalised to `/`.
Reproduced on macOS by rewriting `where` with backslashes; the fix passes the
same rewrite.

**Dependencies.** Vite 8 and Vitest 5 since 2026-09-25 (dev and preview
smoke-run: printed URLs, HTTP/2 200, relay upgrade). `@types/node` stays on
the runtime's major — `.nvmrc`'s Node 24 — and Dependabot ignores its majors;
bump it with `.nvmrc`. npm 10 (Node 23's) crashes resolving Vitest 5's peers
(`Cannot read properties of null (reading 'edgesOut')`); npm 11, which Node
24 ships, installs it.

## See also

[[architecture]] · [[0001-single-package-vite-mpa]] ·
[[0002-host-authoritative-simulation]] · [[vitest-is-a-vite-serve]] ·
[[0004-lan-https-via-local-ip-co]] · [[lan-https-cert-chain]] ·
[[lan-https-dns-rebind]] · [[modules/server]]
