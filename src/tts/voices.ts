export interface GeminiVoice {
	id: string;
	displayName: string;
	gender: "F" | "M" | "N";
}

export const GEMINI_VOICES: readonly GeminiVoice[] = [];
