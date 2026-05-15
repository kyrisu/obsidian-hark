import { Notice } from "obsidian";
import type { Paragraph, SentenceTiming, SourceWord, SynthResult } from "../types";
import { splitSentences, type Sentence } from "../editor/sentenceSplitter";
import { cacheKey, sha256Hex } from "./Hash";
import {
	GeminiTtsError,
	MAX_REQUEST_BYTES,
	RequestAbortedError,
	RequestTooLargeError,
	synthesizeSpeech as defaultSynthesizeSpeech,
	type GeminiTtsRequest,
	type SpeechResult,
} from "./GeminiTtsClient";
import type { Cache } from "./Cache";

const MAX_SUB_CHUNK_BYTES = 4500;

type SynthesizeFn = (req: GeminiTtsRequest) => Promise<SpeechResult>;

export interface SynthesizerOptions {
	synthesizeSpeech?: SynthesizeFn;
}

export class Synthesizer {
	private inFlight = new Map<string, Promise<SynthResult>>();
	private oversizeNoticeShown = false;
	private readonly synthesizeSpeech: SynthesizeFn;

	constructor(
		private cache: Cache,
		private getGoogleKey: () => Promise<string>,
		opts: SynthesizerOptions = {},
	) {
		this.synthesizeSpeech = opts.synthesizeSpeech ?? defaultSynthesizeSpeech;
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
		const groups = binPackSentences(sentences, paragraph, MAX_SUB_CHUNK_BYTES, () =>
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

		const { audio, durationSec } = await this.synthesizeSpeech({ text, voiceId, apiKey, signal });
		if (signal?.aborted) throw new RequestAbortedError();

		const timings = distributeSentenceTimings(sentences, durationSec);

		const result: SynthResult = { audio, audioDurationSec: durationSec, sentences: timings };
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
	paragraph: Paragraph,
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
			for (const piece of splitOversizeSentence(sentence, paragraph, maxBytes)) {
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

function splitOversizeSentence(
	sentence: Sentence,
	paragraph: Paragraph,
	maxBytes: number,
): Sentence[] {
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
		const strippedStart = sentence.strippedStart + pieceStart;
		const strippedEnd = sentence.strippedStart + end;
		const sourceStart =
			paragraph.strippedToSource[strippedStart] ?? sentence.sourceStart;
		const sourceEnd =
			(paragraph.strippedToSource[strippedEnd - 1] ?? sentence.sourceEnd - 1) + 1;
		const wordsInPiece: SourceWord[] = sentence.words.filter(
			(w) => w.sourceStart >= sourceStart && w.sourceEnd <= sourceEnd,
		);
		pieces.push({
			strippedStart,
			strippedEnd,
			sourceStart,
			sourceEnd,
			text: pieceText,
			byteLength: encoder.encode(pieceText).byteLength,
			words: wordsInPiece,
		});
		pieceStart = end;
		while (pieceStart < text.length && /\s/.test(text.charAt(pieceStart))) pieceStart++;
	}
	return pieces;
}
