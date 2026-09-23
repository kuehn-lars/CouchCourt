/**
 * The score overlay: a broadcast scorebug in the top-left corner, the
 * umpire's call above the net, and a one-line note at the bottom. Plain DOM
 * over the canvas, not a Three.js scene — crisp text at any resolution costs
 * nothing this way. Styles are in `host.css`.
 *
 * The corner, not the centre: panels once sat centred at the top and bottom
 * edges, which put the near player's head behind the bottom one for the
 * whole match — the players stand on the centre line, which is exactly where
 * the middle of the screen is.
 */

import type { Side } from "../../shared/protocol.ts";
import type { Score } from "../../shared/sim/scoring.ts";
import { el, play, setText } from "../ui/dom.ts";
import { icon } from "../ui/icons.ts";

const SIDE_LABEL: Readonly<Record<Side, string>> = { near: "Near", far: "Far" };

interface Row {
	readonly games: HTMLSpanElement;
	readonly points: HTMLSpanElement;
	readonly serve: HTMLSpanElement;
}

function buildRow(side: Side): { root: HTMLDivElement; row: Row } {
	const games = el("span", "bug-games");
	const points = el("span", "bug-points");
	const serve = el("span", "bug-serve", icon("tennisBall"));
	const root = el(
		"div",
		"bug-row",
		el("span", "bug-bar"),
		el("span", "bug-name", SIDE_LABEL[side]),
		serve,
		games,
		points,
	);
	root.dataset.side = side;
	return { root, row: { games, points, serve } };
}

/** A number rolling up into place, the way a broadcast graphic changes. */
function roll(node: HTMLElement, text: string): void {
	if (!setText(node, text)) return;
	play(
		node,
		[
			{ transform: "translateY(70%)", opacity: 0 },
			{ transform: "none", opacity: 1 },
		],
		{ duration: 480 },
	);
}

export interface ScoreUI {
	update(score: Score): void;
	/** Shown in a match, hidden over the lobby's rally. Hiding also forgets
	 * the last score, so the next match's first score is not "called" as a
	 * change from the last match's final one. */
	setVisible(visible: boolean): void;
	/** A brief line at the bottom of the screen — what the camera just
	 * changed to, and nothing weightier. */
	note(text: string): void;
}

/**
 * The call, as an umpire would say it, or `null` when nothing worth
 * announcing happened. Pure, and the only place the score is turned into
 * words.
 *
 * Reference inequality is what "the score changed" means everywhere in this
 * codebase (`awardPoint` always returns a new object), so this is a diff of
 * two consecutive `Score` values and nothing more.
 */
export function callFor(before: Score, after: Score): string | null {
	if (before === after) return null;
	if (after.setWinner) return `Set, ${SIDE_LABEL[after.setWinner]}`;
	for (const side of ["near", "far"] as const) {
		if (after.games[side] !== before.games[side]) {
			return `Game, ${SIDE_LABEL[side]}`;
		}
	}
	if (after.tiebreak) {
		return `${after.tiebreak.points.near}-${after.tiebreak.points.far}`;
	}
	const near = after.points.near;
	const far = after.points.far;
	if (near === "AD") return `Advantage ${SIDE_LABEL.near}`;
	if (far === "AD") return `Advantage ${SIDE_LABEL.far}`;
	if (near === 40 && far === 40) return "Deuce";
	if (near === far) return `${near} all`;
	return `${near}-${far}`;
}

/** How long a call stays on screen, seconds. */
const CALL_SECONDS = 1.8;

export function createScoreUI(root: HTMLElement): ScoreUI {
	const near = buildRow("near");
	const far = buildRow("far");
	const tiebreak = el("div", "bug-tb", "Tiebreak");
	tiebreak.hidden = true;
	const bug = el("div", "bug", near.root, far.root, tiebreak);
	bug.setAttribute("role", "status");
	bug.setAttribute("aria-label", "Score");

	// The call, centred and high — above the net, below the far player, so it
	// never sits on top of either player or the ball's usual path.
	const callText = el("span", "call-text");
	const call = el("div", "call", callText, el("span", "call-rule"));
	call.setAttribute("aria-live", "polite");

	const note = el("div", "note");
	root.append(bug, call, note);

	const rows: Readonly<Record<Side, Row>> = { near: near.row, far: far.row };
	let lastScore: Score | null = null;
	let hideAt = 0;
	let noteTimer = 0;
	let visible = false;

	return {
		note(text) {
			note.textContent = text;
			note.classList.add("on");
			window.clearTimeout(noteTimer);
			noteTimer = window.setTimeout(() => note.classList.remove("on"), 1600);
		},

		setVisible(on) {
			if (on === visible) return;
			visible = on;
			bug.classList.toggle("on", on);
			if (!on) {
				lastScore = null;
				call.classList.remove("on");
			}
		},

		update(score) {
			if (score === lastScore) {
				if (hideAt !== 0 && performance.now() > hideAt) {
					call.classList.remove("on");
					hideAt = 0;
				}
				return;
			}
			if (lastScore !== null) {
				const text = callFor(lastScore, score);
				if (text !== null) {
					callText.textContent = text;
					// Restart the wipe for a call that follows another.
					call.classList.remove("on");
					void call.offsetWidth;
					call.classList.add("on");
					hideAt = performance.now() + CALL_SECONDS * 1000;
				}
			}
			lastScore = score;

			tiebreak.hidden = !score.tiebreak;
			for (const side of ["near", "far"] as const) {
				const row = rows[side];
				roll(row.games, String(score.games[side]));
				roll(
					row.points,
					score.tiebreak
						? String(score.tiebreak.points[side])
						: String(score.points[side]),
				);
				row.serve.classList.toggle("on", score.server === side);
			}
		},
	};
}
