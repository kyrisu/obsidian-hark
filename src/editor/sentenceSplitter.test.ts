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

	it("does not split on the Spanish abbreviation Sra.", () => {
		expect(sentencesOf("La Sra. García llegó. Estaba cansada.")).toEqual([
			"La Sra. García llegó.",
			"Estaba cansada.",
		]);
	});

	it("splits Spanish sentences ending with accented words", () => {
		expect(sentencesOf("¿Cómo estás? Muy bien.")).toEqual(["¿Cómo estás?", "Muy bien."]);
	});

	it("does not split on the Polish abbreviation np.", () => {
		expect(sentencesOf("Lubię owoce, np. jabłka. Smakują dobrze.")).toEqual([
			"Lubię owoce, np. jabłka.",
			"Smakują dobrze.",
		]);
	});

	it("does not split on a Polish abbreviation ending in an accented letter", () => {
		expect(sentencesOf("Pracuje jako inż. budowy. Zna się na tym.")).toEqual([
			"Pracuje jako inż. budowy.",
			"Zna się na tym.",
		]);
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
