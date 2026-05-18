export interface SentenceTiming {
	index: number;
	startTime: number;
	endTime: number;
	sourceStart: number;
	sourceEnd: number;
}

export interface Paragraph {
	index: number;
	sourceStart: number;
	sourceEnd: number;
	sourceText: string;
	strippedText: string;
	strippedToSource: Uint32Array;
	byteLength: number;
	headingLevel: number; // 0 = not a heading, 1-6 = ATX heading level
}

export interface TtsModel {
	id: string;
	maxRequestBytes: number;
}

export interface SynthResult {
	audio: ArrayBuffer;
	audioDurationSec: number;
	sentences: SentenceTiming[];
}

export interface CacheEntry {
	hash: string;
	sizeBytes: number;
	lastAccessedMs: number;
	textSnippet: string;
}

export interface CacheIndex {
	version: 1;
	entries: CacheEntry[];
	totalBytes: number;
}

export interface PluginSettings {
	voiceId: string;
	playbackRate: number;
	autoAdvance: boolean;
	prefetchLookahead: number;
	cacheMaxBytes: number;
	floatingPlayerPosition: { x: number; y: number } | null;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	voiceId: "Aoede",
	playbackRate: 1.0,
	autoAdvance: true,
	prefetchLookahead: 2,
	cacheMaxBytes: 500 * 1024 * 1024,
	floatingPlayerPosition: null,
};

// SecretStorage id for the Gemini API key. Lowercase alphanumeric with dashes
// only — colons and other characters are rejected by app.secretStorage.
export const GOOGLE_TTS_SECRET_ID = "tts-read-aloud-gemini-api-key";

export type PlaybackUiState = "idle" | "loading" | "playing" | "paused" | "error";
