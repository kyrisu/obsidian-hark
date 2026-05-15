export interface GeminiVoice {
	id: string; // voiceName accepted by the Gemini TTS generateContent API
	displayName: string;
	gender: "F" | "M" | "N";
}

// Gemini 2.5 Flash TTS prebuilt voices, English.
// The Gemini Developer API (generativelanguage.googleapis.com) selects a voice
// by its bare name (e.g. "Aoede"), unlike Cloud TTS which uses fully-qualified
// names. Curated subset of the prebuilt voice list, retrieved 2026-05-15.
export const GEMINI_VOICES: readonly GeminiVoice[] = [
	{ id: "Aoede", displayName: "Aoede", gender: "F" },
	{ id: "Kore", displayName: "Kore", gender: "F" },
	{ id: "Leda", displayName: "Leda", gender: "F" },
	{ id: "Zephyr", displayName: "Zephyr", gender: "F" },
	{ id: "Charon", displayName: "Charon", gender: "M" },
	{ id: "Fenrir", displayName: "Fenrir", gender: "M" },
	{ id: "Orus", displayName: "Orus", gender: "M" },
	{ id: "Puck", displayName: "Puck", gender: "M" },
];
