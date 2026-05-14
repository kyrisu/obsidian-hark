export class PlaybackQueue {
	pause(): void {}
	stop(): void {}
	togglePause(): void {}
	skipNext(): void {}
	skipPrevious(): void {}
	invalidatePrefetch(_paragraphIndex: number): void {}
	affectedRange(): { from: number; to: number } | null {
		return null;
	}
	prefetchedRanges(): { index: number; from: number; to: number }[] {
		return [];
	}
}
