/**
 * Trace recorder controller page. Captures real `devicemotion` samples into
 * the `MotionTrace` shape and POSTs them to the dev server for use as
 * fixtures. See `tests/fixtures/motion/README.md` for the format and grip
 * convention, and `llm-knowledge/platform/ios-motion-permission.md` for why
 * the permission gate and the recording flow look the way they do.
 */

import {
	longestGapMs,
	MAX_GAP_MS,
	type MotionSample,
	type MotionTrace,
	measuredHz,
	TRACE_LABELS,
	type TraceLabel,
	toSample,
} from "../shared/swing/trace.ts";
import { requestMotionPermission } from "./motion.ts";
import { keepAwake, type WakeLockHandle } from "./wake-lock.ts";

const COUNTDOWN_SECONDS = 5;
const DEVICE_KEY = "swingcourt-recorder-device";
const IOS_KEY = "swingcourt-recorder-ios";

/**
 * Takes the constructor rather than a bare type parameter so the check is real.
 * With `as unknown as T` the compiler accepted any claim about any id, and a
 * typo surfaced as a confusing runtime error somewhere else entirely.
 */
function requireElement<T extends Element>(id: string, ctor: new () => T): T {
	const el = document.getElementById(id);
	if (!(el instanceof ctor)) {
		throw new Error(`record.ts: #${id} is missing or not a ${ctor.name}`);
	}
	return el;
}

const gateSection = requireElement("gate", HTMLElement);
const gateStatus = requireElement("gate-status", HTMLElement);
const enableButton = requireElement("enable-motion", HTMLButtonElement);

const captureSection = requireElement("capture", HTMLElement);
const deviceInput = requireElement("device", HTMLInputElement);
const iosInput = requireElement("ios", HTMLInputElement);
const labelsContainer = requireElement("labels", HTMLElement);
const shortButton = requireElement("short", HTMLButtonElement);
const longButton = requireElement("long", HTMLButtonElement);
const countdownEl = requireElement("countdown", HTMLElement);
const readoutEl = requireElement("readout", HTMLElement);
const saveButton = requireElement("save", HTMLButtonElement);
const statusEl = requireElement("status", HTMLElement);

// --- prefilled, persisted device/iOS fields -------------------------------

deviceInput.value = localStorage.getItem(DEVICE_KEY) ?? "iPhone 14 Pro";
iosInput.value = localStorage.getItem(IOS_KEY) ?? "26.6.1";
deviceInput.addEventListener("input", () => {
	localStorage.setItem(DEVICE_KEY, deviceInput.value);
});
iosInput.addEventListener("input", () => {
	localStorage.setItem(IOS_KEY, iosInput.value);
});

// --- label selection --------------------------------------------------

const labelButtons = new Map<TraceLabel, HTMLButtonElement>();
let selectedLabel: TraceLabel | null = null;

function selectLabel(label: TraceLabel): void {
	selectedLabel = label;
	for (const [candidate, button] of labelButtons) {
		button.setAttribute("aria-pressed", String(candidate === label));
	}
}

for (const label of TRACE_LABELS) {
	const button = document.createElement("button");
	button.type = "button";
	button.textContent = label;
	button.setAttribute("aria-pressed", "false");
	button.addEventListener("click", () => selectLabel(label));
	labelsContainer.appendChild(button);
	labelButtons.set(label, button);
}
const firstLabel = TRACE_LABELS[0];
if (firstLabel !== undefined) selectLabel(firstLabel);

// --- capture state ------------------------------------------------------

/**
 * Everything one capture accumulates, in a single record so starting a new one
 * cannot half-reset it. The previous version reset seven separate variables by
 * hand, and a successful save cleared only the samples — leaving the readout
 * reporting the *previous* capture's peak rotation, which is the one number
 * you actually watch.
 *
 * `hz` and the worst gap are deliberately absent: they are derived from
 * `samples` on demand, so they cannot go stale.
 */
interface Capture {
	samples: MotionSample[];
	dropped: number;
	peak: number;
	/** `performance.now()` of the first sample, anchoring t = 0. */
	firstAt: number | null;
}

const emptyCapture = (): Capture => ({
	samples: [],
	dropped: 0,
	peak: 0,
	firstAt: null,
});

let capture = emptyCapture();
let capturing = false;

let wakeLock: WakeLockHandle | null = null;

// The readout is telemetry, not data. Repainting it on every sample means ~60
// DOM writes a second inside the listener that is supposed to be measuring the
// phone, so it is throttled to roughly 10Hz. A recorder that perturbs what it
// records is not a recorder.
let readoutTick = 0;
function updateReadoutThrottled(): void {
	readoutTick += 1;
	if (readoutTick % 6 === 0) updateReadout();
}

function updateReadout(): void {
	// Shown live rather than only at the end: a rate that sags mid-capture is
	// the symptom of a throttled sensor, and you want to see it while you can
	// still re-record.
	readoutEl.textContent =
		`samples: ${capture.samples.length}\n` +
		`hz: ${measuredHz(capture.samples)}\n` +
		`peak |rotationRate|: ${capture.peak.toFixed(1)} deg/s\n` +
		`dropped: ${capture.dropped}\n` +
		`wake lock: ${wakeLock?.state() ?? "idle"}`;
}

