/**
 * Everything on the host screen that is not the court: the join QR code, the
 * roster, the start buttons, the countdown and the final score.
 *
 * Plain DOM over the canvas, for the same reason the score overlay is
 * (`render/ui.ts`): crisp text at any resolution, and no reason to fight a
 * GPU for something the browser already does perfectly.
 *
 * `PRODUCT.md`'s bar for this screen is the only one that matters — a guest
 * who has never seen the game goes from scanning to swinging in under a
 * minute, with nobody explaining anything. So: the code is the biggest thing
 * on screen, the URL is under it in case the camera app fails, and there is
 * exactly one button.
 */

import qrcode from "qrcode-generator";
import type { LobbyPlayer, MatchPhase, Side } from "../../shared/protocol.ts";

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

const CSS = `
.lobby {
	position: fixed; inset: 0; pointer-events: auto;
	display: grid; place-content: center; gap: 28px;
	justify-items: center; text-align: center;
	background: radial-gradient(ellipse at 50% 40%, rgba(8,20,34,.82), rgba(4,10,18,.96));
	backdrop-filter: blur(6px);
	font-family: system-ui, -apple-system, sans-serif; color: #eef6fb;
}
/* A display rule beats the hidden attribute's UA style, so every hideable
   element in here needs this. Without it, setting .hidden silently does
   nothing -- which is exactly what it did the first time. */
.lobby[hidden], .lobby [hidden] { display: none !important; }
.lobby h1 { margin: 0; font-size: clamp(28px, 4vw, 52px); letter-spacing: -.02em; }
.lobby .lede { margin: -18px 0 0; opacity: .72; font-size: 17px; max-width: 34ch; }
.lobby .qr {
	background: #fff; padding: 14px; border-radius: 18px; line-height: 0;
	box-shadow: 0 24px 60px rgba(0,0,0,.5);
}
.lobby .qr svg { width: clamp(180px, 22vw, 260px); height: auto; display: block; }
.lobby .url { font: 14px/1.4 ui-monospace, monospace; opacity: .55; }
.lobby .slots { display: flex; gap: 16px; }
.lobby .slot {
	min-width: 190px; padding: 14px 18px; border-radius: 14px;
	border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.05);
	display: grid; gap: 4px;
}
.lobby .slot.filled { border-color: rgba(127,224,164,.5); }
.lobby .slot.ready { border-color: #7fe0a4; box-shadow: 0 0 0 1px #7fe0a4 inset; }
.lobby .slot .who { font-size: 18px; font-weight: 650; }
.lobby .slot .state { font-size: 13px; opacity: .65; text-transform: uppercase; letter-spacing: .08em; }
.lobby .actions { display: flex; gap: 12px; }
.lobby button {
	font: 600 17px/1 system-ui, sans-serif; padding: 15px 30px;
	border: 0; border-radius: 12px; background: #7fe0a4; color: #05140c;
	cursor: pointer;
}
.lobby button.ghost { background: rgba(255,255,255,.1); color: #eef6fb; }
.lobby button:disabled { opacity: .35; cursor: default; }
.lobby .count { font-size: clamp(90px, 16vw, 200px); font-weight: 700; line-height: 1; }
.lobby .hint { font-size: 13px; opacity: .45; }
`;

function slotEl(): {
	root: HTMLDivElement;
	who: HTMLDivElement;
	state: HTMLDivElement;
} {
	const root = document.createElement("div");
	root.className = "slot";
	const who = document.createElement("div");
	who.className = "who";
	const state = document.createElement("div");
	state.className = "state";
	root.append(who, state);
	return { root, who, state };
}

/** A QR of `url`, as an inline SVG. Error correction "M" and a quiet zone of
 * 2 modules: enough for a phone camera at arm's length across a living room,
 * and small enough that the code stays chunky rather than dense. */
function qrSvg(url: string): string {
	const qr = qrcode(0, "M");
	qr.addData(url);
	qr.make();
	return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
}

