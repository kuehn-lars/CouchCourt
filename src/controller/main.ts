/**
 * The controller entry point: permission gate, motion listener, and the
 * swing stream feeding the socket. This is the caller `detectSwings` spent
 * its first week without — see `llm-knowledge/architecture.md`, seam 1.
 *
 * Not unit tested: it is all DOM and socket wiring. The parts worth testing
 * are pure and live elsewhere — `shared/swing/stream.ts` and `backoffMs`.
 */

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

const STATUS_TEXT: Record<SessionState, string> = {
	connecting: "Connecting…",
	waiting: "Ready",
	playing: "Ready",
	reconnecting: "Reconnecting…",
	rejected: "",
};

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
	if (swing !== null) session?.send({ t: "swing", ...swing });
}

function startPlaying(): void {
	gate.hidden = true;
	play.hidden = false;
	keepAwake();
	session = createSession({
		onState: (state, detail) => {
			statusEl.textContent = detail ?? STATUS_TEXT[state];
		},
		onSide: (side) => {
			sideEl.textContent = side === "near" ? "Near side" : "Far side";
			// Sent HERE, not right after createSession: the socket is not open
			// yet at that point and `send` would drop it silently. Being
			// assigned a side is the first moment there is a session to be
			// ready in. The gate tap is the only tap a player makes, so it
			// doubles as readiness and there is no separate button.
			session?.send({ t: "ready", ready: true });
		},
	});
	window.addEventListener("devicemotion", onMotion);
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