// devicemotion listener is added once, after motion access is confirmed;
// it only records while `capturing` is true.
function onMotion(event: DeviceMotionEvent): void {
	if (!capturing) return;
	// event.timeStamp is not trustworthy on iOS; performance.now() at the
	// listener's own entry is the reliable clock.
	const now = performance.now();
	if (capture.firstAt === null) {
		// The first accepted-into-this-capture reading anchors t = 0, not the
		// tap that started the countdown — otherwise every trace opens with a
		// fabricated multi-second gap.
		capture.firstAt = now;
	}
	const t = now - capture.firstAt;
	// A real DeviceMotionEvent is structurally assignable to MotionReading.
	const sample = toSample(t, event);
	if (sample === null) {
		// Never substitute zeros for a missing/non-finite reading.
		capture.dropped += 1;
		updateReadoutThrottled();
		return;
	}
	capture.samples.push(sample);
	const peak = Math.max(
		Math.abs(sample.rot[0]),
		Math.abs(sample.rot[1]),
		Math.abs(sample.rot[2]),
	);
	if (peak > capture.peak) capture.peak = peak;
	updateReadoutThrottled();
}

function runCountdown(seconds: number, onDone: () => void): void {
	let remaining = seconds;
	countdownEl.textContent = String(remaining);
	const id = setInterval(() => {
		remaining -= 1;
		if (remaining <= 0) {
			clearInterval(id);
			countdownEl.textContent = "REC";
			onDone();
			return;
		}
		countdownEl.textContent = String(remaining);
	}, 1000);
}

function beginCapture(seconds: number): void {
	capture = emptyCapture();
	capturing = true;
	saveButton.disabled = true;
	statusEl.textContent = "Recording…";
	updateReadout();
	setTimeout(() => stopCapture(), seconds * 1000);
}

function stopCapture(): void {
	capturing = false;
	wakeLock?.release();
	countdownEl.textContent = "";
	updateReadout();
	shortButton.disabled = false;
	longButton.disabled = false;

	const gap = longestGapMs(capture.samples);
	if (capture.samples.length < 2) {
		// Fewer than two samples makes measuredHz 0, which isTrace rejects —
		// better to say so here than to ship a 400 back from the endpoint.
		statusEl.textContent =
			capture.samples.length === 0
				? "No samples captured — motion access may be granted but silent. Re-record."
				: "Only one sample captured. Re-record.";
		saveButton.disabled = true;
	} else if (gap > MAX_GAP_MS) {
		statusEl.textContent =
			`Sampling stalled — a ${Math.round(gap)}ms gap was found (the tab ` +
			"was probably backgrounded). Re-record.";
		saveButton.disabled = true;
	} else {
		statusEl.textContent = "Capture complete. Ready to save.";
		saveButton.disabled = false;
	}
}

function onDurationTap(seconds: number): void {
	if (selectedLabel === null || capturing) return;
	shortButton.disabled = true;
	longButton.disabled = true;
	saveButton.disabled = true;
	statusEl.textContent = "";
	wakeLock = keepAwake(updateReadout);
	runCountdown(COUNTDOWN_SECONDS, () => beginCapture(seconds));
}

shortButton.addEventListener("click", () => {
	void onDurationTap(6);
});
longButton.addEventListener("click", () => {
	void onDurationTap(30);
});

// --- saving ---------------------------------------------------------------

function extractFilename(text: string): string {
	try {
		const parsed: unknown = JSON.parse(text);
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			"file" in parsed &&
			typeof parsed.file === "string"
		) {
			return parsed.file;
		}
	} catch {
		// Not JSON, or not shaped as expected — fall through to raw text.
	}
	return text;
}

async function onSave(): Promise<void> {
	if (selectedLabel === null || capture.samples.length === 0) return;
	const trace: MotionTrace = {
		label: selectedLabel,
		device: deviceInput.value,
		ios: iosInput.value,
		hz: measuredHz(capture.samples),
		samples: capture.samples,
	};
	statusEl.textContent = "Saving…";
	saveButton.disabled = true;
	try {
		const response = await fetch("/__trace", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(trace),
		});
		const text = await response.text();
		if (response.ok) {
			statusEl.textContent = `Saved: ${extractFilename(text)}`;
			capture = emptyCapture();
			updateReadout();
		} else {
			// Save failed: leave the samples in memory and Save re-enabled.
			// That IS the retry — no retry UI to build.
			statusEl.textContent = `Save failed (${response.status}): ${text}`;
			saveButton.disabled = false;
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		statusEl.textContent = `Save failed: ${message}`;
		saveButton.disabled = false;
	}
}

saveButton.addEventListener("click", () => {
	void onSave();
});

// --- permission gate --------------------------------------------------

enableButton.addEventListener("click", () => {
	// No await before this call — see motion.ts and the vault note.
	void requestMotionPermission().then((result) => {
		if (result === "granted" || result === "unsupported") {
			window.addEventListener("devicemotion", onMotion);
			gateSection.hidden = true;
			captureSection.hidden = false;
			return;
		}
		if (result === "denied") {
			gateStatus.textContent =
				"Motion access denied. If you didn't see a prompt, it's likely " +
				"off device-wide: Settings › Safari › Motion & " +
				"Orientation Access. If you tapped Don't Allow, recovering " +
				"needs Settings › Safari › Clear History and Website " +
				"Data.";
			return;
		}
		gateStatus.textContent = "Permission request failed. Try again.";
	});
});
