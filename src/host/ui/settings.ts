/**
 * The host's settings sheet and the two round buttons that stay in the
 * corner: settings and full screen. A native `<dialog>` so Escape, focus
 * trapping and the backdrop come from the browser.
 *
 * Settings stay on this Mac in `localStorage`, read back through
 * `parsePrefs` because stored JSON is untrusted (`shared/prefs.ts`).
 */

import { parsePrefs } from "../../shared/prefs.ts";
import { CAMERA_MODES, type CameraMode } from "../render/camera.ts";
import { el } from "./dom.ts";
import { ICON, icon } from "./icons.ts";

export type Opponent = "relaxed" | "match" | "tough";

export interface Settings {
	readonly camera: CameraMode;
	readonly opponent: Opponent;
	readonly sound: boolean;
	/** Two machines rally behind the lobby. Off saves a laptop's battery. */
	readonly lobbyRally: boolean;
	/** Two people each get their own half of the screen. */
	readonly split: boolean;
}

const DEFAULTS: Settings = {
	camera: "broadcast",
	opponent: "match",
	sound: true,
	lobbyRally: true,
	split: true,
};

const OPPONENTS: readonly Opponent[] = ["relaxed", "match", "tough"];

const KEY = "swingcourt.host.settings";

export const CAMERA_LABEL: Readonly<Record<CameraMode, string>> = {
	broadcast: "Broadcast",
	follow: "Follow",
	side: "Side on",
};

const OPPONENT_LABEL: Readonly<Record<Opponent, string>> = {
	relaxed: "Relaxed",
	match: "Match",
	tough: "Tough",
};

function load(): Settings {
	try {
		return parsePrefs(localStorage.getItem(KEY), DEFAULTS, {
			camera: CAMERA_MODES,
			opponent: OPPONENTS,
			sound: [true, false],
			lobbyRally: [true, false],
			split: [true, false],
		});
	} catch {
		// A private window or blocked storage throws on access.
		return DEFAULTS;
	}
}

function save(settings: Settings): void {
	try {
		localStorage.setItem(KEY, JSON.stringify(settings));
	} catch {
		// Settings still apply for this session; they just won't come back.
	}
}

export interface SettingsUI {
	get(): Settings;
	set(change: Partial<Settings>): void;
	toggle(): void;
	toggleFullscreen(): void;
}

function segmented<T extends string>(
	label: string,
	values: readonly T[],
	names: Readonly<Record<T, string>>,
	onPick: (value: T) => void,
): { root: HTMLDivElement; show(value: T): void } {
	const buttons = values.map((value) => {
		const b = el("button", "", names[value]);
		b.type = "button";
		b.setAttribute("role", "radio");
		b.addEventListener("click", () => onPick(value));
		return b;
	});
	const root = el("div", "seg", ...buttons);
	root.setAttribute("role", "radiogroup");
	root.setAttribute("aria-label", label);
	root.style.setProperty("--n", String(values.length));
	return {
		root,
		show(value) {
			const i = values.indexOf(value);
			root.style.setProperty("--i", String(i));
			buttons.forEach((b, j) => {
				b.setAttribute("aria-checked", String(j === i));
			});
		},
	};
}

function toggleSwitch(
	label: string,
	onFlip: () => void,
): { root: HTMLButtonElement; show(on: boolean): void } {
	const root = el("button", "switch");
	root.type = "button";
	root.setAttribute("role", "switch");
	root.setAttribute("aria-label", label);
	root.addEventListener("click", onFlip);
	return {
		root,
		show(on) {
			root.setAttribute("aria-checked", String(on));
		},
	};
}

