import type { SentenceTiming } from "../types";
import type { Sentence } from "../editor/sentenceSplitter";
import { distributeSentenceTimings } from "./Synthesizer";
import { clamp } from "../utils/math";

// Window over which a single root-mean-square energy reading is taken. 20 ms is
// short enough to locate a gap edge precisely and long enough to be stable.
const WINDOW_MS = 20;

// A run of silent windows is only treated as a real gap if it lasts at least this
// long. Filters out the micro-pauses inside a sentence (commas, breaths).
const MIN_SILENCE_MS = 120;

// A window counts as silent if its RMS is below this fraction of the clip's
// speech-level reference. Relative, not absolute, because TTS output loudness
// varies between requests. Tunable.
const SILENCE_RATIO = 0.1;

const INT16_SCALE = 32768;

// A silence that touches either edge of the clip — the leading silence before
// the first word, or the trailing silence after the last — is not an
// inter-sentence pause. Such silences are excluded as snap candidates so an
// internal boundary can never collapse onto the clip start or end.
const CLIP_EDGE_EPSILON_SEC = 0.05;

// A silence is only a credible sentence boundary if it lasts at least this long.
// Shorter gaps are within-sentence pauses — commas, clause breaks, breaths.
// detectSilences still reports them; they are filtered out here, at snap time.
const MIN_SNAP_SILENCE_SEC = 0.18;

// A boundary's proportional estimate snaps to a detected silence only if the end
// of a silence lies within this many seconds of the estimate. The character-
// proportional prior drifts by over a second for short sentences (headings in
// particular), so the window must be wide enough to reach the true pause;
// inter-sentence silences are spaced far enough apart that a window this size
// still cannot cross a neighbouring sentence boundary. Tunable.
const SNAP_TOLERANCE_SEC = 1.8;

export interface SilenceInterval {
	startSec: number;
	endSec: number;
}

// Finds the silent gaps in little-endian 16-bit mono PCM. Returns intervals in
// playback-time order.
export function detectSilences(
	pcm: ArrayBuffer,
	sampleRate: number,
): SilenceInterval[] {
	const samples = new Int16Array(pcm);
	const windowSamples = Math.round((sampleRate * WINDOW_MS) / 1000);
	if (windowSamples <= 0 || samples.length < windowSamples) return [];

	const windowCount = Math.floor(samples.length / windowSamples);
	const rms = new Array<number>(windowCount);
	for (let w = 0; w < windowCount; w++) {
		const base = w * windowSamples;
		let sumSq = 0;
		for (let i = 0; i < windowSamples; i++) {
			const v = samples[base + i]! / INT16_SCALE;
			sumSq += v * v;
		}
		rms[w] = Math.sqrt(sumSq / windowSamples);
	}

	// 90th-percentile window RMS as the speech-level reference: robust to the
	// silent windows themselves dragging a plain mean down.
	const sorted = [...rms].sort((a, b) => a - b);
	const reference =
		sorted[clamp(Math.floor(sorted.length * 0.9), 0, sorted.length - 1)]!;
	const threshold = SILENCE_RATIO * reference;

	const windowSec = windowSamples / sampleRate;
	const minWindows = Math.ceil(MIN_SILENCE_MS / WINDOW_MS);
	const intervals: SilenceInterval[] = [];
	let runStart = -1;
	for (let w = 0; w <= windowCount; w++) {
		const isSilent = w < windowCount && rms[w]! < threshold;
		if (isSilent) {
			if (runStart < 0) runStart = w;
		} else if (runStart >= 0) {
			if (w - runStart >= minWindows) {
				const startSec = runStart * windowSec;
				const endSec = w * windowSec;
				intervals.push({ startSec, endSec });
			}
			runStart = -1;
		}
	}
	return intervals;
}

