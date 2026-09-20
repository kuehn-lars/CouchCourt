/**
 * Ties the renderer together: scene, court, ball, players and effects, plus
 * the DOM score overlay. `createRenderer` builds everything once; the
 * returned `render` is the only thing called every frame, from `main.ts`.
 *
 * Reads simulation state, never writes it — no renderer interface, one
 * implementation, per `llm-knowledge/decisions/0003-threejs-renderer.md`.
 * Not unit-tested for the same reason `main.ts` isn't: DOM- and
 * canvas-shaped wiring, not pure logic (`CLAUDE.md` §3).
 */

import type { Side } from "../../shared/protocol.ts";
import { BASELINE_Z } from "../../shared/sim/court.ts";
import type { MatchState } from "../../shared/sim/index.ts";
import type { Vec3 } from "../../shared/sim/state.ts";
import type { CameraMode } from "./camera.ts";
import { buildCourt } from "./court.ts";
import { createEffects } from "./effects.ts";
import { createBallVisual, createPlayersVisual } from "./entities.ts";
import { createScene } from "./scene.ts";
import { buildStadium } from "./stadium.ts";
import { createScoreUI } from "./ui.ts";

export type RenderEvent =
	| { readonly kind: "hit"; readonly side: Side; readonly position: Vec3 }
	| { readonly kind: "bounce"; readonly position: Vec3 }
	| { readonly kind: "point" };

/** Ball must be this low, metres, and moving upward, to count as a bounce.
 * A heuristic on the interpolated ball state, not a sim event — cosmetic
 * only, see the phase 8 session log for why `MatchState` doesn't carry a
 * "bounced this tick" flag of its own. */
const BOUNCE_HEIGHT = 0.2;

/** Diffs two consecutive tick states into the effects worth drawing. Mirrors
 * `main.ts`'s own `hit`/`point` feedback derivation (`toHit` flip, `score`
 * reference change) rather than adding a second notion of what a hit is. */
export function detectEvents(
	before: MatchState,
	current: MatchState,
): RenderEvent[] {
	const events: RenderEvent[] = [];

	if (before.toHit !== current.toHit) {
		events.push({ kind: "hit", side: before.toHit, position: current.ball.p });
	}
	if (
		before.ball.v.y < 0 &&
		current.ball.v.y > 0 &&
		current.ball.p.y < BOUNCE_HEIGHT
	) {
		events.push({ kind: "bounce", position: current.ball.p });
	}
	if (before.score !== current.score) {
		events.push({ kind: "point" });
	}
	return events;
}

export interface Renderer {
	/** A brief line at the bottom of the screen. */
	note(text: string): void;
	render(
		previous: MatchState,
		current: MatchState,
		alpha: number,
		dt: number,
		events: readonly RenderEvent[],
		cameraMode: CameraMode,
	): void;
}

export function createRenderer(
	canvas: HTMLCanvasElement,
	uiRoot: HTMLElement,
): Renderer {
	const { scene, camera, renderer, updateCamera } = createScene(canvas);
	scene.add(buildStadium());
	scene.add(buildCourt());

	const ball = createBallVisual(scene);
	const players = createPlayersVisual(scene, {
		near: BASELINE_Z,
		far: -BASELINE_Z,
	});
	const effects = createEffects(scene);
	const scoreUI = createScoreUI(uiRoot);

	return {
		note: scoreUI.note,

		render(previous, current, alpha, dt, events, cameraMode) {
			for (const event of events) {
				switch (event.kind) {
					case "hit":
						players.swing(event.side);
						effects.hit(event.position);
						break;
					case "bounce":
						effects.bounce(event.position);
						break;
					case "point":
						break;
				}
			}

			const ballPos = ball.update(previous.ball, current.ball, alpha);
			players.update(previous.players, current.players, alpha, dt);
			effects.update(dt);
			scoreUI.update(current.score);
			updateCamera(cameraMode, ballPos);

			renderer.render(scene, camera);
		},
	};
}
