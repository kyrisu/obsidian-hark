import { describe, expect, it } from "vitest";
import { type StripResult, stripMarkdown } from "./markdownStripper";

function strip(source: string, sourceBase = 0): StripResult {
	const result = stripMarkdown(source, sourceBase);
	for (let i = 0; i < result.strippedText.length; i++) {
		const docOffset = result.strippedToSource[i];
		expect(docOffset).toBeTypeOf("number");
		const localIdx = (docOffset as number) - sourceBase;
		expect(source.charAt(localIdx)).toBe(result.strippedText.charAt(i));
	}
	expect(result.strippedToSource.length).toBe(result.strippedText.length);
	return result;
}

describe("stripMarkdown", () => {
	it("strips an ATX heading prefix", () => {
		const { strippedText } = strip("# Hello");
		expect(strippedText).toBe("Hello");
	});

	it("strips bold delimiters", () => {
		const { strippedText, strippedToSource } = strip("**Hello**");
		expect(strippedText).toBe("Hello");
		expect(Array.from(strippedToSource)).toEqual([2, 3, 4, 5, 6]);
	});

	it("strips italic delimiters", () => {
		const { strippedText } = strip("*Hello*");
		expect(strippedText).toBe("Hello");
	});

	it("strips inline code backticks", () => {
		const { strippedText, strippedToSource } = strip("`code`");
		expect(strippedText).toBe("code");
		expect(Array.from(strippedToSource)).toEqual([1, 2, 3, 4]);
	});

	it("keeps only the link text from a markdown link", () => {
		const { strippedText, strippedToSource } = strip("[text](url)");
		expect(strippedText).toBe("text");
		expect(Array.from(strippedToSource)).toEqual([1, 2, 3, 4]);
	});

	it("keeps only the alt text from an image", () => {
		const { strippedText, strippedToSource } = strip("![alt](url)");
		expect(strippedText).toBe("alt");
		expect(Array.from(strippedToSource)).toEqual([2, 3, 4]);
	});

	it("keeps the target of a bare wikilink", () => {
		const { strippedText, strippedToSource } = strip("[[target]]");
		expect(strippedText).toBe("target");
		expect(Array.from(strippedToSource)).toEqual([2, 3, 4, 5, 6, 7]);
	});

	it("keeps the display alias of a piped wikilink", () => {
		const { strippedText, strippedToSource } = strip("[[target|display]]");
		expect(strippedText).toBe("display");
		expect(Array.from(strippedToSource)).toEqual([
			9, 10, 11, 12, 13, 14, 15,
		]);
	});

	it("strips a blockquote marker", () => {
		const { strippedText, strippedToSource } = strip("> Hello");
		expect(strippedText).toBe("Hello");
		expect(Array.from(strippedToSource)).toEqual([2, 3, 4, 5, 6]);
	});

	it("strips an unordered list marker", () => {
		const { strippedText, strippedToSource } = strip("- Hello");
		expect(strippedText).toBe("Hello");
		expect(Array.from(strippedToSource)).toEqual([2, 3, 4, 5, 6]);
	});

	it("strips an ordered list marker", () => {
		const { strippedText, strippedToSource } = strip("1. Hello");
		expect(strippedText).toBe("Hello");
		expect(Array.from(strippedToSource)).toEqual([3, 4, 5, 6, 7]);
	});

	it("treats a bare --- line as a setext underline and emits nothing", () => {
		const { strippedText, strippedToSource } = strip("---");
		expect(strippedText).toBe("");
		expect(strippedToSource.length).toBe(0);
	});

	it("drops footnote markers", () => {
		const { strippedText } = strip("Hello[^1] world");
		expect(strippedText).toBe("Hello world");
	});

	it("drops inline math", () => {
		const { strippedText } = strip("$x$");
		expect(strippedText).toBe("");
	});

	it("drops block math", () => {
		const { strippedText } = strip("$$x = y$$");
		expect(strippedText).toBe("");
	});

	it("drops HTML tags but keeps surrounding text", () => {
		const { strippedText } = strip("Hi <br/> there");
		expect(strippedText).toBe("Hi  there");
	});

	it("preserves source offsets when sourceBase is non-zero", () => {
		const base = 100;
		const { strippedText, strippedToSource } = strip("**Hi**", base);
		expect(strippedText).toBe("Hi");
		expect(Array.from(strippedToSource)).toEqual([102, 103]);
	});

	it("preserves the round-trip property on mixed inline syntax", () => {
		const { strippedText, strippedToSource } = strip(
			"**Hello** [there](url)",
		);
		expect(strippedText).toBe("Hello there");
		expect(Array.from(strippedToSource)).toEqual([
			2, 3, 4, 5, 6, 9, 11, 12, 13, 14, 15,
		]);
	});

	it("recursively strips nested emphasis inside a link", () => {
		const { strippedText } = strip("[**bold link**](url)");
		expect(strippedText).toBe("bold link");
	});

	it("emits newlines verbatim so the round-trip property holds across lines", () => {
		const { strippedText } = strip("# A\n# B");
		expect(strippedText).toBe("A\nB");
	});
});
