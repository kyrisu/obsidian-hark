import type { SentenceTiming } from "../types";
import type { TtsHighlightState } from "../editor/highlightExtension";
import { MAX_RATE, MIN_RATE } from "../playback/rate";
import { clamp } from "../utils/math";

const SENTENCE_EDGE_TOLERANCE = 0.05;

export type PlayerState = "idle" | "loading" | "playing" | "paused" | "ended" | "error";

export interface PlayerOptions {
	onHighlightChange?: (state: TtsHighlightState | null) => void;
	onStateChange?: (state: PlayerState, prev: PlayerState) => void;
	onEnded?: () => void;
	onError?: (err: unknown) => void;
}

export class Player {
	private audio: HTMLAudioElement | null = null;
	private sentences: SentenceTiming[] = [];
	private currentUrl: string | null = null;
	private rafHandle: number | null = null;
	private lastSentenceIdx = -1;
	private state: PlayerState = "idle";

	constructor(private options: PlayerOptions = {}) {}

	async load(audio: ArrayBuffer, sentences: SentenceTiming[]): Promise<void> {
		this.stop();
		this.setState("loading");
		this.sentences = sentences;
		const el = this.ensureAudio();
		const url = URL.createObjectURL(new Blob([audio], { type: "audio/wav" }));
		this.currentUrl = url;
		el.src = url;
		await new Promise<void>((resolve, reject) => {
			const onReady = () => {
				el.removeEventListener("loadedmetadata", onReady);
				el.removeEventListener("error", onErr);
				resolve();
			};
			const onErr = () => {
				el.removeEventListener("loadedmetadata", onReady);
				el.removeEventListener("error", onErr);
				URL.revokeObjectURL(url);
				if (this.currentUrl === url) this.currentUrl = null;
				reject(new Error("Failed to load audio for playback."));
			};
			el.addEventListener("loadedmetadata", onReady);
			el.addEventListener("error", onErr);
		});
	}

	play(): void {
		const el = this.audio;
		if (!el || !el.src) return;
		void el.play().then(
			() => {
				this.setState("playing");
				this.startFrameLoop();
			},
			(err) => {
				this.setState("error");
				this.options.onError?.(err);
			},
		);
	}

	pause(): void {
		const el = this.audio;
		if (!el) return;
		el.pause();
		this.stopFrameLoop();
		// Reset frame-loop dedup so the next resume re-emits the current highlight.
		this.lastSentenceIdx = -1;
		this.setState("paused");
	}

	stop(): void {
		this.stopFrameLoop();
		const el = this.audio;
		if (el) {
			el.pause();
			el.removeAttribute("src");
			el.load();
		}
		if (this.currentUrl) {
			URL.revokeObjectURL(this.currentUrl);
			this.currentUrl = null;
		}
		this.sentences = [];
		this.lastSentenceIdx = -1;
		this.options.onHighlightChange?.(null);
		this.setState("idle");
	}

	seek(seconds: number): void {
		const el = this.audio;
		if (!el) return;
		el.currentTime = Math.max(0, Math.min(seconds, el.duration || seconds));
	}

	setRate(rate: number): void {
		const clamped = clamp(rate, MIN_RATE, MAX_RATE);
		const el = this.audio;
		if (!el) return;
		el.playbackRate = clamped;
		// preservesPitch is a non-standard property on the element; Chromium honours it by default,
		// but setting it explicitly future-proofs against rendering engine changes.
		(el as unknown as { preservesPitch?: boolean }).preservesPitch = true;
	}

	get currentTime(): number {
		return this.audio?.currentTime ?? 0;
	}

	get duration(): number {
		return this.audio?.duration ?? 0;
	}

	get currentState(): PlayerState {
		return this.state;
	}

	dispose(): void {
		this.stop();
		this.audio = null;
	}

	private ensureAudio(): HTMLAudioElement {
		if (!this.audio) {
			const el = new Audio();
			el.preload = "auto";
			el.addEventListener("ended", () => {
				this.stopFrameLoop();
				this.setState("ended");
				this.options.onEnded?.();
			});
			el.addEventListener("error", () => {
				this.stopFrameLoop();
				this.setState("error");
				this.options.onError?.(el.error);
			});
			this.audio = el;
		}
		return this.audio;
	}

	private startFrameLoop(): void {
		this.stopFrameLoop();
		const tick = () => {
			this.rafHandle = null;
			this.emitHighlightForCurrentTime();
			if (this.state === "playing") {
				this.rafHandle = requestAnimationFrame(tick);
			}
		};
		this.rafHandle = requestAnimationFrame(tick);
	}

	private stopFrameLoop(): void {
		if (this.rafHandle !== null) {
			cancelAnimationFrame(this.rafHandle);
			this.rafHandle = null;
		}
	}

	private emitHighlightForCurrentTime(): void {
		const sentences = this.sentences;
		if (sentences.length === 0) return;
		const t = this.currentTime;
		const sIdx = findSentenceAt(sentences, t);
		if (sIdx === -1) {
			if (this.lastSentenceIdx !== -1) {
				this.lastSentenceIdx = -1;
				this.options.onHighlightChange?.(null);
			}
			return;
		}
		const s = sentences[sIdx];
		if (!s) return;
		if (sIdx === this.lastSentenceIdx) return;
		this.lastSentenceIdx = sIdx;
		this.options.onHighlightChange?.({
			sentence: { from: s.sourceStart, to: s.sourceEnd },
		});
	}

	private setState(next: PlayerState): void {
		if (this.state === next) return;
		const prev = this.state;
		this.state = next;
		this.options.onStateChange?.(next, prev);
	}
}

export function findSentenceAt(sentences: SentenceTiming[], t: number): number {
	if (sentences.length === 0) return -1;
	let lo = 0;
	let hi = sentences.length - 1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const s = sentences[mid];
		if (!s) return -1;
		if (t < s.startTime - SENTENCE_EDGE_TOLERANCE) hi = mid - 1;
		else if (t > s.endTime + SENTENCE_EDGE_TOLERANCE) lo = mid + 1;
		else return mid;
	}
	return -1;
}
