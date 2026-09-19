#!/usr/bin/env node
/**
 * Guards llm-knowledge against its only real failure mode: silent rot.
 *
 * A knowledge vault does not break loudly. Notes get renamed, links dangle,
 * dates stop being updated, and nobody notices for six months — by which point
 * an agent is reading the vault and confidently acting on something untrue.
 *
 * Deliberately checks two things only. A linter nobody can satisfy gets
 * disabled, and then it guards nothing.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VAULT = join(ROOT, "llm-knowledge");

/** Session logs are gitignored scratch, and .obsidian is per-user UI state. */
const SKIP = new Set([".obsidian", "sessions"]);

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

const files = markdownFiles(VAULT);
const noteNames = new Set(files.map((f) => basename(f, ".md")));
const problems = [];

for (const file of files) {
	const where = relative(ROOT, file);
	const text = readFileSync(file, "utf8");

	const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
	if (!frontmatter) {
		problems.push(`${where}: missing YAML frontmatter`);
	} else {
		const body = frontmatter[1];
		const updated = /^updated:\s*(\S+)/m.exec(body);
		if (!updated) {
			problems.push(`${where}: frontmatter has no \`updated:\` date`);
		} else if (!/^\d{4}-\d{2}-\d{2}$/.test(updated[1])) {
			problems.push(
				`${where}: \`updated: ${updated[1]}\` is not an ISO date (YYYY-MM-DD)`,
			);
		}

		// A superseded note that does not say what replaced it is a dead end —
		// worse than no note, because it reads as current until you check the date.
		if (/^status:\s*superseded/m.test(body) && !/\[\[[^\]]+\]\]/.test(text)) {
			problems.push(`${where}: marked superseded but links to no successor`);
		}
	}

	// Strip fenced code and inline code first, or a note documenting the link
	// syntax cannot be written without failing the check that reads it.
	const prose = text.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");

	for (const [, target] of prose.matchAll(/\[\[([^\]]+)\]\]/g)) {
		// Obsidian accepts [[note]], [[note|alias]], [[note#heading]], [[dir/note]].
		const name = basename(target.split("|")[0].split("#")[0].trim());
		if (name && !noteNames.has(name)) {
			problems.push(`${where}: broken wikilink [[${target}]]`);
		}
	}
}

if (problems.length > 0) {
	console.error(`Vault check failed (${problems.length}):\n`);
	for (const problem of problems) console.error(`  - ${problem}`);
	console.error(
		"\nSee llm-knowledge/README.md for the note format.\n" +
			"A link to a note that does not exist yet is not allowed here — either\n" +
			"write the note or drop the link.",
	);
	process.exit(1);
}

console.log(`Vault OK: ${files.length} notes, all links resolve.`);
