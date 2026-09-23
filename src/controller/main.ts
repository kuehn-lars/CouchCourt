/**
 * The controller entry point: permission gate, motion listener, and the
 * swing stream feeding the socket. This is the caller `detectSwings` spent
 * its first week without — see `llm-knowledge/architecture.md`, seam 1.
 *
 * Not unit tested: it is all DOM and socket wiring. The parts worth testing
 * are pure and live elsewhere — `shared/swing/stream.ts` and `backoffMs`.
 */

import { parsePrefs } from "../shared/prefs.ts";
import type {
	FeedbackKind,
	MatchInfo,
	Side,
	SwingKind,
} from "../shared/protocol.ts";
import { createSwingStream } from "../shared/swing/stream.ts";
import { toSample } from "../shared/swing/trace.ts";
import { fillIcons, ICON, type IconName } from "./icons.ts";
import { requestMotionPermission } from "./motion.ts";
import { createSession, type Session, type SessionState } from "./session.ts";
import { keepAwake } from "./wake-lock.ts";

function requireElement<T extends Element>(id: string, ctor: new () => T): T {
	const el = document.getElementById(id);
	if (!(el instanceof ctor)) {
		throw new Error(`main.ts: #${id} is missing or not a ${ctor.name}`);
	}
	return el;
}

const gate = requireElement("gate", HTMLElement);
const gateStatus = requireElement("gate-status", HTMLElement);
const enableButton = requireElement("enable", HTMLButtonElement);
const play = requireElement("play", HTMLElement);
const sideEl = requireElement("side", HTMLElement);
const statusEl = requireElement("status", HTMLElement);
const hintEl = requireElement("hint", HTMLElement);
const hintIconEl = requireElement("hint-icon", HTMLElement);
const hintTitleEl = requireElement("hint-title", HTMLElement);
const hintDetailEl = requireElement("hint-detail", HTMLElement);
const stageEl = requireElement("stage", HTMLElement);
const cardsEl = requireElement("cards", HTMLElement);
const dotsEl = requireElement("dots", HTMLElement);
const settingsEl = requireElement("settings", HTMLDialogElement);
const ringEl = requireElement("ring", HTMLElement);
const powerEl = requireElement("power", HTMLElement);
const toastEl = requireElement("toast", HTMLElement);
const moveNowEl = requireElement("move-now", HTMLElement);
const moveLastEl = requireElement("move-last", HTMLElement);
const hapticEl = requireElement("haptic-label", HTMLLabelElement);

fillIcons();

const STATUS_TEXT: Record<SessionState, string> = {
	connecting: "Connecting",
	waiting: "Connected",
	playing: "Connected",
	reconnecting: "Reconnecting",
	rejected: "",
};

// ------------------------------------------------------------- settings

/** Kept on this phone. Stored JSON is untrusted (`shared/prefs.ts`). */
const PREFS_KEY = "swingcourt.controller.prefs";
const PREF_DEFAULTS = { flash: true, haptic: true, readout: true };
type Prefs = typeof PREF_DEFAULTS;

function loadPrefs(): Prefs {
	try {
		return parsePrefs(localStorage.getItem(PREFS_KEY), PREF_DEFAULTS, {
			flash: [true, false],
			haptic: [true, false],
			readout: [true, false],
		});
	} catch {
		return { ...PREF_DEFAULTS };
	}
}

let prefs = loadPrefs();

function renderPrefs(): void {
	for (const key of Object.keys(prefs) as (keyof Prefs)[]) {
		requireElement(`pref-${key}`, HTMLButtonElement).setAttribute(
			"aria-checked",
			String(prefs[key]),
		);
	}
	document.body.classList.toggle("no-readout", !prefs.readout);
}

for (const key of Object.keys(prefs) as (keyof Prefs)[]) {
	requireElement(`pref-${key}`, HTMLButtonElement).addEventListener(
		"click",
		() => {
			prefs = { ...prefs, [key]: !prefs[key] };
			try {
				localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
			} catch {
				// Applies for this visit; just not remembered.
			}
			renderPrefs();
		},
	);
}
renderPrefs();

function closeSettings(): void {
	if (!settingsEl.open || settingsEl.classList.contains("closing")) return;
	settingsEl.classList.add("closing");
	settingsEl.addEventListener(
		"animationend",
		() => {
			settingsEl.classList.remove("closing");
			settingsEl.close();
		},
		{ once: true },
	);
}
requireElement("open-settings", HTMLButtonElement).addEventListener(
	"click",
	() => settingsEl.showModal(),
);
requireElement("close-settings", HTMLButtonElement).addEventListener(
	"click",
	closeSettings,
);
settingsEl.addEventListener("cancel", (event) => {
	event.preventDefault();
	closeSettings();
});
// A tap on the dimmed backdrop lands on the dialog element itself.
settingsEl.addEventListener("click", (event) => {
	if (event.target === settingsEl) closeSettings();
});

// ------------------------------------------------ the gate's how-to cards

