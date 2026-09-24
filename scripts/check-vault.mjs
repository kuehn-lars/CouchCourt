#!/usr/bin/env node
/**
 * Guards llm-knowledge against its only real failure mode: silent rot.
 *
 * A knowledge vault does not break loudly. Notes get renamed, files move,
 * links dangle, dates stop being updated, and nobody notices for six months —
 * by which point an agent is reading the vault and confidently acting on
 * something untrue.
 *
 * Each rule below is deliberately narrow. A linter nobody can satisfy gets
 * disabled, and then it guards nothing.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VAULT = join(ROOT, "llm-knowledge");

/** Session logs are gitignored scratch, and .obsidian is per-user UI state. */
const SKIP = new Set([".obsidian", "sessions"]);

/** Top-level directories a `code:` pointer may reference. */
const CODE_ROOTS = /^(src|scripts|tests|\.github)\//;

/** The catalog every note must be reachable from. */
const ENTRY_NOTE = "index";

function markdownFiles(dir) {
	const found = [];
	for (const entry of readdirSync(dir)) {
		if (SKIP.has(entry)) continue;
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) found.push(...markdownFiles(path));
		else if (entry.endsWith(".md")) found.push(path);
	}
	return found;
}

/**
 * The only place that knows the frontmatter format. Returns null when a note
 * has no frontmatter block at all.
 */
function readFrontmatter(text) {
	const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
	if (!match) return null;
	const raw = match[1];
	return {
		updated: /^updated:\s*(\S+)/m.exec(raw)?.[1] ?? null,
		status: /^status:\s*(\S+)/m.exec(raw)?.[1] ?? null,
		code: /^code:\s*\n((?:[ \t]*-[ \t]+.+\n?)+)/m.exec(raw)?.[1] ?? "",
	};
}

/** Prose with fenced and inline code removed. */
const withoutCode = (text) =>
	text.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");

/**
 * Repo paths from structured pointer surfaces only: `code:` frontmatter and
 * table cells. Those are contracts about what exists right now.
 *
 * Prose is exempt on purpose, so a note may still name a file nobody has
 * written yet ("scoring.ts will implement this"). Checking prose would make
 * forward references impossible and the check would get switched off.
 */
function pointerPaths(note) {
	const tableRows = note.text
		.split("\n")
		.filter((line) => line.trimStart().startsWith("|"));

	const paths = new Set();
	for (const surface of [note.frontmatter?.code ?? "", ...tableRows]) {
		for (const [, path] of surface.matchAll(/`([^`\n]+)`/g)) {
			if (CODE_ROOTS.test(path)) paths.add(path.replace(/\/$/, ""));
		}
	}
	return paths;
}

// --- rules -----------------------------------------------------------------
// Each takes a note and returns the problems it found. Adding a rule means
// adding a function and listing it below, not editing a loop.

function frontmatterIsComplete({ frontmatter, text }) {
	if (!frontmatter) return ["missing YAML frontmatter"];

	const problems = [];
	if (!frontmatter.updated) {
		problems.push("frontmatter has no `updated:` date");
	} else if (!/^\d{4}-\d{2}-\d{2}$/.test(frontmatter.updated)) {
		problems.push(
			`\`updated: ${frontmatter.updated}\` is not an ISO date (YYYY-MM-DD)`,
		);
	}

	// A superseded note that does not say what replaced it is a dead end —
	// worse than no note, because it reads as current until you check the date.
	if (frontmatter.status === "superseded" && !/\[\[[^\]]+\]\]/.test(text)) {
		problems.push("marked superseded but links to no successor");
	}
	return problems;
}

/**
 * Note names a note links to. Obsidian accepts [[note]], [[note|alias]],
 * [[note#heading]] and [[dir/note]], so the name is the basename of the part
 * before any pipe or hash.
 */
function linkTargets(text) {
	const names = [];
	for (const [, target] of withoutCode(text).matchAll(/\[\[([^\]]+)\]\]/g)) {
		const name = basename(target.split("|")[0].split("#")[0].trim());
		if (name) names.push(name);
	}
	return names;
}