export function createSettingsUI(
	root: HTMLElement,
	onChange: (settings: Settings, change: Partial<Settings>) => void,
): SettingsUI {
	let settings = load();

	function set(change: Partial<Settings>): void {
		settings = { ...settings, ...change };
		save(settings);
		render();
		onChange(settings, change);
	}

	const camera = segmented("Camera", CAMERA_MODES, CAMERA_LABEL, (camera) =>
		set({ camera }),
	);
	const opponent = segmented(
		"The machine",
		OPPONENTS,
		OPPONENT_LABEL,
		(opponent) => set({ opponent }),
	);
	const sound = toggleSwitch("Sound", () => set({ sound: !settings.sound }));
	const rally = toggleSwitch("Lobby rally", () =>
		set({ lobbyRally: !settings.lobbyRally }),
	);
	const split = toggleSwitch("Split screen", () =>
		set({ split: !settings.split }),
	);
	const fullscreenButton = el("button", "btn btn-ghost btn-small");
	fullscreenButton.type = "button";

	const close = el("button", "btn btn-round");
	close.type = "button";
	close.setAttribute("aria-label", "Close settings");
	close.append(icon("x"));

	const row = (title: string, help: string, control: HTMLElement) =>
		el(
			"section",
			"setting row",
			el("div", "", el("h3", "", title), el("p", "", help)),
			control,
		);
	const block = (title: string, help: string, control: HTMLElement) =>
		el(
			"section",
			"setting",
			el("div", "", el("h3", "", title), el("p", "", help)),
			control,
		);

	const dialog = el(
		"dialog",
		"sheet",
		el(
			"div",
			"sheet-inner",
			el("header", "sheet-head", el("h2", "", "Settings"), close),
			block("Camera", "Press C to switch during a match.", camera.root),
			block(
				"The machine",
				"How often the solo opponent mistimes a shot. Applies from the next match.",
				opponent.root,
			),
			row(
				"Split screen",
				"When two people play, each gets their own half, from behind their own player. From the next match.",
				split.root,
			),
			row("Sound", "Racket, bounce and crowd.", sound.root),
			row(
				"Lobby rally",
				"Two machines play behind the join screen.",
				rally.root,
			),
			row("Full screen", "Or press F.", fullscreenButton),
			el("p", "sheet-foot", "Settings are kept on this computer."),
		),
	);
	dialog.setAttribute("aria-label", "Settings");

	// ----------------------------------------------------- corner buttons
	const gear = el("button", "btn btn-round");
	gear.type = "button";
	gear.setAttribute("aria-label", "Settings");
	gear.append(icon("gear"));
	const screen = el("button", "btn btn-round");
	screen.type = "button";
	const chrome = el("div", "chrome", screen, gear);

	root.append(chrome, dialog);
	// A modal dialog has to be in the top layer, which ignores #ui's
	// pointer-events: none — but its parent must still accept events.
	dialog.style.pointerEvents = "auto";

	function toggleFullscreen(): void {
		if (document.fullscreenElement) void document.exitFullscreen();
		else void document.documentElement.requestFullscreen();
	}

	function renderScreen(): void {
		const full = document.fullscreenElement !== null;
		screen.innerHTML = full ? ICON.arrowsIn : ICON.arrowsOut;
		screen.setAttribute(
			"aria-label",
			full ? "Leave full screen" : "Full screen",
		);
		fullscreenButton.textContent = full ? "Leave" : "Enter";
	}

	function render(): void {
		camera.show(settings.camera);
		opponent.show(settings.opponent);
		sound.show(settings.sound);
		rally.show(settings.lobbyRally);
		split.show(settings.split);
		renderScreen();
	}

	function closeSheet(): void {
		if (!dialog.open || dialog.classList.contains("closing")) return;
		dialog.classList.add("closing");
		const done = () => {
			dialog.classList.remove("closing");
			dialog.close();
		};
		// Under reduced motion the animation is 1ms; either way it ends.
		dialog.addEventListener("animationend", done, { once: true });
	}

	function toggle(): void {
		if (dialog.open) closeSheet();
		else dialog.showModal();
	}

	gear.addEventListener("click", toggle);
	screen.addEventListener("click", toggleFullscreen);
	fullscreenButton.addEventListener("click", toggleFullscreen);
	close.addEventListener("click", closeSheet);
	// Escape: animate out rather than vanish.
	dialog.addEventListener("cancel", (event) => {
		event.preventDefault();
		closeSheet();
	});
	// A click on the backdrop lands on the dialog element itself.
	dialog.addEventListener("click", (event) => {
		if (event.target === dialog) closeSheet();
	});
	document.addEventListener("fullscreenchange", renderScreen);

	// Hide the corner buttons and the cursor while a match is being watched
	// and nobody is touching the mouse (the CSS only acts on it in play).
	let idleTimer = 0;
	const wake = () => {
		document.body.classList.remove("idle");
		window.clearTimeout(idleTimer);
		idleTimer = window.setTimeout(
			() => document.body.classList.add("idle"),
			2500,
		);
	};
	window.addEventListener("pointermove", wake);
	wake();

	render();

	return {
		get: () => settings,
		set,
		toggle,
		toggleFullscreen,
	};
}