const cards = [...cardsEl.children];
const dots = [...dotsEl.children];
const cardSeen = new IntersectionObserver(
	(entries) => {
		for (const entry of entries) {
			if (!entry.isIntersecting) continue;
			const i = cards.indexOf(entry.target);
			dots.forEach((dot, j) => {
				dot.classList.toggle("on", j === i);
			});
		}
	},
	{ root: cardsEl, threshold: 0.6 },
);
for (const card of cards) cardSeen.observe(card);

/** The cards turn over on their own until someone touches them. */
let cardTimer = 0;
if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
	let at = 0;
	cardTimer = window.setInterval(() => {
		at = (at + 1) % cards.length;
		const card = cards[at];
		if (card instanceof HTMLElement) {
			cardsEl.scrollTo({ left: card.offsetLeft - 20, behavior: "smooth" });
		}
	}, 4200);
	cardsEl.addEventListener("pointerdown", () => clearInterval(cardTimer), {
		once: true,
	});
}

/** What the phone says about the match. The host decides all of it; this is
 * presentation of a relayed fact and nothing more. */
let match: MatchInfo | null = null;
let mySide: Side | null = null;

const SIDE_NAME: Record<Side, string> = {
	near: "Near court",
	far: "Far court",
};

/** The avatar colours on the host screen (`host/render/entities.ts`), so a
 * player can find themselves on the court at a glance. */
const SIDE_COLOR: Record<Side, string> = { near: "#ff5d73", far: "#5ac8fa" };

/** The card under the gauge: what to do now. Animates only when it says
 * something new. */
function hint(glyph: IconName, title: string, detail: string): void {
	if (hintTitleEl.textContent === title && hintDetailEl.textContent === detail)
		return;
	hintIconEl.innerHTML = ICON[glyph];
	hintTitleEl.textContent = title;
	hintDetailEl.textContent = detail;
	hintEl.classList.remove("changed");
	void hintEl.offsetWidth; // restart the animation
	hintEl.classList.add("changed");
}

function renderMatch(): void {
	if (!match) {
		hint("tennisBall", "Finding the host", "Keep this page open.");
		return;
	}
	switch (match.phase) {
		case "lobby":
			hint(
				"check",
				"You\u2019re in",
				"Waiting for the host to start the match.",
			);
			return;
		case "countdown":
			hint("tennisBall", "Racket up", "The match is about to start.");
			return;
		case "playing":
			if (match.server === mySide && mySide !== null) {
				hint(
					"tennisBall",
					"Your serve",
					"Swing once to toss the ball, then again to hit it at the top.",
				);
			} else {
				hint(
					"arrowsLeftRight",
					"Forehand left, backhand right",
					"Swing as it reaches you. Early goes wide, late goes long.",
				);
			}
			return;
		case "over":
			if (match.winner === mySide) {
				hint("trophy", "You won", "Game, set and match.");
			} else {
				hint("tennisBall", "Good game", "The host can start another one.");
			}
			return;
	}
}

/**
 * The screen IS the feedback channel. iOS Safari has no `navigator.vibrate`
 * at all — it is a Chrome/Android API — so a colour flash is not a fallback
 * here, it is the only thing guaranteed to work on the target device.
 * `vibrate` is still called where it exists, and on iOS 18+ toggling a
 * `<input switch>` through its label plays a system haptic tick, which is
 * tried as well. **Unverified on a phone** — if it does nothing, nothing is
 * lost.
 */
const FEEDBACK: Record<FeedbackKind, { color: string; text: string }> = {
	hit: { color: "#dcff4a", text: "Hit" },
	miss: { color: "#ff5a5f", text: "Point lost" },
	point: { color: "#34d86a", text: "Point" },
};

let toastTimer = 0;

function buzz(pattern: number | number[]): void {
	if (!prefs.haptic) return;
	navigator.vibrate?.(pattern);
	hapticEl.click();
}

function flash(kind: FeedbackKind): void {
	const { color, text } = FEEDBACK[kind];
	if (prefs.flash) {
		document.body.style.setProperty("--flash", color);
		document.body.classList.add("flash");
		requestAnimationFrame(() => {
			requestAnimationFrame(() => document.body.classList.remove("flash"));
		});
	}
	toastEl.textContent = text;
	toastEl.style.color = color;
	toastEl.classList.remove("show");
	void toastEl.offsetWidth; // restart the stamp
	toastEl.classList.add("show");
	stageEl.classList.add("stamped");
	buzz(kind === "point" ? [40, 60, 40] : 30);
	clearTimeout(toastTimer);
	toastTimer = window.setTimeout(() => {
		toastEl.classList.remove("show");
		stageEl.classList.remove("stamped");
	}, 900);
}

/** What each stroke does, as the corner readout names it. The arrows are
 * where the ball goes on the screen (`sim/shot.ts`, `SCREEN_LEFT`). */