function wikilinksResolve(note, { noteNames }) {
	return linkTargets(note.text)
		.filter((name) => !noteNames.has(name))
		.map((name) => `broken wikilink [[${name}]]`);
}

function codePointersExist(note) {
	// The whole point of a pointer is to save a future session the search.
	// A pointer to a file that moved costs more than no pointer at all.
	return [...pointerPaths(note)]
		.filter((path) => !existsSync(join(ROOT, path)))
		.map((path) => `\`${path}\` does not exist`);
}

const RULES = [frontmatterIsComplete, wikilinksResolve, codePointersExist];

// --- vault-wide rules ------------------------------------------------------
// These are properties of the whole vault, not of one note, so they run once
// over every note rather than per-note like the rules above.

/**
 * A note nobody can reach is a note nobody reads. `index.md` is the catalog
 * every session starts from, so anything not reachable from it by following
 * wikilinks is invisible in practice however good it is.
 *
 * Reachability, not a direct link: a module page linked from `index.md` may
 * introduce the notes that only matter once you are there.
 */
function everyNoteIsReachable(notes) {
	const byName = new Map(notes.map((note) => [note.name, note]));
	const entry = byName.get(ENTRY_NOTE);
	if (!entry)
		return [`${ENTRY_NOTE}.md is missing — it is the vault's entry point`];

	const seen = new Set([ENTRY_NOTE]);
	const queue = [entry];
	while (queue.length > 0) {
		for (const name of linkTargets(queue.pop().text)) {
			if (seen.has(name)) continue;
			seen.add(name);
			const next = byName.get(name);
			if (next) queue.push(next);
		}
	}

	return notes
		.filter((note) => !seen.has(note.name))
		.map(
			(note) =>
				`${note.where}: unreachable from ${ENTRY_NOTE}.md — add a link to it`,
		);
}

/**
 * Every subsystem has a page describing what it is wired to. This is the
 * mechanical half of the vault's second rule: the vault must be able to
 * describe the system, not only justify it. A new `src/` folder with no
 * module page is how that decays back into a pile of notes.
 */
function everySourceDirHasAModule(notes) {
	const covered = notes
		.filter((note) => note.where.includes("llm-knowledge/modules/"))
		.flatMap((note) => [...pointerPaths(note)]);

	return readdirSync(join(ROOT, "src"))
		.filter((entry) => statSync(join(ROOT, "src", entry)).isDirectory())
		.filter((dir) => !covered.some((path) => path.startsWith(`src/${dir}`)))
		.map(
			(dir) =>
				`src/${dir}/ has no page in llm-knowledge/modules/ naming it in \`code:\``,
		);
}

const VAULT_RULES = [everyNoteIsReachable, everySourceDirHasAModule];

// --- run -------------------------------------------------------------------

const files = markdownFiles(VAULT);
const vault = { noteNames: new Set(files.map((f) => basename(f, ".md"))) };

const notes = files.map((file) => {
	const text = readFileSync(file, "utf8");
	return {
		// Forward slashes on every OS: rules match on `where`, and Windows'
		// `relative` returns backslashes.
		where: relative(ROOT, file).replaceAll("\\", "/"),
		name: basename(file, ".md"),
		text,
		frontmatter: readFrontmatter(text),
	};
});

const problems = [
	...notes.flatMap((note) =>
		RULES.flatMap((rule) =>
			rule(note, vault).map((problem) => `${note.where}: ${problem}`),
		),
	),
	...VAULT_RULES.flatMap((rule) => rule(notes)),
];

if (problems.length > 0) {
	console.error(`Vault check failed (${problems.length}):\n`);
	for (const problem of problems) console.error(`  - ${problem}`);
	console.error(
		"\nSee llm-knowledge/README.md for the note format.\n" +
			"Links and `code:` pointers must resolve. Either fix the target or drop\n" +
			"the reference — a pointer that lies is worse than no pointer.",
	);
	process.exit(1);
}

console.log(
	`Vault OK: ${notes.length} notes — links and code pointers resolve, ` +
		`every note is reachable from ${ENTRY_NOTE}.md, every src/ folder has a module page.`,
);
