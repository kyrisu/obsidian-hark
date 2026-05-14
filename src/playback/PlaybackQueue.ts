import type { Paragraph, SynthResult } from "../types";
import { MAX_REQUEST_BYTES, Synthesizer } from "../tts/Synthesizer";
import { RequestAbortedError } from "../tts/GeminiTtsClient";
import type { Player } from "./Player";

export type QueueState = "idle" | "loading" | "playing" | "paused" | "ended" | "error";

interface PrefetchEntry {
	controller: AbortController;
	promise: Promise<SynthResult[]>;
}

export interface PlaybackQueueOptions {
	prefetchLookahead: number;
	autoAdvance: boolean;
	onStateChange?: (state: QueueState) => void;
	onError?: (err: unknown) => void;
	onPositionChange?: (paragraphIdx: number, subChunkIdx: number) => void;
	onClearHighlight?: () => void;
}

export class PlaybackQueue {
	private prefetch = new Map<number, PrefetchEntry>();
	private chunkResults = new Map<number, SynthResult[]>();
	private cursor: { paragraphIdx: number; subChunkIdx: number } | null = null;
	private state: QueueState = "idle";

	constructor(
		private readonly paragraphs: Paragraph[],
		private readonly voiceId: string,
		private readonly synthesizer: Synthesizer,
		private readonly player: Player,
		private readonly options: PlaybackQueueOptions,
	) {}

	async play(fromParagraphIdx: number): Promise<void> {
		if (fromParagraphIdx < 0 || fromParagraphIdx >= this.paragraphs.length) return;
		this.cursor = { paragraphIdx: fromParagraphIdx, subChunkIdx: 0 };
		this.setState("loading");
		await this.playCurrent();
		this.spawnPrefetchFrom(fromParagraphIdx + 1);
	}

	togglePause(): void {
		if (this.state === "playing") this.pause();
		else if (this.state === "paused") this.resume();
	}

	pause(): void {
		if (this.state !== "playing") return;
		this.player.pause();
		this.options.onClearHighlight?.();
		this.setState("paused");
	}

	resume(): void {
		if (this.state !== "paused") return;
		this.player.play();
		this.setState("playing");
	}

	stop(): void {
		for (const [, entry] of this.prefetch) entry.controller.abort();
		this.prefetch.clear();
		this.chunkResults.clear();
		this.cursor = null;
		this.player.stop();
		this.setState("idle");
	}

	async skipNext(): Promise<void> {
		if (!this.cursor) return;
		await this.advance();
	}

	async skipPrevious(): Promise<void> {
		if (!this.cursor) return;
		if (this.cursor.subChunkIdx > 0) {
			this.cursor.subChunkIdx -= 1;
		} else if (this.cursor.paragraphIdx > 0) {
			this.cursor.paragraphIdx -= 1;
			this.cursor.subChunkIdx = 0;
		} else {
			return;
		}
		await this.playCurrent();
	}

	invalidatePrefetch(paragraphIdx: number): void {
		const entry = this.prefetch.get(paragraphIdx);
		if (entry) {
			entry.controller.abort();
			this.prefetch.delete(paragraphIdx);
		}
		this.chunkResults.delete(paragraphIdx);
	}

	affectedRange(): { from: number; to: number } | null {
		if (!this.cursor) return null;
		const p = this.paragraphs[this.cursor.paragraphIdx];
		return p ? { from: p.sourceStart, to: p.sourceEnd } : null;
	}

	prefetchedRanges(): { index: number; from: number; to: number }[] {
		const out: { index: number; from: number; to: number }[] = [];
		for (const idx of this.prefetch.keys()) {
			const p = this.paragraphs[idx];
			if (p) out.push({ index: idx, from: p.sourceStart, to: p.sourceEnd });
		}
		return out;
	}

	get currentState(): QueueState {
		return this.state;
	}

	get position(): { paragraphIdx: number; subChunkIdx: number } | null {
		return this.cursor ? { ...this.cursor } : null;
	}

