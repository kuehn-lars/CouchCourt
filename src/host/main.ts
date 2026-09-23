/**
 * The host entry point: the match state machine, the rAF loop, the socket
 * wiring, the two state references the renderer interpolates between, and
 * the render call itself (`llm-knowledge/modules/host.md` maps this whole
 * folder). Not unit tested — it is all DOM and socket I/O, and the parts
 * worth testing without a browser are pure and live elsewhere: `loop.ts`,
 * `render/camera.ts`, and the whole of `shared/sim/`.
 *
 * The relay is our own server, not a phone: unlike `isControllerMessage` /
 * `isHostMessage` (the two directions the server itself guards, since a
 * phone's controller software is arbitrary), nothing here re-validates
 * `HostBoundMessage` shape-by-shape. See the session log for why that line
 * was drawn there and not here.
 *
 * ## The match state machine
 *
 * `lobby → countdown → playing → over → lobby`. The host owns it outright;
 * the server relays it to the phones and stores none of it
 * (`llm-knowledge/decisions/0002-host-authoritative-simulation.md`).
 */

import {
	type FeedbackKind,
	type HostBoundMessage,
	type HostMessage,
	type LobbyPlayer,
	type MatchPhase,
	type MatchScore,
	type PlayerId,
	PROTOCOL_VERSION,
	RELAY_PATH,
	type Side,
} from "../shared/protocol.ts";
import { type Bot, createBot } from "../shared/sim/bot.ts";
import {
	createMatch,
	type MatchState,
	other,
	type RallyInput,
	tick,
} from "../shared/sim/index.ts";
import { createAudio } from "./audio/index.ts";
import { advance, FIXED_DT } from "./loop.ts";
import { nextMode } from "./render/camera.ts";
import { detectEvents, type RenderEvent } from "./render/events.ts";
import { createRenderer } from "./render/index.ts";
import { sameScoreLine, scoreLine } from "./score-line.ts";
import { createLobbyUI } from "./ui/lobby.ts";
import {
	CAMERA_LABEL,
	createSettingsUI,
	type Opponent,
} from "./ui/settings.ts";

const canvas = document.getElementById("scene");
const uiRoot = document.getElementById("ui");
if (!(canvas instanceof HTMLCanvasElement) || uiRoot === null) {
	throw new Error("host/index.html is missing #scene or #ui");
}
const renderer = createRenderer(canvas, uiRoot);
const audio = createAudio();

const socket = new WebSocket(
	`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${RELAY_PATH}`,
);

