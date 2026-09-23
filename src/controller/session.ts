/**
 * The controller's socket: identity, reconnection and message routing.
 *
 * Built around one platform fact from
 * `llm-knowledge/platform/ios-safari-tab-suspension.md` — the socket WILL die
 * mid-match, when the phone locks, a notification arrives or Safari suspends
 * the tab. That is normal, so `playerId` lives in `sessionStorage` and is
 * replayed as `{ t: "hello", resume }` on every reconnect. Without it a player
 * who glances at a notification comes back as a stranger and loses their side.
 */

import {
	type ControllerBoundMessage,
	type ControllerMessage,
	type FeedbackKind,
	type MatchInfo,
	type PlayerId,
	PROTOCOL_VERSION,
	RELAY_PATH,
	type Side,
} from "../shared/protocol.ts";

const SESSION_KEY = "swingcourt-player-id";

export type SessionState =
	| "connecting"
	| "waiting"
	| "playing"
	| "reconnecting"
	| "rejected";

export interface Session {
	send(msg: ControllerMessage): void;
	side(): Side | null;
}

/**
 * 500ms doubling to a flat 8s. Capped rather than unbounded: a phone that was
 * in a pocket for ten minutes must come back promptly, not after a delay that
 * grew while nobody was watching.
 */
export function backoffMs(attempt: number): number {
	return Math.min(8000, 500 * 2 ** attempt);
}

export function createSession(handlers: {
	onState: (state: SessionState, detail?: string) => void;
	onSide: (side: Side) => void;
	/** The host's match state, relayed. The phone renders it and decides
	 * nothing from it — `llm-knowledge/decisions/0002-host-authoritative-simulation.md`. */
	onMatch?: (match: MatchInfo) => void;
	/** `hit` / `miss` / `point`, for the screen and, where the platform has
	 * one, the vibration motor. */
	onFeedback?: (kind: FeedbackKind) => void;
}): Session {
	let socket: WebSocket | null = null;
	let assignedSide: Side | null = null;
	let attempt = 0;
	// Set when the server tells us the session is unrecoverable. Stops the
	// reconnect loop from hammering a server that will keep saying no.
	let givenUp = false;
	// The pending backoff timer, if one is armed. Cleared at the top of every
	// `connect()` call so a foreground-triggered reconnect (or any other path
	// back into `connect()`) can never leave a frozen timer to fire later and
	// spin up a second, duplicate socket.
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

	const stored = (): PlayerId | null => {
		try {
			return sessionStorage.getItem(SESSION_KEY);
		} catch {
			// Private browsing can throw on access. A fresh identity is a worse
			// experience than a resumed one, not a broken one.
			return null;
		}
	};

	const remember = (id: PlayerId): void => {
		try {
			sessionStorage.setItem(SESSION_KEY, id);
		} catch {
			// Nothing to do: we simply cannot resume after a drop.
		}
	};

	const forget = (): void => {
		try {
			sessionStorage.removeItem(SESSION_KEY);
		} catch {
			// Already unreadable; nothing to clear.
		}
	};

	const send = (msg: ControllerMessage): void => {
		if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
	};

	function connect(): void {
		if (givenUp) return;
		// Whatever called us — the initial call, the foreground fast path, or
		// the backoff timer itself — supersedes any reconnect still pending.
		// Without this, a timer armed while backgrounded and frozen can thaw
		// after a foreground reconnect already happened and open a second,
		// duplicate socket.
		if (reconnectTimer !== null) {
			clearTimeout(reconnectTimer);
			reconnectTimer = null;
		}
		handlers.onState(attempt === 0 ? "connecting" : "reconnecting");

		const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${RELAY_PATH}`;
		const ws = new WebSocket(url);
		socket = ws;

		ws.addEventListener("open", () => {
			// A stale socket that outlived its replacement must not touch state
			// a newer connection already owns.
			if (ws !== socket) return;
			attempt = 0;
			const resume = stored();
			// Spread, not assign: exactOptionalPropertyTypes forbids an explicit
			// `resume: undefined` on an optional property.
			send({
				t: "hello",
				v: PROTOCOL_VERSION,
				...(resume !== null ? { resume } : {}),
			});
		});

		ws.addEventListener("message", (event) => {
			if (ws !== socket) return;
			// The relay is our own server, and it guards both inbound
			// directions itself. This edge has no third untrusted party on it,
			// exactly as `src/host/main.ts` argues for the host side.
			const msg = JSON.parse(event.data as string) as ControllerBoundMessage;
			switch (msg.t) {
				case "assigned":
					remember(msg.playerId);
					assignedSide = msg.side;
					handlers.onSide(msg.side);
					handlers.onState("waiting");
					return;
				case "rejected":
					if (msg.reason === "unknown-session") {
						// The server restarted and never heard of us. Drop the stale
						// identity and come back as a new player rather than
						// retrying a resume that can only fail again.
						forget();
						return;
					}
					givenUp = true;
					handlers.onState(
						"rejected",
						msg.reason === "full"
							? "Both sides are taken."
							: "This page is out of date. Reload it.",
					);
					return;
				case "match":
					handlers.onMatch?.({
						phase: msg.phase,
						server: msg.server,
						...(msg.winner !== undefined ? { winner: msg.winner } : {}),
						...(msg.score !== undefined ? { score: msg.score } : {}),
					});
					return;
				case "feedback":
					handlers.onFeedback?.(msg.kind);
					return;
				default:
					// `lobby` is not acted on in this scope: the host screen is
					// where the roster is read, and the phone has its own side
					// from `assigned`.
					return;
			}
		});

		ws.addEventListener("close", () => {
			// An orphaned socket's own eventual close must not clobber the live
			// socket a foreground reconnect already installed.
			if (ws !== socket) return;
			socket = null;
			if (givenUp) return;
			const delay = backoffMs(attempt);
			attempt += 1;
			handlers.onState("reconnecting");
			reconnectTimer = setTimeout(connect, delay);
		});
	}

	// Backgrounding is the early warning that the socket is about to die.
	// Reconnecting the moment we are visible again beats waiting for the
	// relay's 15s ping to notice. Checked on readyState, not just `=== null`:
	// the far more common ordering is that we foreground BEFORE the dead
	// socket's own `close` event has fired, so `socket` is still a CLOSING or
	// CLOSED object, not null — and waiting for `close` first means waiting
	// out the full backoff instead of reconnecting immediately.
	document.addEventListener("visibilitychange", () => {
		if (
			document.visibilityState === "visible" &&
			!givenUp &&
			(socket === null || socket.readyState !== WebSocket.OPEN)
		) {
			attempt = 0;
			connect();
		}
	});

	connect();

	return { send, side: () => assignedSide };
}
