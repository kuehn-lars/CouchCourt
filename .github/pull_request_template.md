## What and why

<!-- What changes, and what problem it solves. Link an issue if there is one. -->

## Checks

- [ ] `npm run check && npm run typecheck && npm test && npm run build` passes locally
- [ ] `src/shared` stayed pure — no DOM, no Node APIs
- [ ] New behaviour has a test, or there is a reason in the PR why it does not

## Knowledge vault

- [ ] Anything learned here that is expensive to re-derive is written into `llm-knowledge/` and linked from `index.md` — **or** nothing durable was learned

<!--
Expensive to re-derive: platform gotchas, constants found by experiment,
decisions and the alternatives rejected.

Not that: folder structure, our own code's API, anything a grep would answer.
Those duplicate the repo and go stale on the next refactor.
-->

## Tested on hardware

<!-- Motion input cannot be verified in CI. If this touches the controller or
     swing detection, say which iPhone and iOS version you tried it on. -->