// Computes per-sentence timings. The character-proportional model is a poor
// prior because the pauses a TTS model inserts consume wall-clock time out of
// all proportion to character count, so its error compounds across a long
// group. Instead this distributes each sentence's character share over *speech*
// time only — audio duration minus all detected silence — then walks the
// alternating speech/silence spans, consuming speech time as budget and
// stepping over silence spans for free. Each boundary lands where its
// sentence's speech budget runs out, so a mid-sentence pause is placed at its
// real time rather than averaged across the group. Each internal boundary is
// then snapped onto the nearest credible silent gap. With no detectable
// silences the result equals the character-proportional estimate.
export function anchorSentenceTimings(
	sentences: Sentence[],
	audioDurationSec: number,
	pcm: ArrayBuffer,
	sampleRate: number,
): SentenceTiming[] {
	const n = sentences.length;
	if (n <= 1) return distributeSentenceTimings(sentences, audioDurationSec);

	const charWeight = sentences.map((s) => s.text.length);
	const totalW = charWeight.reduce((a, b) => a + b, 0);
	if (totalW === 0)
		return distributeSentenceTimings(sentences, audioDurationSec);

	const silences = detectSilences(pcm, sampleRate);
	const totalSilence = silences.reduce(
		(sum, s) => sum + (s.endSec - s.startSec),
		0,
	);
	const speechDur = audioDurationSec - totalSilence;
	if (speechDur <= 0)
		return distributeSentenceTimings(sentences, audioDurationSec);

	// Alternating speech/silence spans across the whole clip. The walk consumes
	// speech-span time as budget and steps over silence spans for free, so a
	// mid-sentence pause sits at its real time instead of being averaged away.
	const spans: { silent: boolean; start: number; end: number }[] = [];
	let cursor = 0;
	for (const s of silences) {
		if (s.startSec > cursor)
			spans.push({ silent: false, start: cursor, end: s.startSec });
		spans.push({ silent: true, start: s.startSec, end: s.endSec });
		cursor = s.endSec;
	}
	if (cursor < audioDurationSec) {
		spans.push({ silent: false, start: cursor, end: audioDurationSec });
	}

	// raw[k] is the walked estimate of boundary k (the start of sentence k).
	// Boundary 0 is pinned to 0 and boundary n to audioDurationSec.
	const raw = new Array<number>(n + 1);
	raw[0] = 0;
	raw[n] = audioDurationSec;
	let spanIdx = 0;
	let withinSpan = 0;
	for (let i = 0; i < n - 1; i++) {
		let need = (charWeight[i]! / totalW) * speechDur;
		while (need > 1e-9 && spanIdx < spans.length) {
			const sp = spans[spanIdx]!;
			if (sp.silent) {
				spanIdx++;
				withinSpan = 0;
				continue;
			}
			const avail = sp.end - sp.start - withinSpan;
			if (avail > need) {
				withinSpan += need;
				need = 0;
			} else {
				need -= avail;
				spanIdx++;
				withinSpan = 0;
			}
		}
		const sp = spanIdx < spans.length ? spans[spanIdx]! : undefined;
		if (!sp) {
			raw[i + 1] = audioDurationSec;
		} else if (sp.silent) {
			raw[i + 1] = sp.start;
		} else {
			raw[i + 1] = sp.start + withinSpan;
		}
	}

	// Leading/trailing silences and within-sentence micro-pauses are not sentence
	// boundaries; only the remaining gaps are credible snap candidates.
	const candidates = silences.filter(
		(s) =>
			s.startSec >= CLIP_EDGE_EPSILON_SEC &&
			s.endSec <= audioDurationSec - CLIP_EDGE_EPSILON_SEC &&
			s.endSec - s.startSec >= MIN_SNAP_SILENCE_SEC,
	);
	const claimed = new Set<number>();

	// decided[k] starts at the walked estimate and may snap onto a silence end.
	const decided = raw.slice();
	for (let k = 1; k < n; k++) {
		const est = raw[k]!;
		let bestIdx = -1;
		let bestDist = Infinity;
		for (let s = 0; s < candidates.length; s++) {
			if (claimed.has(s)) continue;
			const dist = Math.abs(candidates[s]!.endSec - est);
			if (dist <= SNAP_TOLERANCE_SEC && dist < bestDist) {
				bestDist = dist;
				bestIdx = s;
			}
		}
		if (bestIdx >= 0) {
			// Snap to the end of the gap so the highlight advances when the next
			// sentence's speech begins, not partway through the pause.
			const snap = candidates[bestIdx]!.endSec;
			// The upper bound is the walked estimate of the next boundary, not a
			// character-proportional prior: that prior can fall short of a valid
			// snap and wrongly reject it.
			if (snap > decided[k - 1]! && snap < raw[k + 1]!) {
				decided[k] = snap;
				claimed.add(bestIdx);
			}
		}
	}

	return sentences.map((s, i) => ({
		index: i,
		startTime: decided[i]!,
		endTime: decided[i + 1]!,
		sourceStart: s.sourceStart,
		sourceEnd: s.sourceEnd,
		text: s.text,
	}));
}
