import type { Paragraph } from "../types";
import { stripMarkdown } from "./markdownStripper";

export function parseParagraphs(source: string): Paragraph[] {
	const result: Paragraph[] = [];
	let i = skipFrontmatter(source);
	let nextIndex = 0;

	while (i < source.length) {
		i = skipBlankLines(source, i);
		if (i >= source.length) break;

		const fenceSkip = skipFencedCodeBlock(source, i);
		if (fenceSkip !== null) {
			i = fenceSkip;
			continue;
		}

		const start = i;
		i = collectParagraphEnd(source, i);
		const end = i;

		const sourceText = source.slice(start, end);
		const { strippedText, strippedToSource } = stripMarkdown(sourceText, start);
		if (strippedText.trim() === "") continue;

		const byteLength = new TextEncoder().encode(strippedText).byteLength;
		result.push({
			index: nextIndex++,
			sourceStart: start,
			sourceEnd: end,
			sourceText,
			strippedText,
			strippedToSource,
			byteLength,
		});
	}

	return result;
}

function skipFrontmatter(source: string): number {
	if (!source.startsWith("---\n") && !source.startsWith("---\r\n")) return 0;
	const firstLineEnd = source.indexOf("\n", 3);
	if (firstLineEnd === -1) return 0;

	let scan = firstLineEnd + 1;
	while (scan < source.length) {
		const lineEnd = source.indexOf("\n", scan);
		const line = lineEnd === -1 ? source.slice(scan) : source.slice(scan, lineEnd);
		if (line.trimEnd() === "---") {
			return lineEnd === -1 ? source.length : lineEnd + 1;
		}
		if (lineEnd === -1) return 0;
		scan = lineEnd + 1;
	}
	return 0;
}

function skipBlankLines(source: string, start: number): number {
	let i = start;
	while (i < source.length) {
		const lineEnd = source.indexOf("\n", i);
		const line = lineEnd === -1 ? source.slice(i) : source.slice(i, lineEnd);
		if (line.trim() !== "") return i;
		if (lineEnd === -1) return source.length;
		i = lineEnd + 1;
	}
	return i;
}

function skipFencedCodeBlock(source: string, start: number): number | null {
	const lineEnd = source.indexOf("\n", start);
	const firstLine = lineEnd === -1 ? source.slice(start) : source.slice(start, lineEnd);
	const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(firstLine);
	if (!fenceMatch) return null;

	const fence = fenceMatch[1]!;
	const closeRegex = new RegExp(`^\\s{0,3}${fence.replace(/[`~]/g, (m) => `\\${m}`)}\\s*$`);

	let scan = lineEnd === -1 ? source.length : lineEnd + 1;
	while (scan < source.length) {
		const nextEnd = source.indexOf("\n", scan);
		const line = nextEnd === -1 ? source.slice(scan) : source.slice(scan, nextEnd);
		if (closeRegex.test(line)) {
			return nextEnd === -1 ? source.length : nextEnd + 1;
		}
		if (nextEnd === -1) return source.length;
		scan = nextEnd + 1;
	}
	return source.length;
}

function collectParagraphEnd(source: string, start: number): number {
	let i = start;
	while (i < source.length) {
		const lineEnd = source.indexOf("\n", i);
		if (lineEnd === -1) return source.length;

		const nextLineStart = lineEnd + 1;
		if (nextLineStart >= source.length) return lineEnd + 1;

		const nextLineEnd = source.indexOf("\n", nextLineStart);
		const nextLine =
			nextLineEnd === -1 ? source.slice(nextLineStart) : source.slice(nextLineStart, nextLineEnd);
		if (nextLine.trim() === "") return lineEnd + 1;

		i = lineEnd + 1;
	}
	return i;
}
