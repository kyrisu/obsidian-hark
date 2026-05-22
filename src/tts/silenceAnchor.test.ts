import { describe, expect, it } from "vitest";
import { anchorSentenceTimings, detectSilences } from "./silenceAnchor";
import { distributeSentenceTimings } from "./Synthesizer";
import type { Sentence } from "../editor/sentenceSplitter";

const SR = 24000;
const TONE_AMPLITUDE = 8000;

interface Span {
	silent: boolean;
	sec: number;
}

function buildPcm(spans: Span[], sampleRate = SR): ArrayBuffer {
	const total = spans.reduce((n, s) => n + Math.round(s.sec * sampleRate), 0);
	const samples = new Int16Array(total);
	let offset = 0;
	for (const span of spans) {
		const len = Math.round(span.sec * sampleRate);
		if (!span.silent) {
			for (let i = 0; i < len; i++) samples[offset + i] = TONE_AMPLITUDE;
		}
		offset += len;
	}
	return samples.buffer;
}

describe("detectSilences", () => {
	it("detects a single silent gap between two tone spans", () => {
		const pcm = buildPcm([
			{ silent: false, sec: 1.0 },
			{ silent: true, sec: 0.3 },
			{ silent: false, sec: 1.0 },
		]);
		const result = detectSilences(pcm, SR);

		expect(result).toHaveLength(1);
		expect(result[0]!.startSec).toBeCloseTo(1.0, 1);
		expect(result[0]!.endSec).toBeCloseTo(1.3, 1);
	});

	it("ignores a silent span shorter than MIN_SILENCE_MS", () => {
		const pcm = buildPcm([
			{ silent: false, sec: 0.5 },
			{ silent: true, sec: 0.08 },
			{ silent: false, sec: 0.5 },
		]);
		expect(detectSilences(pcm, SR)).toHaveLength(0);
	});

	it("returns an empty array for all-silence audio", () => {
		expect(
			detectSilences(buildPcm([{ silent: true, sec: 1 }]), SR),
		).toEqual([]);
	});

	it("returns an empty array for all-tone audio", () => {
		expect(
			detectSilences(buildPcm([{ silent: false, sec: 1 }]), SR),
		).toEqual([]);
	});

	it("returns an empty array for an empty buffer", () => {
		expect(detectSilences(new ArrayBuffer(0), SR)).toEqual([]);
	});

	it("returns an empty array for sub-window PCM", () => {
		expect(detectSilences(new Int16Array(10).buffer, SR)).toEqual([]);
	});

	it("returns two gaps in playback-time order", () => {
		const pcm = buildPcm([
			{ silent: false, sec: 0.5 },
			{ silent: true, sec: 0.2 },
			{ silent: false, sec: 0.5 },
			{ silent: true, sec: 0.2 },
			{ silent: false, sec: 0.5 },
		]);
		const result = detectSilences(pcm, SR);

		expect(result).toHaveLength(2);
		expect(result[0]!.startSec).toBeLessThan(result[1]!.startSec);
		expect(result[0]!.endSec).toBeLessThanOrEqual(result[1]!.startSec);
	});
});

function sentence(text: string, sourceStart = 0): Sentence {
	return {
		strippedStart: 0,
		strippedEnd: text.length,
		sourceStart,
		sourceEnd: sourceStart + text.length,
		text,
		byteLength: text.length,
	};
}

const NO_SILENCE = buildPcm([{ silent: false, sec: 6 }]);

