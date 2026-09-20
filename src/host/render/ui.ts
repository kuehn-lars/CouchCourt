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

function buildPanel(side: Side, align: "top" | "bottom"): Panel {
	const root = document.createElement("div");
	root.className = "score-panel";
	root.style.cssText = `
		position: fixed; left: 50%; transform: translateX(-50%);
		${align}: 20px;
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
}

export function createScoreUI(root: HTMLElement): ScoreUI {
	const near = buildPanel("near", "bottom");
	const far = buildPanel("far", "top");
	root.append(near.root, far.root);

	const panels: Readonly<Record<Side, Panel>> = { near, far };

	return {
		update(score) {
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
