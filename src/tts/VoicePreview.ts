import { GeminiTtsError, synthesizeSpeech } from "./GeminiTtsClient";

const PREVIEW_PHRASE = "The quick brown fox jumped over the lazy dog.";

export class VoicePreview {
	private blobs = new Map<string, Blob>();
	private audio = new Audio();
	private currentUrl: string | null = null;

	constructor(private getGoogleKey: () => Promise<string>) {}

	async play(voiceId: string): Promise<void> {
		this.stop();
		let blob = this.blobs.get(voiceId);
		if (!blob) {
			const apiKey = await this.getGoogleKey();
			if (!apiKey)
				throw new GeminiTtsError("Set your Gemini API key first.");
			const { audio } = await synthesizeSpeech({
				text: PREVIEW_PHRASE,
				voiceId,
				apiKey,
			});
			blob = new Blob([audio], { type: "audio/wav" });
			this.blobs.set(voiceId, blob);
		}
		const url = URL.createObjectURL(blob);
		this.currentUrl = url;
		this.audio.src = url;
		await this.audio.play();
	}

	stop(): void {
		this.audio.pause();
		this.audio.currentTime = 0;
		if (this.currentUrl) {
			URL.revokeObjectURL(this.currentUrl);
			this.currentUrl = null;
		}
	}

	dispose(): void {
		this.stop();
		this.audio.removeAttribute("src");
		this.blobs.clear();
	}
}
