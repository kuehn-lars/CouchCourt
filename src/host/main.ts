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
	type HostBoundMessage,
	type HostMessage,
	type LobbyPlayer,
	type MatchPhase,
	type PlayerId,
	PROTOCOL_VERSION,
	type Side,
} from "../shared/protocol.ts";
import { type Bot, createBot } from "../shared/sim/bot.ts";
import {
	createMatch,
	type MatchState,
	type RallyInput,
	tick,
} from "../shared/sim/index.ts";
import { createAudio } from "./audio/index.ts";
import { advance, FIXED_DT } from "./loop.ts";
import { type CameraMode, nextMode } from "./render/camera.ts";
import {
	createRenderer,
	detectEvents,
	type RenderEvent,
} from "./render/index.ts";
import { createLobbyUI } from "./ui/lobby.ts";

const canvas = document.getElementById("scene");
const uiRoot = document.getElementById("ui");
if (!(canvas instanceof HTMLCanvasElement) || uiRoot === null) {
	throw new Error("host/index.html is missing #scene or #ui");
}
const renderer = createRenderer(canvas, uiRoot);
const audio = createAudio();

const socket = new WebSocket(
	`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`,
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
let cameraMode: CameraMode = "broadcast";

const pending: RallyInput[] = [];
let previous: MatchState = createMatch("near");
let current: MatchState = previous;

const JOIN_URL = `${location.origin}/controller/`;

const CAMERA_LABEL: Record<CameraMode, string> = {
	broadcast: "Broadcast",
	follow: "Follow the ball",
	side: "Side on",
};

const other = (side: Side): Side => (side === "near" ? "far" : "near");

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

function announce(): void {
	send({
		t: "match",
		phase,
		server: serverSide,
		...(winner !== null ? { winner } : {}),
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
			// 0.7 rallies for about nine shots against a competent player, and
			// loses points — see llm-knowledge/modules/shared-sim.md.
			bot = createBot(botSide, 0.7);
		} else {
			if (ready.length < 2) return;
			botSide = null;
			bot = null;
		}
		serverSide = first.side;
		winner = null;
		phase = "countdown";
		countdownUntil = performance.now() + 3000;
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
	if (event.key === "c" || event.key === "C") {
		cameraMode = nextMode(cameraMode);
		renderer.note(`Camera: ${CAMERA_LABEL[cameraMode]}`);
	}
	if (event.key === "f" || event.key === "F") {
		if (document.fullscreenElement) void document.exitFullscreen();
		else void document.documentElement.requestFullscreen();
	}
});

// ---------------------------------------------------------------- the frame

/** Render effects to draw once the frame's ticks are done, per `frame()`
 * below — cleared after every `renderer.render` call. */
const frameEvents: RenderEvent[] = [];

/**
 * Runs one fixed-step tick. `inputs` holds at most one swing — the queue is
 * drained one input per tick rather than dumped into the frame's first tick,
 * so a `hit`/`miss` feedback message can be attributed to the exact swing
 * that caused it (see the session log; two swings landing in the same ~8ms
 * tick is not a case v1's single-ball, no-doubles rules need to handle).
 */
function runTick(inputs: readonly RallyInput[]): void {
	const before = current;
	previous = current;
	current = tick(before, inputs, FIXED_DT);
	frameEvents.push(...detectEvents(before, current));

	const swung = inputs[0];
	if (swung && swung.side !== botSide) {
		const id = playerIdFor(swung.side);
		if (id) {
			send({
				t: "feedback",
				playerId: id,
				kind: current.toHit !== before.toHit ? "hit" : "miss",
			});
		}
	}

	// `Score` is only ever replaced, never mutated in place (every
	// `awardPoint` call returns a new object) — reference inequality is
	// exactly "the score just changed" here.
	if (current.score !== before.score) {
		for (const player of players)
			send({ t: "feedback", playerId: player.playerId, kind: "point" });
	}

	if (current.score.setWinner !== null && phase === "playing") {
		phase = "over";
		winner = current.score.setWinner;
		announce();
	}
}

let accumulator = 0;
let lastTime: number | undefined;

function frame(now: number): void {
	if (lastTime !== undefined) {
		const frameDt = (now - lastTime) / 1000;

		if (phase === "countdown" && now >= countdownUntil) {
			phase = "playing";
			previous = createMatch(serverSide);
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
		for (let i = 0; i < result.ticks; i++) {
			if (phase !== "playing") break;
			// The bot answers the same state the renderer draws and its swing
			// joins the same queue a phone's does — it has no privileged path
			// into the simulation. See `shared/sim/bot.ts`.
			const botInput = bot?.swing(current) ?? null;
			if (botInput && botSide) {
				pending.push({ side: botSide, swing: botInput, time: current.time });
			}
			const input = pending.shift();
			runTick(input ? [input] : []);
		}

		audio.play(frameEvents);
		renderer.render(
			previous,
			current,
			result.alpha,
			frameDt,
			frameEvents,
			cameraMode,
		);
		frameEvents.length = 0;

		lobbyUI.update({
			phase,
			players,
			countdown: Math.ceil((countdownUntil - now) / 1000),
			winner,
			botSide,
			waitingFor: waitingFor(),
			joinUrl: JOIN_URL,
		});
	}
	lastTime = now;
	requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
