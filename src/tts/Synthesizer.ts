import { Notice } from "obsidian";
import type { Paragraph, SentenceTiming, SynthResult } from "../types";
import { splitSentences, type Sentence } from "../editor/sentenceSplitter";
import { cacheKey, sha256Hex } from "./Hash";
import {
	GeminiTtsError,
	RequestAbortedError,
	RequestTooLargeError,
	synthesizeMp3 as defaultSynthesizeMp3,
	type GeminiTtsRequest,
} from "./GeminiTtsClient";
import type { Cache } from "./Cache";

const MAX_REQUEST_BYTES = 5000;
const MAX_SUB_CHUNK_BYTES = 4500;

type SynthesizeFn = (req: GeminiTtsRequest) => Promise<ArrayBuffer>;
type DurationProbe = (audio: ArrayBuffer) => Promise<number>;

export interface SynthesizerOptions {
	synthesizeMp3?: SynthesizeFn;
	probeAudioDuration?: DurationProbe;
}

export class Synthesizer {
	private inFlight = new Map<string, Promise<SynthResult>>();
	private oversizeNoticeShown = false;
	private readonly synthesizeMp3: SynthesizeFn;
	private readonly probeAudioDuration: DurationProbe;

	constructor(
		private cache: Cache,
		private getGoogleKey: () => Promise<string>,
		opts: SynthesizerOptions = {},
	) {
		this.synthesizeMp3 = opts.synthesizeMp3 ?? defaultSynthesizeMp3;
		this.probeAudioDuration = opts.probeAudioDuration ?? probeMp3Duration;
	}

	async synthesize(
		paragraph: Paragraph,
		voiceId: string,
		signal?: AbortSignal,
	): Promise<SynthResult> {
		if (paragraph.byteLength > MAX_REQUEST_BYTES) {
			throw new RequestTooLargeError(paragraph.byteLength);
		}
		const sentences = splitSentences(paragraph);
		return this.synthesizeOne(paragraph.strippedText, sentences, voiceId, signal);
	}

	async synthesizeChunked(
		paragraph: Paragraph,
		voiceId: string,
		signal?: AbortSignal,
	): Promise<SynthResult[]> {
		const sentences = splitSentences(paragraph);
		const groups = binPackSentences(sentences, MAX_SUB_CHUNK_BYTES, () =>
			this.notifyOversizeOnce(paragraph.index),
		);
		const results: SynthResult[] = [];
		for (const group of groups) {
			const text = group.map((s) => s.text).join(" ");
			const result = await this.synthesizeOne(text, group, voiceId, signal);
			results.push(result);
		}
		return results;
	}

	private async synthesizeOne(
		text: string,
		sentences: Sentence[],
		voiceId: string,
		signal?: AbortSignal,
	): Promise<SynthResult> {
		const hash = await sha256Hex(cacheKey(text, voiceId));

		const existing = this.inFlight.get(hash);
		if (existing) return existing;

		const promise = this.runSynthesis(hash, text, sentences, voiceId, signal).finally(() => {
			this.inFlight.delete(hash);
		});
		this.inFlight.set(hash, promise);
		return promise;
	}

	private async runSynthesis(
		hash: string,
		text: string,
		sentences: Sentence[],
		voiceId: string,
		signal?: AbortSignal,
	): Promise<SynthResult> {
		if (signal?.aborted) throw new RequestAbortedError();

		const cached = await this.cache.get(hash);
		if (cached) return cached;

		if (signal?.aborted) throw new RequestAbortedError();

		const apiKey = await this.getGoogleKey();
		if (!apiKey) throw new GeminiTtsError("Google API key is not configured.");

		const audio = await this.synthesizeMp3({ text, voiceId, apiKey, signal });
		if (signal?.aborted) throw new RequestAbortedError();

		const audioDurationSec = await this.probeAudioDuration(audio);
		const timings = distributeSentenceTimings(sentences, audioDurationSec);

		const result: SynthResult = { audio, audioDurationSec, sentences: timings };
		await this.cache.put(hash, text.slice(0, 80), result);
		return result;
	}

	private notifyOversizeOnce(paragraphIndex: number): void {
		if (this.oversizeNoticeShown) return;
		this.oversizeNoticeShown = true;
		new Notice(
			`Paragraph ${paragraphIndex + 1} contains a very long sentence — split mid-sentence; audio may have a brief click at the seam.`,
		);
	}
}

