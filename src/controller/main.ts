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
import { fillIcons } from "./icons.ts";
import { requestMotionPermission } from "./motion.ts";
import { createRacket, type Racket } from "./racket.ts";
import { createSession, type Session, type SessionState } from "./session.ts";
import { racketView } from "./view.ts";
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
const racketCanvas = requireElement("racket", HTMLCanvasElement);
const statusEl = requireElement("status", HTMLElement);
const cardsEl = requireElement("cards", HTMLElement);
const dotsEl = requireElement("dots", HTMLElement);
const settingsEl = requireElement("settings", HTMLDialogElement);
const hapticEl = requireElement("haptic-label", HTMLLabelElement);

fillIcons();

/** What the frame says instead of the side's name while the connection is
 * not right. `null` is connected. */
const CONNECTION_RIM: Record<SessionState, string | null> = {
	connecting: "CONNECTING",
	waiting: null,
	playing: null,
	reconnecting: "RECONNECTING",
	rejected: "NOT CONNECTED",
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
let connection: SessionState = "connecting";
/** `performance.now()` when the countdown was announced: the host sends the
 * phase, not a clock. */
let countdownFrom = 0;

/** The avatar colours on the host screen (`host/render/players.ts`), so a
 * player can find themselves on the court at a glance. */
const SIDE_COLOR: Record<Side, string> = { near: "#ff5d73", far: "#5ac8fa" };

/** Drawn once the gate is passed; the canvas is hidden until then. */
let racket: Racket | null = null;

function currentView() {
	const view = racketView(
		match,
		mySide,
		(performance.now() - countdownFrom) / 1000,
	);
	const trouble = CONNECTION_RIM[connection];
	return trouble === null ? view : { ...view, rim: trouble };
}

/** The status line a screen reader hears: the same words the strings say. */
function announce(): void {
	const view = currentView();
	const words = `${view.headline.map((i) => i.text).join("")}. ${view.caption}`;
	if (statusEl.textContent !== words) statusEl.textContent = words;
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
const FLASH: Record<FeedbackKind, string> = {
	hit: "#dcff4a",
	miss: "#ff5a5f",
	point: "#34d86a",
};

function buzz(pattern: number | number[]): void {
	if (!prefs.haptic) return;
	navigator.vibrate?.(pattern);
	hapticEl.click();
}

function flash(kind: FeedbackKind): void {
	if (prefs.flash) {
		document.body.style.setProperty("--flash", FLASH[kind]);
		document.body.classList.add("flash");
		requestAnimationFrame(() => {
			requestAnimationFrame(() => document.body.classList.remove("flash"));
		});
	}
	if (kind === "hit") racket?.hit(shownPower);
	else if (kind === "point") racket?.point();
	else racket?.miss();
	buzz(kind === "point" ? [40, 60, 40] : 30);
}

/** How the readout names each stroke, with the way it sends the ball on
 * the screen (`sim/shot.ts`, `screenLeftOf`). */
const MOVE_NAME: Record<SwingKind, string> = {
	forehand: "FOREHAND \u2190",
	backhand: "BACKHAND \u2192",
	overhead: "SMASH \u2191",
	serve: "SERVE",
};

let shownPower = 0;
let shownAt = 0;

/** One swing is several peaks (backswing, swing, follow-through), so a
 * weaker peak right after a stronger one is the same swing and does not
 * replace it — which is also the one the host plays. */
function showSwing(power: number, lag: number): void {
	const now = performance.now();
	if (now - shownAt < 400 && power <= shownPower) return;
	shownPower = power;
	shownAt = now;
	racket?.swing(power, lag / 1000);
}

/** Rotation that reads as a full-strength swing on the live glow, deg/s. */
const LEVEL_FULL = 1100;

/** Once a frame: the live swing, the readout, and what the strings say. */
function drawLevel(): void {
	const now = stream.current;
	racket?.level(Math.min(1, stream.level / LEVEL_FULL), now);
	racket?.reading(
		prefs.readout && now !== null ? `READING ${MOVE_NAME[now]}` : null,
	);
	racket?.show(currentView());
	announce();
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
	const g = event.accelerationIncludingGravity;
	if (g?.x != null && g.y != null) racket?.tilt(g.x / 9.81, -g.y / 9.81);
	const swing = stream.push(sample);
	if (swing === null) return;
	showSwing(swing.power, swing.lag ?? 0);
	// Only while a point can be played: a gesture in the lobby is not a shot.
	if (match?.phase === "playing") session?.send({ t: "swing", ...swing });
}

function startPlaying(): void {
	gate.hidden = true;
	play.hidden = false;
	clearInterval(cardTimer);
	cardSeen.disconnect();
	document.documentElement.classList.add("playing");
	racket = createRacket(racketCanvas);
	keepAwake();
	session = createSession({
		onState: (state) => {
			connection = state;
		},
		onMatch: (info) => {
			if (info.phase === "countdown" && match?.phase !== "countdown") {
				countdownFrom = performance.now();
			}
			match = info;
		},
		onFeedback: flash,
		onSide: (side) => {
			mySide = side;
			document.documentElement.style.setProperty("--side", SIDE_COLOR[side]);
			racket?.setSide(SIDE_COLOR[side]);
			document.body.classList.remove("gated");
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
