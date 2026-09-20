/**
 * The score overlay. Plain DOM over the canvas, not a Three.js scene — crisp
 * text at any resolution costs nothing this way, and there is no reason to
 * fight a GPU for something a browser already renders perfectly.
 */

import type { Side } from "../../shared/protocol.ts";
import type { Score } from "../../shared/sim/scoring.ts";

const SIDE_LABEL: Readonly<Record<Side, string>> = { near: "Near", far: "Far" };
const SIDE_COLOR: Readonly<Record<Side, string>> = {
	near: "#ff5d73",
	far: "#ffd166",
};

interface Panel {
	readonly root: HTMLDivElement;
	readonly games: HTMLDivElement;
	readonly points: HTMLDivElement;
	readonly dot: HTMLDivElement;
}

/**
 * Corners, not the centre. The panels used to sit centred at the top and
 * bottom edges, which put the near player's head behind the bottom one for
 * the whole match — the players stand on the centre line, which is exactly
 * where the middle of the screen is.
 */
function buildPanel(side: Side, align: "left" | "right"): Panel {
	const root = document.createElement("div");
	root.className = "score-panel";
	root.style.cssText = `
		position: fixed; top: 20px; ${align}: 20px;
		display: flex; align-items: center; gap: 12px;
		padding: 10px 20px; border-radius: 16px;
		background: rgba(10, 20, 30, 0.55);
		backdrop-filter: blur(10px);
		border: 1px solid rgba(255,255,255,0.12);
		font-family: system-ui, sans-serif; color: #f4f8fb;
		box-shadow: 0 8px 24px rgba(0,0,0,0.35);
	`;

	const dot = document.createElement("div");
	dot.style.cssText = `
		width: 10px; height: 10px; border-radius: 50%;
		background: ${SIDE_COLOR[side]};
		box-shadow: 0 0 8px ${SIDE_COLOR[side]};
		opacity: 0; transition: opacity 150ms ease;
	`;

	const label = document.createElement("div");
	label.textContent = SIDE_LABEL[side];
	label.style.cssText =
		"font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.7;";

	const games = document.createElement("div");
	games.style.cssText = "font-size: 28px; font-weight: 700; min-width: 1.2em;";

	const points = document.createElement("div");
	points.style.cssText = "font-size: 16px; opacity: 0.85; min-width: 2em;";

	root.append(dot, label, games, points);
	return { root, games, points, dot };
}

export interface ScoreUI {
	update(score: Score): void;
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
	if (after.setWinner) return `Set — ${SIDE_LABEL[after.setWinner]}`;
	for (const side of ["near", "far"] as const) {
		if (after.games[side] !== before.games[side]) {
			return `Game — ${SIDE_LABEL[side]}`;
		}
	}
	if (after.tiebreak) {
		return `${after.tiebreak.points.near} – ${after.tiebreak.points.far}`;
	}
	const near = after.points.near;
	const far = after.points.far;
	if (near === "AD") return `Advantage ${SIDE_LABEL.near}`;
	if (far === "AD") return `Advantage ${SIDE_LABEL.far}`;
	if (near === 40 && far === 40) return "Deuce";
	if (near === far) return `${near} all`;
	return `${near} – ${far}`;
}

/** How long a call stays on screen, seconds. */
const CALL_SECONDS = 1.8;

export function createScoreUI(root: HTMLElement): ScoreUI {
	const near = buildPanel("near", "left");
	const far = buildPanel("far", "right");
	root.append(near.root, far.root);

	// The call, centred and high — above the net, below the far player, so it
	// never sits on top of either player or the ball's usual path.
	const call = document.createElement("div");
	call.style.cssText = `
		position: fixed; top: 16%; left: 50%; transform: translateX(-50%);
		font: 700 clamp(28px, 4vw, 56px)/1.1 system-ui, sans-serif;
		color: #f4f8fb; letter-spacing: -.01em; white-space: nowrap;
		text-shadow: 0 6px 30px rgba(0,0,0,.75);
		opacity: 0; transition: opacity 260ms ease;
	`;
	root.append(call);

	const toast = document.createElement("div");
	toast.style.cssText = `
		position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
		font: 500 15px/1 system-ui, sans-serif; color: #eef6fb;
		padding: 10px 18px; border-radius: 999px;
		background: rgba(10, 20, 30, 0.6); backdrop-filter: blur(8px);
		border: 1px solid rgba(255,255,255,0.12);
		opacity: 0; transition: opacity 200ms ease;
	`;
	root.append(toast);
	let toastTimer: ReturnType<typeof setTimeout> | undefined;

	const panels: Readonly<Record<Side, Panel>> = { near, far };
	let lastScore: Score | null = null;
	let hideAt = 0;

	return {
		note(text) {
			toast.textContent = text;
			toast.style.opacity = "1";
			clearTimeout(toastTimer);
			toastTimer = setTimeout(() => {
				toast.style.opacity = "0";
			}, 1600);
		},

		update(score) {
			if (lastScore !== null) {
				const text = callFor(lastScore, score);
				if (text !== null) {
					call.textContent = text;
					call.style.opacity = "1";
					hideAt = performance.now() + CALL_SECONDS * 1000;
				} else if (hideAt !== 0 && performance.now() > hideAt) {
					call.style.opacity = "0";
					hideAt = 0;
				}
			}
			lastScore = score;

			for (const side of ["near", "far"] as const) {
				const panel = panels[side];
				panel.games.textContent = String(score.games[side]);
				panel.points.textContent = score.tiebreak
					? String(score.tiebreak.points[side])
					: String(score.points[side]);
				panel.dot.style.opacity = score.server === side ? "1" : "0";
			}
		},
	};
}
