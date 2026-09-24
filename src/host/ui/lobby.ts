/**
 * Everything on the host screen that is not the court or the score: the
 * title screen with the join code and the two seats, the how-to-play
 * slides, the countdown, the word that starts a match, the pause while a
 * phone is away, and the result.
 *
 * Plain DOM over the canvas, for the same reason the score overlay is
 * (`render/ui.ts`): crisp text at any resolution, and no reason to fight a
 * GPU for something the browser already does perfectly. Styles live in
 * `host.css`; this file only builds nodes and flips classes.
 *
 * The bar for this screen is the only one that matters — a guest
 * who has never seen the game goes from scanning to swinging in under a
 * minute, with nobody explaining anything. So the code is the biggest thing
 * in the panel, the URL is under it in case the camera app fails, and the
 * slides teach the four things there are to know while people gather.
 *
 * `update` runs every frame. Everything in it writes only on change.
 */

import qrcode from "qrcode-generator";
import type { LobbyPlayer, MatchPhase, Side } from "../../shared/protocol.ts";
import { el, play, setText } from "./dom.ts";
import { ICON, type IconName, icon } from "./icons.ts";

export interface LobbyView {
	readonly phase: MatchPhase;
	readonly players: readonly LobbyPlayer[];
	/** Whole seconds left, only read in `countdown`. */
	readonly countdown: number;
	/** Only read in `over`. */
	readonly winner: Side | null;
	/** Games won, for the final line. Only read in `over`. */
	readonly games: Readonly<Record<Side, number>>;
	/** Set in solo play, so the roster can show who the bot is. */
	readonly botSide: Side | null;
	/** A side whose phone has dropped mid-match. The simulation is frozen
	 * while this is set. */
	readonly waitingFor: Side | null;
	readonly joinUrl: string;
}

export interface LobbyHandlers {
	onStart(solo: boolean): void;
	onRematch(): void;
}

export interface LobbyUI {
	update(view: LobbyView): void;
}

const SIDE_LABEL: Readonly<Record<Side, string>> = {
	near: "Near side",
	far: "Far side",
};

type SeatState = "empty" | "joining" | "ready" | "away" | "bot";

const SEAT: Readonly<Record<SeatState, { status: string; glyph: IconName }>> = {
	empty: { status: "Scan the code to take this end", glyph: "deviceMobile" },
	joining: { status: "Phone connected", glyph: "deviceMobile" },
	ready: { status: "Racket ready", glyph: "check" },
	away: { status: "Reconnecting", glyph: "wifiSlash" },
	bot: { status: "The machine plays this end", glyph: "robot" },
};

const TIPS: readonly { glyph: IconName; title: string; body: string }[] = [
	{
		glyph: "qrCode",
		title: "Scan the code",
		body: "Open the camera on an iPhone and point it at the code.",
	},
	{
		glyph: "handGrabbing",
		title: "Hold it like a handle",
		body: "Top edge up the racket, and swing from the shoulder.",
	},
	{
		glyph: "arrowsLeftRight",
		title: "Forehand left, backhand right",
		body: "The stroke picks the side. Timing decides how well.",
	},
	{
		glyph: "tennisBall",
		title: "Serve with a toss",
		body: "Swing once to throw the ball up, then again to hit it.",
	},
];
const TIP_MS = 6000;

/** A QR of `url`, as an inline SVG. Error correction "M" and a quiet zone of
 * 2 modules: enough for a phone camera at arm's length across a living room,
 * and small enough that the code stays chunky rather than dense. */
function qrSvg(url: string): string {
	const qr = qrcode(0, "M");
	qr.addData(url);
	qr.make();
	return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
}

interface Seat {
	readonly root: HTMLLIElement;
	readonly avatar: HTMLSpanElement;
	readonly status: HTMLSpanElement;
	state: SeatState | null;
}

function buildSeat(side: Side): Seat {
	const avatar = el("span", "seat-avatar");
	const status = el("span", "seat-status");
	const tag = el("span", "seat-tag", icon("check"), "Ready");
	const root = el(
		"li",
		"seat",
		avatar,
		el("div", "", el("div", "seat-name", SIDE_LABEL[side]), status),
		tag,
	);
	root.dataset.side = side;
	return { root, avatar, status, state: null };
}

function seatState(player: LobbyPlayer | undefined, isBot: boolean): SeatState {
	if (isBot) return "bot";
	if (!player) return "empty";
	if (!player.connected) return "away";
	return player.ready ? "ready" : "joining";
}

/** A spring pop, for anything that just changed state. */
const pop = (node: Element, delay = 0) =>
	play(
		node,
		[
			{ transform: "scale(.55)", opacity: 0 },
			{ transform: "scale(1.08)", opacity: 1, offset: 0.55 },
			{ transform: "scale(1)", opacity: 1 },
		],
		{ duration: 620, delay, fill: "backwards" },
	);

