import { describe, expect, it } from "vitest";
import { findSentenceInText } from "./sentenceMatcher";

describe("findSentenceInText", () => {
	it("finds an exact match and returns its raw bounds", () => {
		const buffer = "First sentence. Second sentence.";
		const match = findSentenceInText(buffer, "Second sentence.");
		expect(match).toEqual({ start: 16, end: 32 });
		expect(buffer.slice(match!.start, match!.end)).toBe("Second sentence.");
	});

	it("matches across collapsed whitespace in the buffer", () => {
		// The rendered buffer has a newline and doubled spaces where the stripped
		// sentence has single spaces.
		const buffer = "Intro.\n\nThe  quick\nbrown   fox.";
		const match = findSentenceInText(buffer, "The quick brown fox.");
		expect(match).not.toBeNull();
		expect(buffer.slice(match!.start, match!.end)).toBe(
			"The  quick\nbrown   fox.",
		);
	});

	it("returns null when the sentence is absent", () => {
		expect(
			findSentenceInText(
				"Some other text entirely.",
				"Missing sentence.",
			),
		).toBeNull();
	});

	it("returns null for an empty or whitespace-only sentence", () => {
		expect(findSentenceInText("Any buffer.", "")).toBeNull();
		expect(findSentenceInText("Any buffer.", "   \n  ")).toBeNull();
	});

	it("matches a sentence embedded in a longer sentence at its own bounds", () => {
		// "I agree." is a tail-substring of the longer sentence; the match must
		// cover exactly the needle, not extend to the whole sentence.
		const buffer = "Well, I agree.";
		const match = findSentenceInText(buffer, "I agree.");
		expect(match).not.toBeNull();
		expect(buffer.slice(match!.start, match!.end)).toBe("I agree.");
		expect(match!.start).toBe(6);
	});
});
