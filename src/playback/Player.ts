import type { SentenceTiming } from "../types";

export class Player {
	load(_audio: ArrayBuffer, _sentences: SentenceTiming[]): void {}
	play(): void {}
	pause(): void {}
	stop(): void {}
	seek(_seconds: number): void {}
	setRate(_rate: number): void {}
	get currentTime(): number {
		return 0;
	}
	get duration(): number {
		return 0;
	}
}
