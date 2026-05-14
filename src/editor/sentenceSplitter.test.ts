import { describe, expect, it } from "vitest";
import { parseParagraphs } from "./paragraphParser";
import { splitSentences } from "./sentenceSplitter";

function sentencesOf(source: string): string[] {
	const paragraphs = parseParagraphs(source);
	expect(paragraphs.length).toBe(1);
	return splitSentences(paragraphs[0]!).map((s) => s.text);
}

describe("splitSentences", () => {
	it("returns a single sentence when there is no terminal punctuation", () => {
		expect(sentencesOf("Hello world")).toEqual(["Hello world"]);
	});

	it("splits two sentences on a period followed by whitespace", () => {
		expect(sentencesOf("Hello world. This is a test.")).toEqual([
			"Hello world.",
			"This is a test.",
		]);
	});

	it("splits three sentences", () => {
		expect(sentencesOf("One. Two. Three.")).toEqual(["One.", "Two.", "Three."]);
	});

	it("does not split on the abbreviation Mr.", () => {
		expect(sentencesOf("Mr. Smith arrived. He was late.")).toEqual([
			"Mr. Smith arrived.",
			"He was late.",
		]);
	});

	it("treats a terminator inside parens as a boundary only at the closing paren", () => {
		expect(sentencesOf("He said (that's true.) Then left.")).toEqual([
			"He said (that's true.)",
			"Then left.",
		]);
	});

	it("splits on an ellipsis followed by a capitalised continuation", () => {
		expect(sentencesOf("He paused... Then spoke.")).toEqual([
			"He paused...",
			"Then spoke.",
		]);
	});

	it("treats consecutive ?! as a single boundary", () => {
		expect(sentencesOf("Really?! Yes.")).toEqual(["Really?!", "Yes."]);
	});

	it("emits source-mapped word tokens for each sentence", () => {
		const paragraphs = parseParagraphs("Hello world. Goodbye.");
		const sentences = splitSentences(paragraphs[0]!);
		expect(sentences[0]!.words.map((w) => w.text)).toEqual(["Hello", "world."]);
		expect(sentences[1]!.words.map((w) => w.text)).toEqual(["Goodbye."]);
		expect(sentences[0]!.words[0]!.sourceStart).toBe(0);
		expect(sentences[0]!.words[0]!.sourceEnd).toBe(5);
	});
});
