export interface MediaSessionHandlers {
	togglePause: () => void;
	stop: () => void;
	skipNext: () => void;
	skipPrevious: () => void;
}

type PlaybackState = "playing" | "paused" | "none";

function mediaSession(): MediaSession | undefined {
	if (typeof navigator === "undefined") return undefined;
	return "mediaSession" in navigator ? navigator.mediaSession : undefined;
}

export function attachMediaSession(handlers: MediaSessionHandlers): () => void {
	const ms = mediaSession();
	if (!ms) return () => {};

	// `play`/`pause` both map to togglePause: the OS sends `play` when it believes
	// playback is paused and `pause` when it believes it is playing, driven by the
	// playbackState we publish — so a single toggle is unambiguous in practice.
	// Accepted wart (per release decision): a media-key skip while paused resumes
	// playback, because skipNext/skipPrevious flow advance → playCurrent → player.play().
	const actions: [MediaSessionAction, () => void][] = [
		["play", handlers.togglePause],
		["pause", handlers.togglePause],
		["stop", handlers.stop],
		["previoustrack", handlers.skipPrevious],
		["nexttrack", handlers.skipNext],
	];

	for (const [action, handler] of actions) {
		try {
			ms.setActionHandler(action, handler);
		} catch {
			// Older Electron/Chromium throws on actions it doesn't support (notably
			// `stop`); skip those rather than aborting the whole registration.
		}
	}

	return () => {
		const m = mediaSession();
		if (!m) return;
		for (const [action] of actions) {
			try {
				m.setActionHandler(action, null);
			} catch {
				// Same unsupported-action guard as above.
			}
		}
		m.metadata = null;
		m.playbackState = "none";
	};
}

export function setNowPlaying(meta: { title: string; artist: string } | null): void {
	const ms = mediaSession();
	if (!ms) return;
	if (!meta) {
		ms.metadata = null;
		return;
	}
	if (typeof MediaMetadata === "undefined") return;
	ms.metadata = new MediaMetadata({ title: meta.title, artist: meta.artist });
}

export function setPlaybackState(state: PlaybackState): void {
	const ms = mediaSession();
	if (!ms) return;
	ms.playbackState = state;
}
