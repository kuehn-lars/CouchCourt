---
title: How this vault works
updated: 2026-09-19
tags: [meta]
status: current
code:
  - `scripts/check-vault.mjs`
  - `.github/workflows/ci.yml`
---

# How this vault works

This is an Obsidian vault, and it is also the long-term memory for every Claude
Code session on SwingCourt. Sessions read it before working and write to it
before finishing. `CLAUDE.md` in the repo root is what enforces that.

Open it in Obsidian by pointing at `llm-knowledge/`. No plugins are required —
everything here is plain Markdown with wikilinks.

## The one rule

**The vault holds what is expensive to re-derive.**

| Belongs here | Does not belong here |
| --- | --- |
| Platform gotchas found the hard way | The folder structure |
| Constants discovered by experiment | Our own code's API |
| A decision and the alternatives rejected | What a function does |
| Why something surprising is the way it is | Anything `grep` would answer |

The right-hand column duplicates the repo and goes stale on the next refactor,
and a confidently wrong note is worse than a missing one. If a future session
could answer the question by reading the code in under a minute, it is not a
note.

## Where a note goes

Five folders, chosen so that "where does this go?" has exactly one answer.

- **`decisions/`** — a choice we made and will not casually revisit. Numbered,
  ADR-style. Records the alternatives rejected and why, because that is the part
  nobody can reconstruct later.
- **`platform/`** — how the outside world behaves. iOS, Safari, Wi-Fi, routers,
  certificates. Not our code, and not something we can fix — only work around.
- **`reference/`** — how our own system and its domain are defined. Tennis
  rules, court geometry, the wire protocol's intent.
- **`experiments/`** — something we actually measured, with a date and numbers.
  Tuning constants live here, next to the evidence that produced them.
- **`sessions/`** — dated session logs. Gitignored, local to your machine.

## Sessions are an inbox, not the product

A session log is a raw dump of what happened. It is scratch, it is gitignored,
and nobody will read it in six months.

**Anything in a session log that will still be true in a month gets promoted**
into one of the four topic folders and linked from [[index]]. The promotion is
the part that matters. A vault where knowledge only ever accumulates in dated
logs is a diary, and nobody greps a diary.

## Note format

Every committed note needs frontmatter:

```yaml
---
title: Short human title
updated: 2026-09-19   # ISO date, enforced by CI
tags: [platform, ios]
status: current       # or: superseded
code:                 # files this concept lives in, verified by CI
  - `src/shared/protocol.ts`
  - `src/shared/swing/`
---
```

## Point at the code

`code:` is the pointer from a concept to the files responsible for it. It
exists so a session can open the right file immediately instead of searching
the tree — the search is the expensive part, and it is the same search every
time.

This does not contradict the rule above about not duplicating the repo.
Pointing *at* a file is a router entry that saves a search. Describing *what is
in* the file is duplication that goes stale. Write the path, not the contents.

CI verifies that every `code:` path and every path in a table still exists, so
a pointer cannot quietly rot into a lie. Prose is exempt, so a note may still
name a file nobody has written yet.

Concept-to-file routing for the whole project lives in [[index]].

When a note stops being true, do not delete it — set `status: superseded` and
link the note that replaced it. A future session that finds the old note then
learns it is old instead of acting on it. CI rejects a superseded note that
links to nothing.

## What CI checks

`npm run vault:check` enforces two things only:

1. Every note has frontmatter with a valid ISO `updated:` date.
2. Every wikilink resolves to a note that actually exists.

Deliberately nothing else. A linter nobody can satisfy gets disabled, and then
it guards nothing. Broken links are the actual way this vault would rot.

Note that a link to a note you have not written yet will fail CI. Either write
the note or drop the link.