const MOVE_NAME: Record<SwingKind, string> = {
	forehand: "Forehand",
	backhand: "Backhand",
	overhead: "Overhead",
	serve: "Serve",
};
const MOVE_ICON: Record<SwingKind, IconName> = {
	forehand: "arrowLeft",
	backhand: "arrowRight",
	overhead: "arrowUp",
	serve: "tennisBall",
};

let shownPower = 0;
let shownAt = 0;

/** The ring: the last swing's power as an arc and a number, and the corner
 * readout's "last" move. One swing is several peaks (backswing, swing,
 * follow-through), so a weaker peak right after a stronger one is the same
 * swing and does not replace it — which is also the one the host plays. */
function showSwing(power: number, kind: SwingKind): void {
	const now = performance.now();
	if (now - shownAt < 400 && power <= shownPower) return;
	shownPower = power;
	shownAt = now;
	const pct = Math.round(power * 100);
	moveLastEl.innerHTML = ICON[MOVE_ICON[kind]];
	moveLastEl.append(MOVE_NAME[kind]);
	ringEl.style.setProperty("--power", String(power));
	powerEl.textContent = String(pct);
	ringEl.classList.remove("pop");
	void ringEl.offsetWidth; // restart the animation
	ringEl.classList.add("pop");
}

/** Rotation that reads as a full-strength swing on the live glow, deg/s. */
const LEVEL_FULL = 1100;
let levelShown = 0;

let nowShown: SwingKind | null = null;

/** Live rotation as a glow, eased and drawn once a frame rather than at the
 * sensor's 60Hz straight into style. */
function drawLevel(): void {
	const target = Math.min(1, stream.level / LEVEL_FULL);
	levelShown += (target - levelShown) * (target > levelShown ? 0.6 : 0.15);
	ringEl.style.setProperty("--level", levelShown.toFixed(3));
	// The move in progress, for debugging the classifier with a phone in
	// hand: which way does the phone think this swing is going?
	const now = stream.current;
	if (now !== nowShown) {
		nowShown = now;
		moveNowEl.textContent = now === null ? "nothing" : MOVE_NAME[now];
		moveNowEl.classList.toggle("live", now !== null);
	}
	requestAnimationFrame(drawLevel);
}

const stream = createSwingStream();
let session: Session | null = null;

/**
 * `performance.now()` at the listener's own entry, not `event.timeStamp`,
 * which is not trustworthy on iOS. The first reading anchors t = 0 so the
 * stream's durations are relative to the first sample it ever saw, exactly
 * like a recorded trace.
 */
let firstAt: number | null = null;

function onMotion(event: DeviceMotionEvent): void {
	const now = performance.now();
	if (firstAt === null) firstAt = now;
	// A real DeviceMotionEvent is structurally assignable to MotionReading.
	const sample = toSample(now - firstAt, event);
	// Never substitute zeros: a fabricated at-rest sample is fed straight to
	// the one algorithm whose job is telling rest from a swing.
	if (sample === null) return;
	const swing = stream.push(sample);
	if (swing === null) return;
	showSwing(swing.power, swing.kind);
	// Only while a point can be played: a gesture in the lobby is not a shot.
	if (match?.phase === "playing") session?.send({ t: "swing", ...swing });
}

function startPlaying(): void {
	gate.hidden = true;
	play.hidden = false;
	clearInterval(cardTimer);
	cardSeen.disconnect();
	document.documentElement.classList.add("playing");
	keepAwake();
	session = createSession({
		onState: (state, detail) => {
			statusEl.textContent = detail ?? STATUS_TEXT[state];
			statusEl.dataset.state = state;
		},
		onMatch: (info) => {
			match = info;
			renderMatch();
		},
		onFeedback: flash,
		onSide: (side) => {
			mySide = side;
			sideEl.textContent = SIDE_NAME[side];
			document.documentElement.style.setProperty("--side", SIDE_COLOR[side]);
			document.body.classList.remove("gated");
			renderMatch();
			// Sent HERE, not right after createSession: the socket is not open
			// yet at that point and `send` would drop it silently. Being
			// assigned a side is the first moment there is a session to be
			// ready in. The gate tap is the only tap a player makes, so it
			// doubles as readiness and there is no separate button.
			session?.send({ t: "ready", ready: true });
		},
	});
	window.addEventListener("devicemotion", onMotion);
	requestAnimationFrame(drawLevel);
}

enableButton.addEventListener("click", () => {
	// No `await` before this call — an await on anything else first loses the
	// user gesture and requestPermission() rejects. See motion.ts and
	// llm-knowledge/platform/ios-motion-permission.md.
	void requestMotionPermission().then((result) => {
		if (result === "granted" || result === "unsupported") {
			startPlaying();
			return;
		}
		if (result === "denied") {
			gateStatus.textContent =
				"Motion access denied. If you didn't see a prompt, it's likely " +
				"off device-wide: Settings › Safari › Motion & Orientation " +
				"Access. If you tapped Don't Allow, recovering needs Settings › " +
				"Safari › Clear History and Website Data.";
			return;
		}
		gateStatus.textContent = "Permission request failed. Try again.";
	});
});
