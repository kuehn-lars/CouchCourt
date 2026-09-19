# CLAUDE.md

How to work in this repository. **What** the project is lives in `PRODUCT.md`;
**why** things are the way they are lives in the knowledge vault. This file is
only the working contract.

---

## 1. Start: read the vault

**Before anything else, read `llm-knowledge/index.md`.**

It is a short router. Its **Where things live** table maps each concept to the
files responsible for it, so you open the right file instead of searching the
tree. Follow the links that touch your task; each note carries the same pointers
in its `code:` frontmatter.

The vault exists because this project's hard parts are invisible in the code —
platform behaviour, rejected alternatives, constants found by measurement.
Skipping it means rediscovering something that already cost someone an evening.

Then open a session log (§2) before you start work.

---

## 2. Keep a session log, updated as you go

Every session keeps a log at:

```
llm-knowledge/sessions/YYYY-MM-DD-HHmm-<slug>.md
```

The `HHmm` matters — several sessions can happen in one day and they must not
collide. Use the time you started.

**Create it before your first real change, and append to it at the end of every
iteration** — each time you finish a unit of work, not once at the end. An
iteration is finished when a test goes green, a decision is made, a bug is
understood, or an attempt is abandoned.

Append, do not rewrite. The log is a running account, and a session that is
interrupted should still leave a usable one.

```markdown
## <time> — <what this iteration was>

**Did:** what changed, and where.
**Found:** anything surprising. Include the evidence, not just the conclusion.
**Failed:** what did not work, and why. This is the most valuable line — it is
the part nobody can reconstruct later.
**Next:** the immediate next step, so an interrupted session can resume.
```

This folder is gitignored scratch. Be rough and be honest, especially about
dead ends.

---

## 3. Work test-first. This is not optional.

**Every behavioural change starts with a failing test.**

### The loop

1. **RED** — write the smallest test that expresses the next behaviour. **Run
   it and watch it fail.**
2. **GREEN** — write the least code that passes. Not the elegant version. The
   passing one.
3. **REFACTOR** — clean it up with the test still green.
4. Log the iteration (§2) and repeat.

### Watching it fail is the part that gets skipped

A test you have never seen fail proves nothing. It may be asserting something
trivially true, may not be running at all, or may be passing for a reason that
has nothing to do with your change.

This is not hypothetical here. Three separate times in this repository's first
day, a green result meant less than it appeared to: a certificate chain that was
broken while `curl` silently repaired it, an edit that silently did not apply
while the suite stayed green, and a type-safety guard that was destroyed by an
unrelated fix without a single check turning red.

**So: when you add a guard, an assertion, or a CI rule, also prove it fails.**
Break the thing on purpose, watch the check catch it, put it back. A guard that
has never caught anything is a guess.

### What to test, and what not to

Test what is pure and what is easy to get wrong: logic, parsing, state
machines, validation, scoring, maths. These need no browser, no server and no
hardware, and they are where real bugs live.

Do not test rendering, animation, audio, or anything needing real hardware. Do
not write a test that only restates the implementation.

When something is hard to test, that is usually the design talking. Prefer
extracting the logic into a pure function over building test infrastructure
around an awkward shape.

### When you cannot test first

Spikes and genuine exploration are allowed. Say so in the session log, keep the
result labelled throwaway, and **write the test before the code becomes
permanent.** "I will add tests after" is how it never happens.

---

## 4. Debug by finding the cause, not the symptom

When something breaks: reproduce it, read the actual error, and instrument the
boundaries until you know *where* it fails. Only then form one hypothesis and
test it.

Do not stack fixes. If three attempts have failed, the model is wrong, not the
code — stop and say so.

**Never explain away a contradicting signal.** If two tools disagree, the
stricter one is usually describing reality. A tool reporting a failure you find
inconvenient is the most valuable output you will get that day.

---

## 5. Finish: promote what you learned

Before you are done, the session log gets harvested:

1. **Promote.** Anything that will **still be true in a month** becomes a note
   in `decisions/`, `platform/`, `reference/` or `experiments/`, linked from
   `llm-knowledge/index.md`.
2. **Point it at the code.** Give the note `code:` frontmatter naming the files
   the concept lives in, and add a row to **Where things live** for a new
   concept. If you moved or renamed a file, fix the pointers that named it —
   `npm run vault:check` fails on a stale one.

Step 1 is the one that matters. A vault where knowledge only accumulates in
dated logs is a diary, and nobody greps a diary.

### What belongs in the vault

**The test: would a future session spend more than a few minutes re-deriving
this?**

Write it down: platform behaviour found the hard way, constants discovered by
measurement, a decision and the alternatives rejected, why something surprising
is the way it is.

Leave it out: the folder structure, our own code's API, what a function does,
anything `grep` answers in a minute. That duplicates the repo and goes stale at
the next refactor. **A confidently wrong note is worse than a missing one.**

When a note stops being true, do not delete it — set `status: superseded` and
link its replacement.

Full rules in `llm-knowledge/README.md`, enforced by `npm run vault:check`.

---

## 6. Commands

```bash
npm run dev        # dev server, HTTPS when ./certs exists
npm run certs      # fetch LAN certificates; also diagnoses router DNS
npm run check      # lint + format
npm run format     # lint + format, writing fixes
npm run typecheck  # all three tsconfig projects
npm test           # vitest
npm run build      # production build
npm run vault:check
```

CI runs everything except `dev` and `certs` on every pull request. Run them
locally before pushing; do not use CI as your test runner.

---

## 7. Conventions

- **TypeScript, erasable syntax only.** The server runs under Node's native type
  stripping, so no `enum`, no namespaces, no parameter properties.
  `erasableSyntaxOnly` fails the typecheck rather than letting it fail at
  runtime.
- **Relative imports carry the `.ts` extension.**
- **Biome**, not ESLint or Prettier. One tool, one config.
- **Tests colocate** as `*.test.ts` beside the source. `tests/` holds only
  integration tests and fixtures.
- **Three tsconfig projects.** Two enforce architectural boundaries; the third
  typechecks tests and enforces nothing. They are not interchangeable — see
  `llm-knowledge/decisions/0002-host-authoritative-simulation.md` before
  changing any of them.
- **No new dependency** without a note in `llm-knowledge/decisions/` saying what
  it replaces and what was rejected.
- **Small files.** When one is doing several things, split it before adding a
  fourth.

---

## 8. Scope

Build what was asked. `PRODUCT.md` lists what v1 is not — do not build those,
and do not add abstractions in anticipation of them. No interface with one
implementation, no config for a value that never changes, no scaffolding for
later.

If you think something is out of scope or wrongly specified, say so in a
sentence and then deliver the full request anyway. Narrowing the work is the
user's call, not yours.

Report honestly. If tests fail, say so and show the output. If you skipped
something, say which part and why. Never describe work as done that you have
not verified — run the command and read the result.
