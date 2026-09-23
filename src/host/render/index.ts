/**
 * Ties the renderer together: scene and cameras, court, stadium, ball,
 * players and effects, plus the DOM score overlay. `createRenderer` builds
 * everything once; the returned `render` is the only thing called every
 * frame, from `main.ts`.
 *
 * Reads simulation state, never writes it — no renderer interface, one
 * implementation, per `llm-knowledge/decisions/0003-threejs-renderer.md`.
 * What it looks like, and which of the old renderer rules that overturned,
 * is `llm-knowledge/decisions/0018-stylised-stadium-renderer.md`.
 */

import type { MatchState, Vec3 } from "../../shared/sim/index.ts";
import { createBallVisual } from "./ball.ts";
import { buildCourt } from "./court.ts";
import { createEffects } from "./effects.ts";
import { type RenderEvent, strokeAnim } from "./events.ts";
import { buildOfficials } from "./officials.ts";
import { createPlayersVisual } from "./players.ts";
import { type CameraShot, createScene } from "./scene.ts";
import { buildStadium } from "./stadium.ts";
import { createScoreUI } from "./ui.ts";

export type { CameraShot } from "./scene.ts";

export interface Renderer {
	/** A brief line at the bottom of the screen. */
	note(text: string): void;
	render(
		previous: MatchState,
		current: MatchState,
		alpha: number,
		dt: number,
		events: readonly RenderEvent[],
		/** `"attract"` is the lobby: the lobby's rally is drawn, and the
		 * score overlay is hidden, because that score is nobody's. */
		shot: CameraShot,
	): void;
}

export function createRenderer(
	canvas: HTMLCanvasElement,
	uiRoot: HTMLElement,
): Renderer {
	const world = createScene(canvas);
	const { scene } = world;
	const stadium = buildStadium();
	scene.add(stadium.group);
	const court = buildCourt();
	scene.add(court.group);
	const officials = buildOfficials();
	scene.add(officials.group);

	const ball = createBallVisual(scene);
	const players = createPlayersVisual(scene);
	const effects = createEffects(scene);
	const scoreUI = createScoreUI(uiRoot);

	/** The crowd's mood, 0..1: up on a point, easing back down. */
	let excite = 0;
	/** How long the current rally has gone, in strokes: flashes build. */
	let rally = 0;
	/** Seconds to the next burst of confetti on the victory shot. */
	let confettiIn = 0;

	return {
		note: scoreUI.note,

		render(previous, current, alpha, dt, events, shot) {
			const attract = shot === "attract";
			let struckAt: Vec3 | null = null;
			for (const event of events) {
				switch (event.kind) {
					case "hit": {
						struckAt = event.position;
						if (event.revised) break;
						const smash = event.stroke === "smash";
						players.swing(event.side, event.stroke, event.power);
						effects.hit(event.position, event.power, event.side, smash);
						ball.squash(0.5 + event.power * 0.4);
						rally += 1;
						if (!attract && (smash || event.power > 0.85)) {
							world.shake(smash ? 0.9 : 0.35);
							world.punch(smash ? 1 : 0.5);
						}
						break;
					}
					case "whiff":
						players.swing(event.side, event.stroke, 0.7);
						break;
					case "bounce":
						effects.bounce(event.position, current.ball.v);
						ball.squash(0.9);
						break;
					case "point": {
						const winner = current.lastPoint;
						if (winner) {
							players.react(winner);
							if (!attract) effects.confetti(winner);
						}
						excite = attract ? 0.5 : 1;
						rally = 0;
						break;
					}
					case "toss":
						break;
				}
			}
			excite *= Math.exp(-dt * 0.7);

			const ballPos = ball.update(
				previous.ball,
				current.ball,
				alpha,
				dt,
				struckAt,
			);
			const c = current.contact;
			players.update(previous.players, current.players, alpha, dt, {
				ready:
					c === null
						? null
						: {
								side: c.side,
								stroke: strokeAnim({ kind: c.stroke, air: c.air }),
								inSeconds: c.at - current.time,
							},
				tossing: current.toss !== null ? current.toHit : null,
				serving:
					current.phase === "waiting-serve" && current.toss === null
						? current.toHit
						: null,
			});

			officials.update(ballPos, dt);
			court.setSplit(shot === "split");

			const flashes = Math.min(1, 0.08 + rally * 0.05 + excite * 0.8);
			stadium.update(dt, excite, attract ? 1 : 0, flashes);

			const match = !attract;
			scoreUI.setVisible(match);
			scoreUI.setSplit(shot === "split");
			if (match) scoreUI.update(current.score);

			const winner = current.score.setWinner;
			if (shot === "victory" && winner) {
				players.celebrate(winner);
				confettiIn -= dt;
				if (confettiIn <= 0) {
					effects.confetti(winner);
					confettiIn = 2.4;
				}
			}
			const views = world.updateCameras(shot, ballPos, players.at, winner, dt);
			const first = views[0];
			if (first) effects.update(dt, first.camera);
			world.draw(views, dt);
		},
	};
}
