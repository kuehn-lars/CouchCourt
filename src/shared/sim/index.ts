/**
 * The sim module's public surface: everything a consumer (the host's render
 * loop, phase 7) needs, from one import path instead of six. No logic of its
 * own — that would make this file exactly the kind of thing
 * `llm-knowledge/decisions/0002-host-authoritative-simulation.md` warns
 * about duplicating, a second place the boundary could quietly leak from.
 */

export * from "./ball.ts";
export * from "./court.ts";
export * from "./players.ts";
export * from "./rally.ts";
export * from "./scoring.ts";
export * from "./shot.ts";
export * from "./state.ts";
