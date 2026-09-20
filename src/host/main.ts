/**
 * The host entry point: the rAF loop, the socket wiring, the two state
 * references the renderer interpolates between, and the render call itself
 * (`llm-knowledge/modules/host.md` maps this whole folder). Not unit
 * tested — it is all DOM and socket I/O, and the one part worth testing
 * without a browser is `loop.ts`'s `advance`.
 *
 * The relay is our own server, not a phone: unlike `isControllerMessage` /
 * `isHostMessage` (the two directions the server itself guards, since a
 * phone's controller software is arbitrary), nothing here re-validates
 * `HostBoundMessage` shape-by-shape. See the session log for why that line
 * was drawn there and not here.
 */

import {
	type HostBoundMessage,
	type HostMessage,
	type PlayerId,
	PROTOCOL_VERSION,
	type Side,
} from "../shared/protocol.ts";
import {
	createMatch,
	type MatchState,
	type RallyInput,
	tick,
} from "../shared/sim/index.ts";
import { advance, FIXED_DT } from "./loop.ts";
import {
	createRenderer,
	detectEvents,
	type RenderEvent,
} from "./render/index.ts";

const canvas = document.getElementById("scene");
const uiRoot = document.getElementById("ui");
if (!(canvas instanceof HTMLCanvasElement) || uiRoot === null) {
	throw new Error("host/index.html is missing #scene or #ui");
}
const renderer = createRenderer(canvas, uiRoot);

const socket = new WebSocket(
	`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`,
);

function send(msg: HostMessage): void {
	if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

socket.addEventListener("open", () => {
	send({ t: "host-hello", v: PROTOCOL_VERSION });
});

// Which side each connected player is on. Nothing in the wire protocol picks
// who serves first (no lobby UI exists yet either, `host/ui/` is still a
// `.gitkeep`), so the match simply starts with "near" to serve.
const sides = new Map<PlayerId, Side>();
const pending: RallyInput[] = [];

let previous: MatchState = createMatch("near");
let current: MatchState = previous;

function playerIdFor(side: Side): PlayerId | undefined {
	for (const [id, playerSide] of sides) {
		if (playerSide === side) return id;
	}
	return undefined;
}

socket.addEventListener("message", (event) => {
	const msg = JSON.parse(event.data as string) as HostBoundMessage;
	switch (msg.t) {
		case "player-joined":
			sides.set(msg.playerId, msg.side);
			return;
		case "player-left":
			sides.delete(msg.playerId);
			return;
		case "swing": {
			const side = sides.get(msg.playerId);
			if (side) pending.push({ side, swing: msg.swing, time: current.time });
			return;
		}
	}
});

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
	if (swung) {
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
		for (const id of sides.keys())
			send({ t: "feedback", playerId: id, kind: "point" });
	}
}

let accumulator = 0;
let lastTime: number | undefined;

function frame(now: number): void {
	if (lastTime !== undefined) {
		const frameDt = (now - lastTime) / 1000;
		const result = advance(accumulator, frameDt);
		accumulator = result.accumulator;
		for (let i = 0; i < result.ticks; i++) {
			const input = pending.shift();
			runTick(input ? [input] : []);
		}
		renderer.render(previous, current, result.alpha, frameDt, frameEvents);
		frameEvents.length = 0;
	}
	lastTime = now;
	requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
