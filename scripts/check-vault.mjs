#!/usr/bin/env node
/**
 * Guards llm-knowledge against its only real failure mode: silent rot.
 *
 * A knowledge vault does not break loudly. Notes get renamed, files move,
 * links dangle, dates stop being updated, and nobody notices for six months —
 * by which point an agent is reading the vault and confidently acting on
 * something untrue.
 *
 * Deliberately checks four things only. A linter nobody can satisfy gets
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
 * Backticked repo paths, from structured pointer surfaces only.
 *
 * Structured surfaces — `code:` frontmatter and table cells — are contracts
 * about what exists right now, so they are checked. Prose is narrative and may
 * legitimately name a file nobody has written yet ("scoring.ts will implement
 * this"), so it is exempt. Checking prose would make forward references
 * impossible and the check would get switched off.
 */
function pointerPaths(frontmatter, body) {
	const surfaces = [];

	const code = /^code:\s*\n((?:\s*-\s+.+\n?)+)/m.exec(frontmatter);
	if (code) surfaces.push(code[1]);

	// Markdown table rows.
	for (const line of body.split("\n")) {
		if (line.trimStart().startsWith("|")) surfaces.push(line);
	}

	const paths = new Set();
	for (const surface of surfaces) {
		for (const [, path] of surface.matchAll(/`([^`\n]+)`/g)) {
			if (CODE_ROOTS.test(path)) paths.add(path.replace(/\/$/, ""));
		}
	}
	return paths;
}

const files = markdownFiles(VAULT);
const noteNames = new Set(files.map((f) => basename(f, ".md")));
const problems = [];

for (const file of files) {
	const where = relative(ROOT, file);
	const text = readFileSync(file, "utf8");

	const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
	const frontmatter = match?.[1] ?? "";
	if (!match) {
		problems.push(`${where}: missing YAML frontmatter`);
	} else {
		const updated = /^updated:\s*(\S+)/m.exec(frontmatter);
		if (!updated) {
			problems.push(`${where}: frontmatter has no \`updated:\` date`);
		} else if (!/^\d{4}-\d{2}-\d{2}$/.test(updated[1])) {
			problems.push(
				`${where}: \`updated: ${updated[1]}\` is not an ISO date (YYYY-MM-DD)`,
			);
		}

		// A superseded note that does not say what replaced it is a dead end —
		// worse than no note, because it reads as current until you check the date.
		if (
			/^status:\s*superseded/m.test(frontmatter) &&
			!/\[\[[^\]]+\]\]/.test(text)
		) {
			problems.push(`${where}: marked superseded but links to no successor`);
		}
	}

	// Strip fenced and inline code first, or a note documenting the link syntax
	// cannot be written without failing the check that reads it.
	const prose = text.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");

	for (const [, target] of prose.matchAll(/\[\[([^\]]+)\]\]/g)) {
		// Obsidian accepts [[note]], [[note|alias]], [[note#heading]], [[dir/note]].
		const name = basename(target.split("|")[0].split("#")[0].trim());
		if (name && !noteNames.has(name)) {
			problems.push(`${where}: broken wikilink [[${target}]]`);
		}
	}

	// The whole point of a `code:` pointer is to save a future session the search.
	// A pointer to a file that moved costs more than no pointer at all.
	for (const path of pointerPaths(frontmatter, text)) {
		if (!existsSync(join(ROOT, path))) {
			problems.push(`${where}: \`${path}\` does not exist`);
		}
	}
}

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
	`Vault OK: ${files.length} notes, all links and code pointers resolve.`,
);