export function createLobbyUI(
	root: HTMLElement,
	handlers: LobbyHandlers,
): LobbyUI {
	const style = document.createElement("style");
	style.textContent = CSS;
	root.append(style);

	const panel = document.createElement("div");
	panel.className = "lobby";

	const title = document.createElement("h1");
	const lede = document.createElement("p");
	lede.className = "lede";

	const qrBox = document.createElement("div");
	qrBox.className = "qr";
	const urlText = document.createElement("div");
	urlText.className = "url";

	const slots = document.createElement("div");
	slots.className = "slots";
	const near = slotEl();
	const far = slotEl();
	slots.append(near.root, far.root);

	const count = document.createElement("div");
	count.className = "count";

	const actions = document.createElement("div");
	actions.className = "actions";
	const start = document.createElement("button");
	start.type = "button";
	const solo = document.createElement("button");
	solo.type = "button";
	solo.className = "ghost";
	solo.textContent = "Play the machine";
	actions.append(start, solo);

	const hint = document.createElement("div");
	hint.className = "hint";
	hint.textContent = "C changes camera · F fullscreen";

	panel.append(title, lede, qrBox, urlText, slots, count, actions, hint);
	root.append(panel);

	start.addEventListener("click", () => {
		if (start.dataset.action === "rematch") handlers.onRematch();
		else handlers.onStart(false);
	});
	solo.addEventListener("click", () => handlers.onStart(true));

	let renderedUrl = "";

	return {
		update(view) {
			// The panel is the pause screen too: a match with a dropped phone
			// is frozen, and the player who is coming back needs their side to
			// still be waiting for them when they do.
			const paused = view.phase === "playing" && view.waitingFor !== null;
			panel.hidden = view.phase === "playing" && !paused;
			if (panel.hidden) return;

			if (paused && view.waitingFor) {
				qrBox.hidden = true;
				urlText.hidden = true;
				slots.hidden = true;
				count.hidden = true;
				actions.hidden = true;
				hint.hidden = false;
				title.textContent = `Waiting for ${SIDE_LABEL[view.waitingFor]}`;
				lede.textContent =
					"Their phone dropped out. The match is paused — it resumes the moment they are back.";
				return;
			}

			if (view.joinUrl !== renderedUrl) {
				renderedUrl = view.joinUrl;
				qrBox.innerHTML = qrSvg(view.joinUrl);
				urlText.textContent = view.joinUrl;
			}

			const showJoin = view.phase === "lobby";
			qrBox.hidden = !showJoin;
			urlText.hidden = !showJoin;
			slots.hidden = !showJoin;
			count.hidden = view.phase !== "countdown";
			actions.hidden = view.phase === "countdown";
			hint.hidden = view.phase === "countdown";

			for (const side of ["near", "far"] as const) {
				const el = side === "near" ? near : far;
				const player = view.players.find((p) => p.side === side);
				const isBot = view.botSide === side;
				el.root.classList.toggle("filled", Boolean(player) || isBot);
				el.root.classList.toggle("ready", Boolean(player?.ready) || isBot);
				el.who.textContent = SIDE_LABEL[side];
				el.state.textContent = isBot
					? "The machine"
					: !player
						? "Waiting"
						: !player.connected
							? "Reconnecting"
							: player.ready
								? "Ready"
								: "Joining";
			}

			const ready = view.players.filter((p) => p.ready && p.connected);

			if (view.phase === "lobby") {
				title.textContent = "SwingCourt";
				lede.textContent =
					"Point a phone camera at the code. No app, no account — the phone is the racket.";
				start.dataset.action = "start";
				start.textContent =
					ready.length >= 2 ? "Start the match" : "Waiting for two players";
				start.disabled = ready.length < 2;
				solo.hidden = false;
				solo.disabled = ready.length < 1;
				solo.textContent =
					ready.length < 1 ? "Join to play solo" : "Play the machine";
				return;
			}

			if (view.phase === "countdown") {
				title.textContent = "Get ready";
				lede.textContent = "First to six games.";
				count.textContent = String(Math.max(1, view.countdown));
				return;
			}

			// over
			title.textContent = view.winner
				? `${SIDE_LABEL[view.winner]} wins`
				: "Match over";
			// Winner's games first, the way a result is always written.
			lede.textContent = view.winner
				? `${view.games[view.winner]} – ${view.games[view.winner === "near" ? "far" : "near"]}`
				: "";
			start.dataset.action = "rematch";
			start.textContent = "Back to the lobby";
			start.disabled = false;
			solo.hidden = true;
		},
	};
}
