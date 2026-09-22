/**
 * The controller entry point: permission gate, motion listener, and the
 * swing stream feeding the socket. This is the caller `detectSwings` spent
 * its first week without — see `llm-knowledge/architecture.md`, seam 1.
 *
 * Not unit tested: it is all DOM and socket wiring. The parts worth testing
 * are pure and live elsewhere — `shared/swing/stream.ts` and `backoffMs`.
 */

import type { FeedbackKind, MatchInfo, Side } from "../shared/protocol.ts";
import { createSwingStream } from "../shared/swing/stream.ts";
import { toSample } from "../shared/swing/trace.ts";
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
const ringEl = requireElement("ring", HTMLElement);
const powerEl = requireElement("power", HTMLElement);
const toastEl = requireElement("toast", HTMLElement);
const hapticEl = requireElement("haptic-label", HTMLLabelElement);

const STATUS_TEXT: Record<SessionState, string> = {
	connecting: "Connecting…",
	waiting: "Ready",
	playing: "Ready",
	reconnecting: "Reconnecting…",
	rejected: "",
};

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
const SIDE_COLOR: Record<Side, string> = { near: "#ff5d73", far: "#ffd166" };

function hint(text: string, detail?: string): void {
	hintEl.replaceChildren(text);
	if (detail) {
		const small = document.createElement("small");
		small.textContent = detail;
		hintEl.append(small);
	}
}

function renderMatch(): void {
	if (!match) {
		hint("Waiting for the host.");
		return;
	}
	switch (match.phase) {
		case "lobby":
			hint("You\u2019re in!", "Waiting for the host to start the match.");
			return;
		case "countdown":
			hint("Get ready\u2026", "Racket up.");
			return;
		case "playing":
			if (match.server === mySide && mySide !== null) {
				hint(
					"Your serve",
					"Swing once to toss the ball, then again to hit it at the top.",
				);
			} else {
				hint(
					"Swing as the ball reaches you",
					"Early pulls it across the court, late sends it down the line.",
				);
			}
			return;
		case "over":
			hint(
				match.winner === mySide ? "You won! \ud83c\udfc6" : "Match over.",
				"Good game.",
			);
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
	hit: { color: "#7fe0a4", text: "Nice hit!" },
	miss: { color: "#ff6b6b", text: "Point lost" },
	point: { color: "#ffd166", text: "Point!" },
};

let toastTimer = 0;

function buzz(pattern: number | number[]): void {
	navigator.vibrate?.(pattern);
	hapticEl.click();
}

function flash(kind: FeedbackKind): void {
	const { color, text } = FEEDBACK[kind];
	document.body.style.setProperty("--flash", color);
	document.body.classList.add("flash");
	toastEl.textContent = text;
	toastEl.style.color = color;
	toastEl.classList.add("show");
	buzz(kind === "point" ? [40, 60, 40] : 30);
	requestAnimationFrame(() => {
		requestAnimationFrame(() => document.body.classList.remove("flash"));
	});
	clearTimeout(toastTimer);
	toastTimer = window.setTimeout(() => toastEl.classList.remove("show"), 900);
}

let shownPower = 0;
let shownAt = 0;

/** The ring: the last swing's power as an arc and a number. One swing is
 * several peaks (backswing, swing, follow-through), so a weaker peak right
 * after a stronger one is the same swing and does not replace it. */
function showSwing(power: number): void {
	const now = performance.now();
	if (now - shownAt < 400 && power <= shownPower) return;
	shownPower = power;
	shownAt = now;
	const pct = Math.round(power * 100);
	ringEl.style.setProperty("--power", String(power));
	powerEl.textContent = String(pct);
	ringEl.classList.remove("pop");
	void ringEl.offsetWidth; // restart the animation
	ringEl.classList.add("pop");
}

/** Rotation that reads as a full-strength swing on the live glow, deg/s. */
const LEVEL_FULL = 1100;
let levelShown = 0;

/** Live rotation as a glow, eased and drawn once a frame rather than at the
 * sensor's 60Hz straight into style. */
function drawLevel(): void {
	const target = Math.min(1, stream.level / LEVEL_FULL);
	levelShown += (target - levelShown) * (target > levelShown ? 0.6 : 0.15);
	ringEl.style.setProperty("--level", levelShown.toFixed(3));
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
	showSwing(swing.power);
	// Only while a point can be played: a gesture in the lobby is not a shot.
	if (match?.phase === "playing") session?.send({ t: "swing", ...swing });
}

function startPlaying(): void {
	gate.hidden = true;
	play.hidden = false;
	keepAwake();
	session = createSession({
		onState: (state, detail) => {
			statusEl.textContent = detail ?? STATUS_TEXT[state];
		},
		onMatch: (info) => {
			match = info;
			renderMatch();
		},
		onFeedback: flash,
		onSide: (side) => {
			mySide = side;
			sideEl.textContent = SIDE_NAME[side];
			document.documentElement.style.setProperty("--accent", SIDE_COLOR[side]);
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
