# Session logs

One log per Claude Code session:

```
YYYY-MM-DD-HHmm-<slug>.md
```

The `HHmm` is the start time and it is not optional — several sessions can
happen in one day and they must not collide.

**Gitignored on purpose.** These are local scratch. They are not committed, not
reviewed, and nobody will read them in six months.

## Written as you go, not at the end

Create the log before the first real change, then **append at the end of every
iteration** — each time a test goes green, a decision is made, a bug is
understood, or an attempt is abandoned. Append, never rewrite.

A session that gets interrupted should still leave a usable account behind.
That only works if the log was being written the whole time.

## Their job is to be an inbox

The log is raw material. At the end of the session everything in it that will
still be true in a month gets **promoted** into `decisions/`, `platform/`,
`reference/` or `experiments/` and linked from `index.md`. The promoted note is
the deliverable.

A log that never gets promoted out of was a session that learned nothing
durable — a perfectly normal outcome. Just do not mistake the log for the
knowledge.

## Record the failures

The most valuable line in any of these is what did **not** work and why. What
worked is visible in the diff. What you tried, ruled out, and abandoned is not,
and it is the part nobody can reconstruct later.

See `../README.md` for what belongs in the vault at all.
