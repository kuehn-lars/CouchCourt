/**
 * The score and the serve as the phones show them (`MatchScore` in
 * `shared/protocol.ts`), read off the match state. Pure; `main.ts` sends it
 * whenever it changes.
 */

import type { MatchScore } from "../shared/protocol.ts";
import type { MatchState } from "../shared/sim/index.ts";

export function scoreLine(state: MatchState): MatchScore {
	const { score } = state;
	const tb = score.tiebreak;
	return {
		games: { near: score.games.near, far: score.games.far },
		points: tb
			? { near: String(tb.points.near), far: String(tb.points.far) }
			: { near: String(score.points.near), far: String(score.points.far) },
		serving: score.server,
		ball:
			state.phase !== "waiting-serve"
				? "play"
				: state.toss === null
					? "hand"
					: "toss",
	};
}

/** Whether two score lines would look the same on a phone. */
export function sameScoreLine(a: MatchScore | null, b: MatchScore): boolean {
	return (
		a !== null &&
		a.games.near === b.games.near &&
		a.games.far === b.games.far &&
		a.points.near === b.points.near &&
		a.points.far === b.points.far &&
		a.serving === b.serving &&
		a.ball === b.ball
	);
}
