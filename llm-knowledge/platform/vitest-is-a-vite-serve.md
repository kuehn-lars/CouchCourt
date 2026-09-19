---
title: A Vite plugin's apply "serve" also runs under Vitest
updated: 2026-09-19
tags: [platform, vite, vitest, tooling]
status: current
code:
  - `vite.config.ts`
  - `scripts/trace-endpoint.ts`
---

# `apply: "serve"` does not mean "dev only"

Vitest runs the Vite config as **`command: "serve"` with `mode: "test"`**. A
plugin gated only on `apply: "serve"` is therefore installed during
`vitest run` as well as during `npm run dev`.

For a plugin that adds a middleware this is not academic. The trace endpoint
(`scripts/trace-endpoint.ts`) writes files into `tests/fixtures/motion/`;
installing it during the test run puts a filesystem-writing HTTP handler inside
the thing that is supposed to be verifying the code.

## The gate that works

`vite.config.ts` already computed the right predicate for a different reason —
suppressing the "iOS will refuse motion sensors" warning in CI logs:

```ts
const serving = command === "serve" && mode !== "test";
```

Gate plugins on that, not on `apply` alone:

```ts
plugins: serving ? [traceEndpoint(fromRoot("./tests/fixtures/motion"))] : [],
```

Keep `apply: "serve"` too. It is what keeps the plugin out of `vite build`,
which the `serving` check alone would not do.

## Verified, not assumed

2026-09-19. A `console.log` was placed in the plugin factory and each entry
point run:

| command | factory called |
| --- | --- |
| `npx vitest run` | no |
| `npm run build` | no |
| `npm run dev` | yes |

Without the `serving` gate the first row becomes "yes", silently. Nothing in the
test output would say so — which is the reason this note exists rather than a
comment.