function send(msg: HostMessage): void {
	if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

socket.addEventListener("open", () => {
	send({ t: "host-hello", v: PROTOCOL_VERSION });
});

// ---------------------------------------------------------------- match state

let phase: MatchPhase = "lobby";
let players: readonly LobbyPlayer[] = [];
/** The order players first announced themselves ready. The first of them
 * serves — the alternative was a coin toss nobody can see, and a toggle on a
 * screen nobody is standing at. */
const readyOrder: PlayerId[] = [];
let serverSide: Side = "near";
let winner: Side | null = null;
let bot: Bot | null = null;
let botSide: Side | null = null;
let countdownUntil = 0;
/** This match is played on a split screen. Fixed at the start, because the
 * sim's idea of "screen-left" is fixed with it (`shot.ts`, `screenLeftOf`). */
let split = false;

const pending: RallyInput[] = [];
let previous: MatchState = createMatch("near");
let current: MatchState = previous;

const JOIN_URL = `${location.origin}/controller/`;

/**
 * The machine's skill per settings choice. "match" is the tuned one — it
 * loses nearly 6 points in 10 to a decent player and wins nearly 6 in 10
 * from a newcomer, with rallies of eight to ten shots
 * (llm-knowledge/experiments/2026-09-22-stroke-direction-balance.md). The
 * other two are the same timing spread turned either way and are not
 * measured.
 */
const OPPONENT_SKILL: Readonly<Record<Opponent, number>> = {
	relaxed: 0.4,
	match: 0.65,
	tough: 0.85,
};

const settings = createSettingsUI(uiRoot, (next, change) => {
	if (change.camera) renderer.note(`Camera: ${CAMERA_LABEL[next.camera]}`);
	if (change.sound !== undefined) audio.setMuted(!next.sound);
	if (change.lobbyRally === false) demo = null;
});
audio.setMuted(!settings.get().sound);

/**
 * The lobby's rally: two machines playing each other behind the join panel,
 * on its own state so nothing about it can leak into a real match. No
 * sound (nobody has clicked anything yet, so the browser would not play it
 * anyway) and no feedback to phones. A finished set starts another.
 */
interface Demo {
	previous: MatchState;
	current: MatchState;
	readonly bots: readonly [Bot, Bot];
}
let demo: Demo | null = null;
const idle = createMatch("near");

function newDemo(): Demo {
	const state = createMatch("near");
	return {
		previous: state,
		current: state,
		bots: [createBot("near", 0.6), createBot("far", 0.6)],
	};
}

function demoTick(): void {
	demo ??= newDemo();
	const before = demo.current;
	const inputs: RallyInput[] = [];
	for (const [i, side] of (["near", "far"] as const).entries()) {
		const swing = demo.bots[i]?.swing(before) ?? null;
		if (swing) inputs.push({ side, swing, time: before.time });
	}
	demo.previous = before;
	demo.current = tick(before, inputs, FIXED_DT);
	frameEvents.push(...detectEvents(before, demo.current));
	if (demo.current.score.setWinner !== null) demo = null;
}

function sideFor(playerId: PlayerId): Side | undefined {
	return players.find((p) => p.playerId === playerId)?.side;
}

function playerIdFor(side: Side): PlayerId | undefined {
	return players.find((p) => p.side === side && p.connected)?.playerId;
}

/**
 * The side of a human player whose phone is not currently connected, or
 * `null`. While this is set mid-match the simulation is frozen: iOS drops
 * the socket whenever the phone locks or takes a notification
 * (`llm-knowledge/platform/ios-safari-tab-suspension.md`), and `PRODUCT.md`
 * asks that such a player come back as the same player rather than as a
 * spectator who lost four games in the meantime.
 */
function waitingFor(): Side | null {
	for (const player of players) {
		if (!player.connected && player.side !== botSide) return player.side;
	}
	return null;
}

/** The score line the phones were last told, so it is only re-sent when
 * something on it changed — a handful of times a point. */
let announced: MatchScore | null = null;

function announce(): void {
	const score = phase === "lobby" ? null : scoreLine(current);
	announced = score;
	send({
		t: "match",
		phase,
		server: serverSide,
		...(winner !== null ? { winner } : {}),
		...(score !== null ? { score } : {}),
	});
}

const lobbyUI = createLobbyUI(uiRoot, {
	onStart(solo) {
		// Every browser wants a gesture before it will make a sound, and this
		// button is the only one on the host screen.
		audio.resume();

		const ready = players.filter((p) => p.ready && p.connected);
		const first =
			ready.find((p) => p.playerId === readyOrder[0]) ?? ready[0] ?? null;
		if (!first) return;

		if (solo) {
			botSide = other(first.side);
			bot = createBot(botSide, OPPONENT_SKILL[settings.get().opponent]);
		} else {
			if (ready.length < 2) return;
			botSide = null;
			bot = null;
		}
		serverSide = first.side;
		split = !solo && settings.get().split;
		winner = null;
		phase = "countdown";
		countdownUntil = performance.now() + 3000;
		// The court the countdown shows is the one about to be played on:
		// the camera flies in from the lobby's crane to a fresh match.
		previous = createMatch(serverSide, split);
		current = previous;
		announce();
	},
	onRematch() {
		phase = "lobby";
		winner = null;
		bot = null;
		botSide = null;
		announce();
	},
});

socket.addEventListener("message", (event) => {
	const msg = JSON.parse(event.data as string) as HostBoundMessage;
	switch (msg.t) {
		case "lobby": {
			players = msg.players;
			for (const p of msg.players) {
				if (p.ready && !readyOrder.includes(p.playerId))
					readyOrder.push(p.playerId);
			}
			// A phone that just joined — or just resumed after its socket died
			// mid-match — has no idea what the match is doing. The roster
			// changing is the only signal the host gets that someone is newly
			// listening, so it re-announces then.
			announce();
			return;
		}
		case "swing": {
			if (phase !== "playing") return;
			const side = sideFor(msg.playerId);
			if (side) pending.push({ side, swing: msg.swing, time: current.time });
			return;
		}
	}
});

window.addEventListener("keydown", (event) => {
	// Cmd-F is the browser's find, not full screen.
	if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
	switch (event.key.toLowerCase()) {
		case "c":
			// Each half of a split screen is already its player's camera.
			if (split && phase !== "lobby") return;
			settings.set({ camera: nextMode(settings.get().camera) });
			return;
		case "f":
			settings.toggleFullscreen();
			return;
		case "s":
			settings.toggle();
			return;
	}
});

// ---------------------------------------------------------------- the frame

/** Render effects to draw once the frame's ticks are done, per `frame()`
 * below — cleared after every `renderer.render` call. */
const frameEvents: RenderEvent[] = [];

/**
 * Runs one fixed-step tick with every swing that arrived since the last one.
 * Feedback is read off the state, not off the input: under the contact model
 * an early swing is held until the ball arrives, so the tick a swing lands
 * on says nothing about whether it will connect.
 */
function runTick(inputs: readonly RallyInput[]): void {
	const before = current;
	previous = current;
	current = tick(before, inputs, FIXED_DT);
	frameEvents.push(...detectEvents(before, current));

	const stroke = current.stroke;
	// A new stroke, not a harder peak re-striking the same ball.
	if (stroke && stroke !== before.stroke && stroke.at !== before.stroke?.at) {
		feedback(stroke.side, "hit");
	}

	// `Score` is only ever replaced, never mutated in place (every
	// `awardPoint` call returns a new object) — reference inequality is
	// exactly "the score just changed" here.
	if (current.score !== before.score) {
		for (const side of ["near", "far"] as const) {
			feedback(side, side === current.lastPoint ? "point" : "miss");
		}
	}

	if (current.score.setWinner !== null && phase === "playing") {
		phase = "over";
		winner = current.score.setWinner;
		announce();
	} else if (
		// The only three things a score line is read from: checked first so a
		// tick that changed none of them builds nothing.
		(current.score !== before.score ||
			current.phase !== before.phase ||
			current.toss !== before.toss) &&
		!sameScoreLine(announced, scoreLine(current))
	) {
		announce();
	}
}

function feedback(side: Side, kind: FeedbackKind): void {
	if (side === botSide) return;
	const id = playerIdFor(side);
	if (id) send({ t: "feedback", playerId: id, kind });
}

let accumulator = 0;
let lastTime: number | undefined;

function frame(now: number): void {
	if (lastTime !== undefined) {
		const frameDt = (now - lastTime) / 1000;

		if (phase === "countdown" && now >= countdownUntil) {
			phase = "playing";
			previous = createMatch(serverSide, split);
			current = previous;
			pending.length = 0;
			accumulator = 0;
			announce();
		}

		const paused = phase === "playing" && waitingFor() !== null;
		// Drop the backlog rather than carrying it: a pause is the same case
		// as a restored suspended tab, and `advance`'s own catch-up cap exists
		// for exactly that reason (`llm-knowledge/modules/host.md`).
		if (paused) accumulator = 0;

		const result = advance(accumulator, paused ? 0 : frameDt);
		accumulator = result.accumulator;
		const rally = phase === "lobby" && settings.get().lobbyRally;
		for (let i = 0; i < result.ticks; i++) {
			if (rally) {
				demoTick();
				continue;
			}
			if (phase !== "playing") break;
			// The bot answers the same state the renderer draws and its swing
			// joins the same queue a phone's does — it has no privileged path
			// into the simulation. See `shared/sim/bot.ts`.
			const botInput = bot?.swing(current) ?? null;
			if (botInput && botSide) {
				pending.push({ side: botSide, swing: botInput, time: current.time });
			}
			runTick(pending.splice(0));
		}

		if (phase === "lobby") {
			const shown = demo ?? { previous: idle, current: idle };
			renderer.render(
				shown.previous,
				shown.current,
				result.alpha,
				frameDt,
				frameEvents,
				"attract",
			);
		} else {
			audio.play(frameEvents);
			renderer.render(
				previous,
				current,
				result.alpha,
				frameDt,
				frameEvents,
				phase === "over" ? "victory" : split ? "split" : settings.get().camera,
			);
		}
		frameEvents.length = 0;

		lobbyUI.update({
			phase,
			players,
			countdown: Math.ceil((countdownUntil - now) / 1000),
			winner,
			games: current.score.games,
			botSide,
			waitingFor: waitingFor(),
			joinUrl: JOIN_URL,
		});
	}
	lastTime = now;
	requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
