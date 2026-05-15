import { describe, expect, it } from "vitest";
import {
	coalesceShortParagraphs,
	parseParagraphs,
	SHORT_PARAGRAPH_CHAR_LIMIT,
} from "./paragraphParser";

// A body paragraph comfortably longer than the merge threshold.
const LONG_BODY =
	"This is a deliberately long body paragraph whose stripped text runs well " +
	"past the short paragraph character limit so the coalescing pass will treat " +
	"it as a substantial unit and never fold it into anything around it at all.";

describe("coalesceShortParagraphs", () => {
	it("merges a short heading into the following body paragraph", () => {
		const raw = parseParagraphs(`# Introduction\n\n${LONG_BODY}\n`);
		expect(raw.length).toBe(2);

		const merged = coalesceShortParagraphs(raw);
		expect(merged.length).toBe(1);
		expect(merged[0]!.strippedText).toContain("Introduction");
		expect(merged[0]!.strippedText).toContain("substantial unit");
		expect(merged[0]!.sourceStart).toBe(raw[0]!.sourceStart);
		expect(merged[0]!.sourceEnd).toBe(raw[1]!.sourceEnd);
	});

	it("leaves two long paragraphs untouched", () => {
		const raw = parseParagraphs(`${LONG_BODY}\n\n${LONG_BODY}\n`);
		expect(raw.length).toBe(2);

		const merged = coalesceShortParagraphs(raw);
		expect(merged.length).toBe(2);
	});

	it("chains merges across several short paragraphs", () => {
		const raw = parseParagraphs(`# Title\n\nShort one.\n\nShort two.\n\n${LONG_BODY}\n`);
		expect(raw.length).toBe(4);

		const merged = coalesceShortParagraphs(raw);
		expect(merged.length).toBe(1);
		expect(merged[0]!.strippedText).toContain("Title");
		expect(merged[0]!.strippedText).toContain("Short one.");
		expect(merged[0]!.strippedText).toContain("Short two.");
	});

	it("leaves a short trailing paragraph alone when nothing follows it", () => {
		const raw = parseParagraphs(`${LONG_BODY}\n\n# Footer\n`);
		expect(raw.length).toBe(2);

		const merged = coalesceShortParagraphs(raw);
		expect(merged.length).toBe(2);
		expect(merged[1]!.strippedText.trim()).toBe("Footer");
	});

	it("reassigns contiguous indices after merging", () => {
		const raw = parseParagraphs(
			`# A\n\n${LONG_BODY}\n\n# B\n\n${LONG_BODY}\n`,
		);
		const merged = coalesceShortParagraphs(raw);
		expect(merged.map((p) => p.index)).toEqual(
			merged.map((_, idx) => idx),
		);
	});

	it("keeps strippedToSource aligned with the merged stripped text", () => {
		const merged = coalesceShortParagraphs(
			parseParagraphs(`# Heading\n\n${LONG_BODY}\n`),
		);
		expect(merged[0]!.strippedToSource.length).toBe(merged[0]!.strippedText.length);
	});

	it("returns an empty list unchanged", () => {
		expect(coalesceShortParagraphs([])).toEqual([]);
	});

	it("uses a threshold that admits a heading but not a full paragraph", () => {
		expect("Introduction".length).toBeLessThan(SHORT_PARAGRAPH_CHAR_LIMIT);
		expect(LONG_BODY.length).toBeGreaterThan(SHORT_PARAGRAPH_CHAR_LIMIT);
	});
});
