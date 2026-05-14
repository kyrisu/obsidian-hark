export interface SourceWord {
	text: string;
	sourceStart: number;
	sourceEnd: number;
}

export interface SentenceTiming {
	index: number;
	startTime: number;
	endTime: number;
	sourceStart: number;
	sourceEnd: number;
	words: SourceWord[];
}

export interface Paragraph {
	index: number;
	sourceStart: number;
	sourceEnd: number;
	sourceText: string;
	strippedText: string;
	strippedToSource: Uint32Array;
	byteLength: number;
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
	googleApiKeyName: string;
	voiceId: string;
	playbackRate: number;
	autoAdvance: boolean;
	prefetchLookahead: number;
	cacheMaxBytes: number;
	floatingPlayerPosition: { x: number; y: number } | null;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	googleApiKeyName: "tts-read-aloud:google",
	voiceId: "",
	playbackRate: 1.0,
	autoAdvance: true,
	prefetchLookahead: 2,
	cacheMaxBytes: 500 * 1024 * 1024,
	floatingPlayerPosition: null,
};

export const PLUGIN_LANGUAGE = "en-US";

export type PlaybackUiState = "idle" | "loading" | "playing" | "paused" | "error";
