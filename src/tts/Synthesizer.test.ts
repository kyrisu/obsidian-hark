import { describe, expect, it } from "vitest";
import { binPackSentences, distributeSentenceTimings } from "./Synthesizer";
import type { Sentence } from "../editor/sentenceSplitter";

function sentence(partial: Partial<Sentence> & { text: string }): Sentence {
	return {
		strippedStart: partial.strippedStart ?? 0,
		strippedEnd: partial.strippedEnd ?? partial.text.length,
		sourceStart: partial.sourceStart ?? 0,
		sourceEnd: partial.sourceEnd ?? partial.text.length,
		text: partial.text,
		byteLength: partial.byteLength ?? new TextEncoder().encode(partial.text).byteLength,
		words: partial.words ?? [],
	};
}

describe("distributeSentenceTimings", () => {
	it("distributes duration in proportion to character count and clamps the last endTime", () => {
		const sentences = [
			sentence({ text: "Hi.", sourceStart: 0, sourceEnd: 3 }),
			sentence({ text: "How are you?", sourceStart: 4, sourceEnd: 16 }),
		];
		const timings = distributeSentenceTimings(sentences, 3);

		expect(timings).toHaveLength(2);
		expect(timings[0]!.startTime).toBe(0);
		expect(timings[0]!.endTime).toBe(timings[1]!.startTime);
		expect(timings[1]!.endTime).toBe(3);

		const firstDuration = timings[0]!.endTime - timings[0]!.startTime;
		const secondDuration = timings[1]!.endTime - timings[1]!.startTime;
		expect(firstDuration / secondDuration).toBeCloseTo(3 / 12, 6);
	});

	it("returns an empty array when total characters is zero", () => {
		expect(distributeSentenceTimings([], 5)).toEqual([]);
	});

	it("preserves sourceStart, sourceEnd, and words from each sentence", () => {
		const sentences = [
			sentence({
				text: "One.",
				sourceStart: 10,
				sourceEnd: 14,
				words: [{ text: "One", sourceStart: 10, sourceEnd: 13 }],
			}),
		];
		const timings = distributeSentenceTimings(sentences, 1);
		expect(timings[0]!.sourceStart).toBe(10);
		expect(timings[0]!.sourceEnd).toBe(14);
		expect(timings[0]!.words).toEqual([{ text: "One", sourceStart: 10, sourceEnd: 13 }]);
		expect(timings[0]!.endTime).toBe(1);
	});
});

describe("binPackSentences", () => {
	it("packs sentences greedily under the byte cap", () => {
		const sentences = [
			sentence({ text: "AAAA" }),
			sentence({ text: "BBBB" }),
			sentence({ text: "CCCC" }),
		];
		const groups = binPackSentences(sentences, 9);
		expect(groups).toHaveLength(2);
		expect(groups[0]!.map((s) => s.text)).toEqual(["AAAA", "BBBB"]);
		expect(groups[1]!.map((s) => s.text)).toEqual(["CCCC"]);
	});

	it("splits a single oversize sentence into mid-sentence pieces at whitespace and fires the notice once", () => {
		let notices = 0;
		const long = sentence({
			text: "alpha beta gamma delta epsilon zeta",
			sourceStart: 0,
			sourceEnd: 35,
		});
		const groups = binPackSentences([long], 10, () => notices++);
		expect(notices).toBe(1);
		expect(groups.length).toBeGreaterThan(1);
		const totalBytes = groups.reduce(
			(sum, g) => sum + g.reduce((s, x) => s + x.byteLength, 0),
			0,
		);
		expect(totalBytes).toBeLessThanOrEqual(long.byteLength);
		for (const group of groups) {
			expect(group).toHaveLength(1);
			expect(group[0]!.byteLength).toBeLessThanOrEqual(10);
		}
	});

	it("handles an empty input", () => {
		expect(binPackSentences([], 100)).toEqual([]);
	});
});