describe("anchorSentenceTimings", () => {
	it("snaps a boundary onto the end of a nearby silence", () => {
		// Three equal sentences over 6 s.
		const sentences = [
			sentence("A".repeat(10)),
			sentence("A".repeat(10)),
			sentence("A".repeat(10)),
		];
		// Silent gap 2.1–2.5 s. With speechDur 5.6 s the walk places boundary 1
		// at 10/30·5.6 ≈ 1.867 s; the gap end (2.5) is within tolerance and snaps.
		const pcm = buildPcm([
			{ silent: false, sec: 2.1 },
			{ silent: true, sec: 0.4 },
			{ silent: false, sec: 3.5 },
		]);
		const result = anchorSentenceTimings(sentences, 6, pcm, SR);

		expect(result[0]!.endTime).toBeCloseTo(2.5, 2);
		expect(result[1]!.startTime).toBeCloseTo(2.5, 2);
		// Boundary 2 keeps its walked estimate (2.5 + the remaining speech budget
		// of sentence 1) ≈ 4.133 s.
		expect(result[1]!.endTime).toBeCloseTo(4.133, 2);
	});

	it("returns the proportional estimate unchanged when there are no silences", () => {
		const sentences = [
			sentence("A".repeat(10)),
			sentence("A".repeat(20)),
			sentence("A".repeat(30)),
		];
		expect(anchorSentenceTimings(sentences, 6, NO_SILENCE, SR)).toEqual(
			distributeSentenceTimings(sentences, 6),
		);
	});

	it("places a silence beyond snap tolerance in the prior without snapping to it", () => {
		const sentences = [
			sentence("A".repeat(10)),
			sentence("A".repeat(10)),
			sentence("A".repeat(10)),
		];
		// Silent gap 5.6–6.0 s over a 12 s clip. speechDur is 11.6 s, so the walk
		// places boundary 1 at 10/30·11.6 ≈ 3.867 s and boundary 2 at ≈ 8.133 s
		// (its budget crosses the gap). The gap end (6.0) is > 1.8 s from both,
		// so neither boundary snaps — but the gap still shifts the prior off the
		// 4.0/8.0 s the character-proportional model would give.
		const pcm = buildPcm([
			{ silent: false, sec: 5.6 },
			{ silent: true, sec: 0.4 },
			{ silent: false, sec: 6.0 },
		]);
		const result = anchorSentenceTimings(sentences, 12, pcm, SR);

		expect(result[0]!.endTime).toBeCloseTo(3.867, 2);
		expect(result[1]!.startTime).toBeCloseTo(3.867, 2);
		expect(result[1]!.endTime).toBeCloseTo(8.133, 2);
	});

	it("snaps a boundary onto a silence beyond the old 0.6 s tolerance", () => {
		// Three equal sentences over 6 s.
		const sentences = [
			sentence("A".repeat(10)),
			sentence("A".repeat(10)),
			sentence("A".repeat(10)),
		];
		// Silent gap 3.0–3.4 s: its end is ~1.5 s from the walked estimate of
		// boundary 1 — beyond the old 0.6 s tolerance but within the widened one.
		const pcm = buildPcm([
			{ silent: false, sec: 3.0 },
			{ silent: true, sec: 0.4 },
			{ silent: false, sec: 2.6 },
		]);
		const result = anchorSentenceTimings(sentences, 6, pcm, SR);

		expect(result[0]!.endTime).toBeCloseTo(3.4, 2);
		expect(result[1]!.startTime).toBeCloseTo(3.4, 2);
	});

	it("does not snap an internal boundary onto the clip's leading silence", () => {
		// Short heading (10 chars) then a long sentence (110) over a 6 s clip.
		const sentences = [sentence("A".repeat(10)), sentence("A".repeat(110))];
		// 0.3 s of leading silence. The walk places boundary 1 at ≈ 0.775 s; the
		// leading silence is excluded as a candidate so it can never claim it.
		const pcm = buildPcm([
			{ silent: true, sec: 0.3 },
			{ silent: false, sec: 5.7 },
		]);
		const result = anchorSentenceTimings(sentences, 6, pcm, SR);

		expect(result[0]!.endTime).toBeCloseTo(0.775, 2);
		expect(result[1]!.startTime).toBeCloseTo(0.775, 2);
	});

	it("does not snap a boundary onto a within-sentence micro-pause", () => {
		// Three equal sentences over 6 s.
		const sentences = [
			sentence("A".repeat(10)),
			sentence("A".repeat(10)),
			sentence("A".repeat(10)),
		];
		// A 0.14 s gap at 2.0 s — a comma-length pause, shorter than
		// MIN_SNAP_SILENCE_SEC, so it is not a snap candidate. It is still real
		// wall-clock time, so it leaves speechDur (5.86 s) and shifts the walk:
		// boundary 1 ≈ 1.953 s, boundary 2 ≈ 4.047 s.
		const pcm = buildPcm([
			{ silent: false, sec: 2.0 },
			{ silent: true, sec: 0.14 },
			{ silent: false, sec: 3.86 },
		]);
		const result = anchorSentenceTimings(sentences, 6, pcm, SR);

		expect(result[0]!.endTime).toBeCloseTo(1.953, 2);
		expect(result[1]!.startTime).toBeCloseTo(1.953, 2);
		expect(result[1]!.endTime).toBeCloseTo(4.047, 2);
	});

	it("snaps only the nearer of two boundaries onto a shared silence", () => {
		// Char lengths 25/4/31 over 6 s. With speechDur 5.6 s the walk places
		// boundary 1 at ≈ 2.733 s and boundary 2 at ≈ 3.107 s.
		const sentences = [
			sentence("A".repeat(25)),
			sentence("A".repeat(4)),
			sentence("A".repeat(31)),
		];
		// Silent gap 2.0–2.4 s: its end is 0.33 s from boundary 1, 0.71 s from
		// boundary 2. Boundary 1 claims it; boundary 2 keeps its walked estimate.
		const pcm = buildPcm([
			{ silent: false, sec: 2.0 },
			{ silent: true, sec: 0.4 },
			{ silent: false, sec: 3.6 },
		]);
		const result = anchorSentenceTimings(sentences, 6, pcm, SR);

		expect(result[0]!.endTime).toBeCloseTo(2.4, 2);
		expect(result[1]!.startTime).toBeCloseTo(2.4, 2);
		expect(result[1]!.endTime).toBeCloseTo(3.107, 2);
	});

	it("absorbs a mid-sentence silence into a sentence's speech budget", () => {
		// A long sentence (50 chars) then a short one (10) over a 6 s clip.
		const sentences = [sentence("A".repeat(50)), sentence("A".repeat(10))];
		// A 0.4 s gap at 1.0–1.4 s is a pause inside sentence 1's speech. The
		// walk steps over it for free, so sentence 1's budget exhausts at
		// ≈ 5.067 s — the gap is absorbed, not treated as the boundary, even
		// though it is a valid snap candidate.
		const pcm = buildPcm([
			{ silent: false, sec: 1.0 },
			{ silent: true, sec: 0.4 },
			{ silent: false, sec: 4.6 },
		]);
		const result = anchorSentenceTimings(sentences, 6, pcm, SR);

		expect(result[0]!.endTime).toBeCloseTo(5.067, 2);
		expect(result[1]!.startTime).toBeCloseTo(5.067, 2);
		// The gap lies strictly inside sentence 1, so no boundary landed on it.
		expect(result[0]!.startTime).toBeLessThan(1.0);
		expect(result[0]!.endTime).toBeGreaterThan(1.4);
	});

	it("snaps using the walked next-boundary estimate, not the stale char prior", () => {
		// Char lengths 20/2/50 over a 12 s clip. The middle sentence is tiny, so
		// the character-proportional prior packs boundaries 1 and 2 close together
		// (≈ 3.33 s and ≈ 3.67 s). The walk separates them: boundary 1 ≈ 3.22 s,
		// boundary 2 ≈ 3.94 s.
		const sentences = [
			sentence("A".repeat(20)),
			sentence("A".repeat(2)),
			sentence("A".repeat(50)),
		];
		// Silent gap 3.4–3.8 s. Its end (3.8) snaps boundary 1: it is within
		// tolerance and below the walked boundary 2 (3.94). The old gate used the
		// char-proportional prior of boundary 2 (3.67) as the upper bound and
		// would have wrongly rejected this snap.
		const pcm = buildPcm([
			{ silent: false, sec: 3.4 },
			{ silent: true, sec: 0.4 },
			{ silent: false, sec: 8.2 },
		]);
		const result = anchorSentenceTimings(sentences, 12, pcm, SR);

		expect(result[0]!.endTime).toBeCloseTo(3.8, 2);
		expect(result[1]!.startTime).toBeCloseTo(3.8, 2);
		expect(result[1]!.endTime).toBeGreaterThan(result[1]!.startTime);
	});

	it("keeps timings strictly monotonic with pinned endpoints", () => {
		const sentences = [
			sentence("A".repeat(10)),
			sentence("A".repeat(10)),
			sentence("A".repeat(10)),
		];
		const pcm = buildPcm([
			{ silent: false, sec: 2.1 },
			{ silent: true, sec: 0.4 },
			{ silent: false, sec: 3.5 },
		]);
		const result = anchorSentenceTimings(sentences, 6, pcm, SR);

		expect(result[0]!.startTime).toBe(0);
		expect(result[result.length - 1]!.endTime).toBe(6);
		for (let i = 0; i < result.length; i++) {
			expect(result[i]!.endTime).toBeGreaterThan(result[i]!.startTime);
			if (i > 0)
				expect(result[i]!.startTime).toBe(result[i - 1]!.endTime);
		}
	});

	it("carries source offsets, index, and text through from the proportional prior", () => {
		const sentences = [
			sentence("A".repeat(10), 100),
			sentence("A".repeat(10), 200),
			sentence("A".repeat(10), 300),
		];
		const result = anchorSentenceTimings(sentences, 6, NO_SILENCE, SR);

		result.forEach((timing, i) => {
			expect(timing.index).toBe(i);
			expect(timing.sourceStart).toBe(sentences[i]!.sourceStart);
			expect(timing.sourceEnd).toBe(sentences[i]!.sourceEnd);
			expect(timing.text).toBe(sentences[i]!.text);
		});
	});
});