export function distributeSentenceTimings(
	sentences: Sentence[],
	audioDurationSec: number,
): SentenceTiming[] {
	const totalChars = sentences.reduce((s, x) => s + x.text.length, 0);
	if (totalChars === 0) return [];
	let cursor = 0;
	return sentences.map((s, i) => {
		const fraction = s.text.length / totalChars;
		const startTime = cursor;
		const endTime =
			i === sentences.length - 1 ? audioDurationSec : cursor + audioDurationSec * fraction;
		cursor = endTime;
		return {
			index: i,
			startTime,
			endTime,
			sourceStart: s.sourceStart,
			sourceEnd: s.sourceEnd,
			words: s.words,
		};
	});
}

export function binPackSentences(
	sentences: Sentence[],
	maxBytes: number,
	onMidSentenceSplit?: () => void,
): Sentence[][] {
	const groups: Sentence[][] = [];
	let current: Sentence[] = [];
	let currentBytes = 0;

	const flush = () => {
		if (current.length > 0) {
			groups.push(current);
			current = [];
			currentBytes = 0;
		}
	};

	for (const sentence of sentences) {
		if (sentence.byteLength > maxBytes) {
			flush();
			onMidSentenceSplit?.();
			for (const piece of splitOversizeSentence(sentence, maxBytes)) {
				groups.push([piece]);
			}
			continue;
		}
		if (currentBytes + sentence.byteLength > maxBytes) flush();
		current.push(sentence);
		currentBytes += sentence.byteLength;
	}
	flush();
	return groups;
}

function splitOversizeSentence(sentence: Sentence, maxBytes: number): Sentence[] {
	const text = sentence.text;
	const encoder = new TextEncoder();
	const pieces: Sentence[] = [];

	let pieceStart = 0;
	while (pieceStart < text.length) {
		let end = pieceStart;
		let bytes = 0;
		while (end < text.length) {
			const charBytes = encoder.encode(text.charAt(end)).byteLength;
			if (bytes + charBytes > maxBytes && end > pieceStart) break;
			bytes += charBytes;
			end++;
		}
		if (end < text.length) {
			let split = end;
			while (split > pieceStart && !/\s/.test(text.charAt(split - 1))) split--;
			if (split > pieceStart) end = split;
		}
		const pieceText = text.slice(pieceStart, end);
		const offsetWithinSentence = pieceStart;
		const wordsInPiece = sentence.words.filter((w) => {
			const wStart = w.sourceStart;
			const wEnd = w.sourceEnd;
			return wStart >= sentence.sourceStart + offsetWithinSentence && wEnd <= sentence.sourceStart + end;
		});
		pieces.push({
			strippedStart: sentence.strippedStart + pieceStart,
			strippedEnd: sentence.strippedStart + end,
			sourceStart: sentence.sourceStart + pieceStart,
			sourceEnd: sentence.sourceStart + end,
			text: pieceText,
			byteLength: encoder.encode(pieceText).byteLength,
			words: wordsInPiece,
		});
		pieceStart = end;
		while (pieceStart < text.length && /\s/.test(text.charAt(pieceStart))) pieceStart++;
	}
	return pieces;
}

async function probeMp3Duration(audio: ArrayBuffer): Promise<number> {
	const w = globalThis as unknown as {
		AudioContext?: typeof AudioContext;
		webkitAudioContext?: typeof AudioContext;
	};
	const Ctor = w.AudioContext ?? w.webkitAudioContext;
	if (Ctor) {
		const ctx = new Ctor();
		try {
			const buffer = await ctx.decodeAudioData(audio.slice(0));
			return buffer.duration;
		} catch {
			// fall through to HTMLAudioElement fallback
		} finally {
			await ctx.close().catch(() => undefined);
		}
	}
	return probeWithAudioElement(audio);
}

function probeWithAudioElement(audio: ArrayBuffer): Promise<number> {
	return new Promise((resolve, reject) => {
		const url = URL.createObjectURL(new Blob([audio], { type: "audio/mpeg" }));
		const el = new Audio();
		const cleanup = () => URL.revokeObjectURL(url);
		el.preload = "metadata";
		el.onloadedmetadata = () => {
			const d = el.duration;
			cleanup();
			resolve(d);
		};
		el.onerror = () => {
			cleanup();
			reject(new Error("Failed to probe MP3 duration via HTMLAudioElement."));
		};
		el.src = url;
	});
}