	private async playCurrent(): Promise<void> {
		if (!this.cursor) return;
		const { paragraphIdx, subChunkIdx } = this.cursor;
		try {
			const chunks = await this.ensureChunksFor(paragraphIdx);
			if (!this.cursor || this.cursor.paragraphIdx !== paragraphIdx) return;
			const chunk = chunks[subChunkIdx];
			if (!chunk) {
				await this.advance();
				return;
			}
			await this.player.load(chunk.audio, chunk.sentences);
			this.options.onPositionChange?.(paragraphIdx, subChunkIdx);
			this.player.play();
			this.setState("playing");
		} catch (err) {
			if (err instanceof RequestAbortedError) return;
			if (!this.cursor) return;
			this.setState("error");
			this.options.onError?.(err);
		}
	}

	private async ensureChunksFor(paragraphIdx: number): Promise<SynthResult[]> {
		const cached = this.chunkResults.get(paragraphIdx);
		if (cached) return cached;
		const existing = this.prefetch.get(paragraphIdx);
		if (existing) {
			const chunks = await existing.promise;
			this.chunkResults.set(paragraphIdx, chunks);
			return chunks;
		}
		const entry = this.startSynthesisFor(paragraphIdx);
		const chunks = await entry.promise;
		this.chunkResults.set(paragraphIdx, chunks);
		return chunks;
	}

	private startSynthesisFor(paragraphIdx: number): PrefetchEntry {
		const paragraph = this.paragraphs[paragraphIdx];
		const controller = new AbortController();
		const promise = paragraph
			? this.synthesizeParagraph(paragraph, controller.signal).finally(() => {
					const current = this.prefetch.get(paragraphIdx);
					if (current && current.controller === controller) {
						this.prefetch.delete(paragraphIdx);
					}
				})
			: Promise.resolve<SynthResult[]>([]);
		const entry: PrefetchEntry = { controller, promise };
		this.prefetch.set(paragraphIdx, entry);
		return entry;
	}

	private async synthesizeParagraph(
		paragraph: Paragraph,
		signal: AbortSignal,
	): Promise<SynthResult[]> {
		if (paragraph.byteLength > MAX_REQUEST_BYTES) {
			return this.synthesizer.synthesizeChunked(paragraph, this.voiceId, signal);
		}
		const single = await this.synthesizer.synthesize(paragraph, this.voiceId, signal);
		return [single];
	}

	private spawnPrefetchFrom(startIdx: number): void {
		const end = Math.min(this.paragraphs.length, startIdx + this.options.prefetchLookahead);
		for (let i = startIdx; i < end; i++) {
			if (this.prefetch.has(i) || this.chunkResults.has(i)) continue;
			const entry = this.startSynthesisFor(i);
			entry.promise.catch((err) => {
				if (!(err instanceof RequestAbortedError)) this.options.onError?.(err);
			});
		}
	}

	private async advance(): Promise<void> {
		if (!this.cursor) return;
		const chunks = this.chunkResults.get(this.cursor.paragraphIdx);
		const hasNextSubChunk = chunks ? this.cursor.subChunkIdx + 1 < chunks.length : false;
		if (hasNextSubChunk) {
			this.cursor.subChunkIdx += 1;
			await this.playCurrent();
			return;
		}
		const nextParagraphIdx = this.cursor.paragraphIdx + 1;
		if (nextParagraphIdx >= this.paragraphs.length) {
			this.cursor = null;
			this.setState("ended");
			return;
		}
		this.cursor = { paragraphIdx: nextParagraphIdx, subChunkIdx: 0 };
		await this.playCurrent();
		this.spawnPrefetchFrom(nextParagraphIdx + 1);
	}

	handleTrackEnded = (): void => {
		if (!this.options.autoAdvance) {
			this.setState("ended");
			return;
		}
		void this.advance();
	};

	private setState(next: QueueState): void {
		if (this.state === next) return;
		this.state = next;
		this.options.onStateChange?.(next);
	}
}
