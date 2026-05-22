import { describe, expect, it } from "vitest";
import {
	FIRST_GROUP_MAX_BYTES,
	groupParagraphs,
	parseParagraphs,
} from "./paragraphParser";

// A body paragraph comfortably longer than MIN_GROUP_CHARS.
const LONG_BODY =
	"This is a deliberately long body paragraph whose stripped text runs well " +
	"past the short paragraph character limit so the grouping pass will treat " +
	"it as a substantial unit and never fold it into anything around it at all.";

function body(chars: number): string {
	return "x".repeat(chars);
}

describe("parseParagraphs heading detection", () => {
	it("emits a blank-line-separated heading as its own paragraph", () => {
		const paragraphs = parseParagraphs(`# Introduction\n\n${LONG_BODY}\n`);
		expect(paragraphs.length).toBe(2);
		expect(paragraphs[0]!.headingLevel).toBe(1);
		expect(paragraphs[1]!.headingLevel).toBe(0);
	});

	it("splits a heading off body text with no blank line between them", () => {
		const paragraphs = parseParagraphs(`## Heading\n${LONG_BODY}\n`);
		expect(paragraphs.length).toBe(2);
		expect(paragraphs[0]!.headingLevel).toBe(2);
		expect(paragraphs[0]!.strippedText.trim()).toBe("Heading");
		expect(paragraphs[1]!.headingLevel).toBe(0);
	});

	it("detects a level-6 heading", () => {
		const paragraphs = parseParagraphs(`###### Deep\n`);
		expect(paragraphs.length).toBe(1);
		expect(paragraphs[0]!.headingLevel).toBe(6);
	});

	it("does not treat a leading #tag as a heading", () => {
		const paragraphs = parseParagraphs(`#tag at line start\n`);
		expect(paragraphs.length).toBe(1);
		expect(paragraphs[0]!.headingLevel).toBe(0);
	});

	it("does not treat a #-prefixed line inside a fenced code block as a heading", () => {
		const paragraphs = parseParagraphs(
			"```\n# not a heading\n```\n\n" + LONG_BODY + "\n",
		);
		expect(paragraphs.length).toBe(1);
		expect(paragraphs[0]!.headingLevel).toBe(0);
		expect(paragraphs[0]!.strippedText).toContain("substantial unit");
	});

	it("tags a plain body paragraph with headingLevel 0", () => {
		const paragraphs = parseParagraphs(`${LONG_BODY}\n`);
		expect(paragraphs.length).toBe(1);
		expect(paragraphs[0]!.headingLevel).toBe(0);
	});
});

describe("groupParagraphs", () => {
	const CAP = 4000;

	it("collapses several short paragraphs under one heading into one group", () => {
		const raw = parseParagraphs(
			`# Heading\n\nShort one.\n\nShort two.\n\nShort three.\n`,
		);
		const groups = groupParagraphs(raw, 0, CAP);
		expect(groups.length).toBe(1);
	});

	it("splits at the last paragraph boundary that fits when there is no internal heading", () => {
		const raw = parseParagraphs(
			`# Heading\n\n${body(700)}\n\n${body(700)}\n`,
		);
		const groups = groupParagraphs(raw, 0, CAP);
		expect(groups.length).toBe(2);
		expect(groups[1]!.strippedText).not.toContain("Heading");
	});

	it("places a size-forced cut on the second heading when the prefix is long enough", () => {
		const raw = parseParagraphs(
			`# Section One\n\n${body(500)}\n\n# Section Two\n\n${body(800)}\n`,
		);
		const groups = groupParagraphs(raw, 0, CAP);
		expect(groups.length).toBe(2);
		expect(groups[0]!.strippedText).toContain("Section One");
		expect(groups[0]!.strippedText).not.toContain("Section Two");
		expect(groups[1]!.strippedText.startsWith("Section Two")).toBe(true);
		expect(groups[1]!.headingLevel).toBe(1);
	});

	it("rejects a heading cut whose prefix is below MIN_GROUP_CHARS", () => {
		const raw = parseParagraphs(
			`# Alpha\n\nTiny.\n\n# Bravo\n\n${body(1300)}\n`,
		);
		const groups = groupParagraphs(raw, 0, CAP);
		expect(groups.length).toBe(2);
		// The heading "Bravo" is pulled into group 0 rather than starting group 1.
		expect(groups[0]!.strippedText).toContain("Bravo");
	});

	it("drops paragraphs before startIdx", () => {
		const raw = parseParagraphs(
			`First para.\n\nSecond para.\n\nThird para.\n`,
		);
		const groups = groupParagraphs(raw, 1, CAP);
		expect(groups.length).toBe(1);
		expect(groups[0]!.strippedText).toContain("Second para.");
		expect(groups[0]!.strippedText).toContain("Third para.");
		expect(groups[0]!.strippedText).not.toContain("First para.");
	});

	it("preserves a single paragraph larger than the cap as a one-member group", () => {
		const raw = parseParagraphs(`${body(5000)}\n`);
		expect(raw.length).toBe(1);
		const groups = groupParagraphs(raw, 0, CAP);
		expect(groups.length).toBe(1);
		expect(groups[0]!.byteLength).toBeGreaterThan(CAP);
	});

	it("caps the first group small and lets later groups use the full cap", () => {
		const raw = parseParagraphs(
			Array(12).fill(body(400)).join("\n\n") + "\n",
		);
		expect(raw.length).toBe(12);
		const groups = groupParagraphs(raw, 0, CAP);
		expect(groups.length).toBeGreaterThan(1);
		expect(groups[0]!.byteLength).toBeLessThanOrEqual(
			FIRST_GROUP_MAX_BYTES,
		);
		expect(groups[1]!.byteLength).toBeGreaterThan(FIRST_GROUP_MAX_BYTES);
		expect(groups[1]!.byteLength).toBeLessThanOrEqual(CAP);
	});

	it("returns an empty list for empty input", () => {
		expect(groupParagraphs([], 0, CAP)).toEqual([]);
	});

	it("keeps strippedToSource aligned with strippedText for every merged group", () => {
		const raw = parseParagraphs(
			`# Section One\n\n${body(500)}\n\n# Section Two\n\n${body(800)}\n`,
		);
		const groups = groupParagraphs(raw, 0, CAP);
		for (const g of groups) {
			expect(g.strippedToSource.length).toBe(g.strippedText.length);
		}
	});
});
