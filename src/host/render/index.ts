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

import type { MatchState } from "../../shared/sim/index.ts";
import type { CameraMode } from "./camera.ts";
import { buildCourt } from "./court.ts";
import { createEffects } from "./effects.ts";
import { createBallVisual, createPlayersVisual } from "./entities.ts";
import type { RenderEvent } from "./events.ts";
import { createScene } from "./scene.ts";
import { buildStadium } from "./stadium.ts";
import { createScoreUI } from "./ui.ts";

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
	const players = createPlayersVisual(scene);
	const effects = createEffects(scene);
	const scoreUI = createScoreUI(uiRoot);

	return {
		note: scoreUI.note,

		render(previous, current, alpha, dt, events, cameraMode) {
			for (const event of events) {
				switch (event.kind) {
					case "hit":
						players.swing(event.side, event.stroke, event.power);
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
