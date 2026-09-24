---
title: How this vault works
updated: 2026-09-20
tags: [meta]
status: current
code:
  - `scripts/check-vault.mjs`
  - `.github/workflows/ci.yml`
---

# How this vault works

An Obsidian vault, and the long-term memory for every Claude Code session on
CouchCourt. Sessions read it before working and write to it before finishing;
`CLAUDE.md` in the repo root is what enforces that.

Open it by pointing Obsidian at `llm-knowledge/`. No plugins — plain Markdown
with wikilinks. The pattern it is built on is [[llm-wiki]]: the agent writes
and maintains the wiki, the human curates and asks; the wiki is a
**compounding artifact**, not a pile of documents to be re-read from scratch
each time.

## The two rules

**1. The vault holds what is expensive to re-derive.**

**2. The vault must be able to describe the system**, not only justify it.

Rule 2 is newer and exists because the vault spent its first days unable to
say how anything connected. Four folders all answered *why* — a decision, a
platform constraint, a measurement, a domain rule — and nothing answered *what
calls what*. That made it abstract by construction. `modules/` and
[[architecture]] are rule 2's half.

| Belongs here | Does not |
| --- | --- |
| Platform behaviour found the hard way | The folder structure |
| Constants discovered by measurement | A function's signature or return type |
| A decision and the alternatives rejected | What a named function does |
| Why something surprising is the way it is | Anything one open file answers |
| **The import graph and who depends on whom** | **A list of exports** |
| **An invariant that spans several files** | An invariant enforced three lines away |

The right-hand column duplicates the repo and goes stale at the next refactor.
A confidently wrong note is worse than a missing one.

### The line `modules/` walks

A module page is a **map and a contract**, never an API reference. The
distinction that keeps it honest:

- **Write it** if answering the question means reading the whole tree — what
  imports this, what breaks if I change it, which invariant holds across these
  six files, what has already gone wrong here.
- **Leave it out** if one open file answers it — a signature, a parameter
  list, what a function returns.

"Grep answers it in a minute" retires a fact about *one file*. It does not
retire a fact about the *graph*, because grep does not have the graph.

## Where a note goes

Six homes, chosen so "where does this go?" has exactly one answer.

- **`architecture.md`** — the whole system. One page, no folder. The only note
  allowed to be about everything.
- **`modules/`** — one page per subsystem, named for the code it maps. Files,
  wiring, invariants, traps, gaps, and links out to the notes that constrain
  it. **Every top-level `src/*` directory must have one** — CI checks.
- **`decisions/`** — a choice we will not casually revisit. Numbered, ADR
  style. Records the alternatives rejected, because that is the part nobody
  can reconstruct later.
- **`platform/`** — how the outside world behaves. iOS, Safari, routers,
  certificates. Not our code and not fixable, only workable around.
- **`reference/`** — how our own system and its domain are defined. Tennis
  rules, the coordinate frame, the protocol's intent.
- **`experiments/`** — something measured, with a date and numbers. A tuned
  constant lives here next to the evidence that produced it.

Plus two files that are not topic notes:

- **`index.md`** — the catalog. Every note, one line. Updated on every change.
- **`log.md`** — the chronology. One entry per session that landed something.

And **`sessions/`** — dated logs, gitignored, local scratch.

There is no `plans/`. A multi-session plan lives in the branch's PR body and
its session logs; when it lands, what survives it gets promoted like anything
else. The one plan that was committed here was deleted on landing and took
durable content with it, which had to be recovered from git history.

## Sessions are an inbox, not the product

A session log is a raw dump: what was done, what was found, and above all
**what failed and why**, which is the part nobody can reconstruct from a diff.
It is scratch, it is gitignored, and nobody will read it in six months.

**Anything in it that will still be true in a month gets promoted** into a
folder above, linked from [[index]], and summarised in one entry in [[log]].
The promotion is the part that matters. A vault where knowledge only
accumulates in dated logs is a diary, and nobody greps a diary.

## Note format

```yaml
---
title: Short human title
updated: 2026-09-20   # ISO date, enforced
tags: [platform, ios]
status: current       # or: superseded
code:                 # files this concept lives in, verified
  - `src/shared/protocol.ts`
  - `src/shared/swing/`
---
```

`code:` is the pointer from a concept to the files responsible for it, so a
session opens the right file instead of searching the tree — the search is the
expensive part and it is the same search every time. Pointing *at* a file is a
router entry. Describing *what is in* it is duplication. Write the path.

**Paths in `code:` and in table cells are verified by CI. Prose is exempt**, so
a note may still name a file nobody has written yet ("the controller will
send…"). Checking prose would make forward references impossible and the check
would get switched off.

When a note stops being true, **do not delete it** — set `status: superseded`
and link its replacement, so a session that finds the old note learns it is
old instead of acting on it.

## Maintaining it

Three operations, borrowed from [[llm-wiki]] and adapted to a codebase.

**Promote** — at the end of a session. Harvest the log: durable findings into
the folders, a row in [[index]], an entry in [[log]], `code:` pointers on
anything new. If you moved or renamed a file, fix the pointers that named it.

**Revise** — when new work contradicts a note. Do not stack a correction on
top; supersede the note and link forward. Current observed behaviour outranks
a recorded claim, always. The `serve-reachability` pair is the worked example.

**Lint** — occasionally, and always worth asking for explicitly. `npm run
vault:check` catches the mechanical failures. The ones it cannot catch, and
that a session should look for when asked to health-check the vault:

- notes that contradict each other, or a note the code has quietly outgrown
- a concept referenced in several notes that has no page of its own
- a module page whose "gaps" section describes something since built
- [[index]] rows that no longer match what a note is about
- a decision whose rejected alternative has become the obvious choice

## What CI checks

`npm run vault:check`, deliberately six narrow rules. A linter nobody can
satisfy gets disabled, and then it guards nothing.

1. Every note has frontmatter with a valid ISO `updated:` date.
2. A `superseded` note links to a successor.
3. Every wikilink resolves to a note that exists.
4. Every path in `code:` or a table cell exists.
5. **Every note is reachable from [[index]]** by following wikilinks. A note
   nobody can find is a note nobody reads.
6. **Every top-level `src/*` directory is named by some `modules/` page.** New
   subsystem, new page — this is rule 2 made mechanical.

Each rule has been watched failing on purpose. A guard that has never caught
anything is a guess.

Note that a wikilink to a note you have not written yet fails CI. Either write
the note or drop the link.
