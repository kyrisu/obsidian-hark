import type { Paragraph, SynthResult } from "../types";
import type { Cache } from "./Cache";

export class Synthesizer {
	constructor(
		private cache: Cache,
		private getGoogleKey: () => Promise<string>,
	) {
		void this.cache;
		void this.getGoogleKey;
	}

	async synthesize(
		_paragraph: Paragraph,
		_voiceId: string,
		_signal?: AbortSignal,
	): Promise<SynthResult> {
		throw new Error("Synthesizer.synthesize not implemented");
	}

	async synthesizeChunked(
		_paragraph: Paragraph,
		_voiceId: string,
		_signal?: AbortSignal,
	): Promise<SynthResult[]> {
		throw new Error("Synthesizer.synthesizeChunked not implemented");
	}
}
