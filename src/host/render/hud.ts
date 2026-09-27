/**
 * The arcade HUD over the match: the rally counter on the right, climbing
 * through four colours as the rally grows, and the callout that slams into
 * the middle of the screen — ACE!, WINNER!, ON FIRE!, a record. What to say
 * is decided in `arcade.ts`; this only shows it. Styles in
 * `styles/arcade.css`.
 */

import { type Callout, RALLY_MILESTONE, TONE } from "../arcade.ts";
import { el, play, setText } from "../ui/dom.ts";

/** Strokes before the counter shows at all: every point has one or two. */
const SHOW_FROM = 3;
/** How long one callout holds the middle of the screen, ms. */
const CALLOUT_MS = 1150;

export interface Hud {
	setVisible(visible: boolean): void;
	rally(count: number): void;
	callout(callout: Callout): void;
	/** Once a frame: moves the callout queue along. */
	update(now: number): void;
}

export function createHud(root: HTMLElement): Hud {
	const count = el("span", "combo-num");
	const fill = el("i");
	const combo = el(
		"div",
		"combo",
		count,
		el("span", "combo-label", "Rally"),
		el("span", "combo-bar", fill),
	);
	combo.setAttribute("aria-hidden", "true");

	const shoutText = el("span", "shout-text");
	const shout = el("div", "shout", shoutText);
	shout.setAttribute("aria-live", "polite");
	root.append(combo, shout);

	const queue: Callout[] = [];
	let showingUntil = 0;
	let shown = 0;
	let visible = false;

	function show(c: Callout): void {
		setText(shoutText, c.text);
		shout.dataset.tone = TONE[c.kind];
		// A record reads as a sentence; a word is shouted.
		shout.dataset.long = String(c.text.length > 9);
		shout.style.setProperty(
			"--who",
			c.side ? `var(--${c.side})` : "var(--accent)",
		);
		shout.classList.remove("on");
		void shout.offsetWidth;
		shout.classList.add("on");
	}

	return {
		setVisible(on) {
			if (on === visible) return;
			visible = on;
			if (!on) {
				queue.length = 0;
				shout.classList.remove("on");
				combo.classList.remove("on");
				shown = 0;
			}
		},

		rally(n) {
			if (n === shown) return;
			const grew = n > shown;
			shown = n;
			combo.classList.toggle("on", n >= SHOW_FROM);
			if (n < SHOW_FROM) return;
			setText(count, String(n));
			combo.dataset.heat = String(Math.min(3, Math.floor(n / RALLY_MILESTONE)));
			fill.style.transform = `scaleX(${(n % RALLY_MILESTONE) / RALLY_MILESTONE})`;
			if (grew) {
				play(
					count,
					[{ transform: "scale(1.45) rotate(-4deg)" }, { transform: "none" }],
					{ duration: 380, easing: "cubic-bezier(.2,1.6,.4,1)" },
				);
			}
		},

		callout(c) {
			if (!visible) return;
			// A backlog of stale news is worse than dropping some.
			if (queue.length >= 3) queue.shift();
			queue.push(c);
		},

		update(now) {
			if (now < showingUntil) return;
			const next = queue.shift();
			if (next) {
				show(next);
				showingUntil = now + CALLOUT_MS;
			} else if (showingUntil !== 0) {
				shout.classList.remove("on");
				showingUntil = 0;
			}
		},
	};
}
