export class VoicePreview {
	constructor(private getGoogleKey: () => Promise<string>) {
		void this.getGoogleKey;
	}

	async play(_voiceId: string): Promise<void> {}

	stop(): void {}

	dispose(): void {}
}