/** Rise into place, for staggered entrances. */
const rise = (node: Element, delay: number, distance = "1.4rem") =>
	play(
		node,
		[
			{ transform: `translateY(${distance})`, opacity: 0, filter: "blur(6px)" },
			{ transform: "none", opacity: 1, filter: "blur(0)" },
		],
		{ duration: 900, delay, fill: "backwards" },
	);

export function createLobbyUI(
	root: HTMLElement,
	handlers: LobbyHandlers,
): LobbyUI {
	// ------------------------------------------------------------ lobby
	const headline = el(
		"h1",
		"headline",
		"Your phone is the ",
		el("span", "hl", "racket."),
	);
	const lede = el(
		"p",
		"lede",
		"Point an iPhone camera at the code. No app, no account, nothing to type.",
	);

	const qrBox = el("div", "qr");
	const urlText = el("figcaption", "url");
	const qrCard = el("figure", "qr-card", qrBox, urlText);

	const seats: Readonly<Record<Side, Seat>> = {
		near: buildSeat("near"),
		far: buildSeat("far"),
	};
	const roster = el("ol", "roster", seats.near.root, seats.far.root);
	roster.setAttribute("aria-label", "Players");
	const joinRow = el("div", "join-row", qrCard, roster);

	const start = el("button", "btn btn-primary", "Start match");
	start.type = "button";
	const solo = el("button", "btn btn-ghost", icon("robot"), "Play the machine");
	solo.type = "button";
	const startNote = el("p", "note-inline");
	const actions = el("div", "actions", start, solo, startNote);

	const join = el("section", "join", headline, lede, joinRow, actions);
	const brand = el("header", "brand", icon("logo"), "CouchCourt");

	const key = (k: string, label: string) =>
		el("span", "", el("kbd", "", k), label);
	const keys = el(
		"footer",
		"keys",
		key("C", "Camera"),
		key("F", "Full screen"),
		key("S", "Settings"),
	);

	// The slides: progress segments on top, one tip showing at a time.
	const segments = TIPS.map(() => el("i"));
	const slides = TIPS.map((tip) =>
		el(
			"div",
			"tip",
			icon(tip.glyph),
			el("b", "", tip.title),
			el("span", "", tip.body),
		),
	);
	const tips = el(
		"aside",
		"tips",
		el("div", "tips-progress", ...segments),
		el("div", "tips-stage", ...slides),
	);
	tips.style.setProperty("--tip-ms", `${TIP_MS}ms`);
	tips.setAttribute("aria-label", "How to play");

	const lobby = el("div", "layer lobby", brand, join, tips, keys);

	// -------------------------------------------------------- countdown
	const countNum = el("span", "count-num");
	const countdown = el(
		"div",
		"layer countdown",
		countNum,
		el("p", "count-sub", "First to six games"),
	);
	countdown.setAttribute("aria-live", "assertive");

	const go = el("div", "layer go", "Play");

	// ------------------------------------------------------------ pause
	const pauseTitle = el("h2");
	const pauseCard = el(
		"div",
		"pause-card",
		icon("wifiSlash"),
		pauseTitle,
		el("p", "", "Their phone dropped out. Play resumes the moment it is back."),
	);
	const pause = el("div", "layer pause", pauseCard);

	// ----------------------------------------------------------- result
	const trophy = icon("trophy");
	const resultTitle = el("h2");
	const winGames = el("span", "win");
	const loseGames = el("span", "lose");
	const final = el("p", "final", winGames, el("span", "sep"), loseGames);
	const resultLine = el("p", "", "Game, set and match.");
	const again = el("button", "btn btn-primary", "Back to the lobby");
	again.type = "button";
	const resultCard = el(
		"div",
		"result-card",
		trophy,
		resultTitle,
		final,
		resultLine,
		again,
	);
	const result = el("div", "layer result", resultCard);

	root.append(lobby, countdown, go, pause, result);

	start.addEventListener("click", () => handlers.onStart(false));
	solo.addEventListener("click", () => handlers.onStart(true));
	again.addEventListener("click", () => handlers.onRematch());

	// ------------------------------------------------------- the slides
	let tip = -1;
	let tipTimer = 0;
	function showTip(next: number): void {
		tip = next % TIPS.length;
		slides.forEach((s, i) => {
			s.classList.toggle("on", i === tip);
		});
		segments.forEach((s, i) => {
			s.classList.toggle("done", i < tip);
			s.classList.remove("active");
		});
		// Restart the fill: a class removed and re-added in one frame is the
		// same class to the style engine.
		const active = segments[tip];
		if (active) {
			void active.offsetWidth;
			active.classList.add("active");
		}
		window.clearTimeout(tipTimer);
		tipTimer = window.setTimeout(() => showTip(tip + 1), TIP_MS);
	}

	function enterLobby(): void {
		showTip(0);
		[brand, headline, lede, joinRow, actions].forEach((node, i) => {
			rise(node, 120 + i * 90);
		});
		rise(tips, 700, "2rem");
		rise(keys, 800, "0.5rem");
	}

	function enterResult(view: LobbyView): void {
		pop(trophy, 150);
		rise(resultTitle, 280);
		[winGames, loseGames].forEach((node, i) => {
			play(
				node,
				[
					{ transform: "translateY(40%) scale(.9)", opacity: 0 },
					{ transform: "none", opacity: 1 },
				],
				{ duration: 900, delay: 420 + i * 120, fill: "backwards" },
			);
		});
		rise(resultLine, 700);
		rise(again, 820);
		// Winner's games first, the way a result is always written.
		if (view.winner) {
			winGames.textContent = String(view.games[view.winner]);
			loseGames.textContent = String(
				view.games[view.winner === "near" ? "far" : "near"],
			);
		}
	}

	let renderedUrl = "";
	let lastPhase: MatchPhase | null = null;
	let lastCount = 0;
	let lastLayer: HTMLElement | null = null;

	return {
		update(view) {
			const paused = view.phase === "playing" && view.waitingFor !== null;
			const layer =
				view.phase === "lobby"
					? lobby
					: view.phase === "countdown"
						? countdown
						: view.phase === "over"
							? result
							: paused
								? pause
								: null;

			if (view.phase !== lastPhase) {
				document.body.dataset.phase = view.phase;
				if (view.phase === "lobby") enterLobby();
				else window.clearTimeout(tipTimer);
				if (view.phase === "over") enterResult(view);
				if (view.phase === "playing" && lastPhase === "countdown") {
					go.classList.add("on");
					play(
						go,
						[
							{ transform: "scale(.6)", filter: "blur(20px)" },
							{ transform: "scale(1.04)", filter: "blur(0)", offset: 0.4 },
							{ transform: "scale(1.15)", filter: "blur(8px)", opacity: 0 },
						],
						{ duration: 1100 },
					);
					window.setTimeout(() => go.classList.remove("on"), 700);
				}
				lastPhase = view.phase;
			}

			if (layer !== lastLayer) {
				lastLayer?.classList.remove("on");
				layer?.classList.add("on");
				lastLayer = layer;
			}

			if (paused && view.waitingFor) {
				setText(pauseTitle, `Waiting for ${SIDE_LABEL[view.waitingFor]}`);
				pauseCard.style.setProperty("--side", `var(--${view.waitingFor})`);
				return;
			}

			if (view.phase === "countdown") {
				const n = Math.max(1, view.countdown);
				if (n !== lastCount) {
					lastCount = n;
					countNum.textContent = String(n);
					play(
						countNum,
						[
							{ transform: "scale(1.6)", opacity: 0, filter: "blur(28px)" },
							{
								transform: "scale(1)",
								opacity: 1,
								filter: "blur(0)",
								offset: 0.45,
							},
							{ transform: "scale(.9)", opacity: 0, filter: "blur(6px)" },
						],
						{ duration: 1000 },
					);
				}
				return;
			}
			lastCount = 0;

			if (view.phase === "over") {
				const side = view.winner;
				result.style.setProperty(
					"--side",
					side ? `var(--${side})` : "var(--accent)",
				);
				// The winner's name in their colour; only rebuilt on change.
				const who = !side
					? null
					: side === view.botSide
						? "The machine"
						: view.botSide
							? "You"
							: SIDE_LABEL[side];
				const text =
					who === null
						? "Match over"
						: `${who} ${who === "You" ? "win" : "wins"}`;
				if (resultTitle.textContent !== text) {
					resultTitle.replaceChildren(
						...(who === null
							? [text]
							: [el("span", "winner", who), text.slice(who.length)]),
					);
				}
				return;
			}

			if (view.phase !== "lobby") return;

			if (view.joinUrl !== renderedUrl) {
				renderedUrl = view.joinUrl;
				qrBox.innerHTML = qrSvg(view.joinUrl);
				urlText.textContent = view.joinUrl.replace(/^https?:\/\//, "");
			}

			for (const side of ["near", "far"] as const) {
				const seat = seats[side];
				const state = seatState(
					view.players.find((p) => p.side === side),
					view.botSide === side,
				);
				if (state === seat.state) continue;
				const first = seat.state === null;
				seat.state = state;
				seat.root.dataset.state = state;
				seat.status.textContent = SEAT[state].status;
				seat.avatar.innerHTML = ICON[SEAT[state].glyph];
				if (!first) pop(seat.avatar);
			}

			const ready = view.players.filter((p) => p.ready && p.connected).length;
			start.disabled = ready < 2;
			solo.disabled = ready < 1;
			setText(
				startNote,
				ready === 0
					? "One phone plays the machine. Two play each other."
					: ready === 1
						? "One more phone for a match, or play the machine now."
						: "Both rackets are ready.",
			);
		},
	};
}
