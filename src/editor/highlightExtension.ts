export interface TtsHighlightState {
	sentence: { from: number; to: number };
	word: { from: number; to: number } | null;
}
