import type { Paragraph } from "../types";
import { stripMarkdown } from "./markdownStripper";

// The first group of a playback run blocks playback until synthesised —
// prefetch cannot hide it. Cap it small for a fast cold start; later groups
// use the model's full maxRequestBytes.
export const FIRST_GROUP_MAX_BYTES = 1200;

// A size-forced cut is placed on an internal heading only if the group before
// it is at least this long; otherwise the cut falls on the last paragraph
// boundary. Prevents emitting a clip too short to mask the next group's
// synthesis latency.
export const MIN_GROUP_CHARS = 160;

const PARAGRAPH_GAP = "\n\n";

// An ATX heading: 0-3 leading spaces, 1-6 `#`, then a space or end-of-line. The
// trailing space (or EOL) is what distinguishes `# Heading` from a `#tag`.
const ATX_HEADING = /^ {0,3}(#{1,6})(?: |$)/;

function headingLevelOf(line: string): number {
	const m = ATX_HEADING.exec(line);
	return m ? m[1]!.length : 0;
}

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
		const firstLineEnd = source.indexOf("\n", start);
		const firstLine = firstLineEnd === -1 ? source.slice(start) : source.slice(start, firstLineEnd);
		const headingLevel = headingLevelOf(firstLine);
		if (headingLevel > 0) {
			i = firstLineEnd === -1 ? source.length : firstLineEnd + 1;
		} else {
			i = collectParagraphEnd(source, start);
		}
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
			headingLevel,
		});
	}

	return result;
}

// Partitions paragraphs into heading-anchored, size-bounded synthesis groups,
// starting at startIdx. Paragraphs before startIdx are dropped (not played).
// Each emitted group is merged into one Paragraph; indices are reassigned.
export function groupParagraphs(
	paragraphs: Paragraph[],
	startIdx: number,
	maxRequestBytes: number,
): Paragraph[] {
	const out: Paragraph[] = [];
	let i = Math.max(0, startIdx);

	while (i < paragraphs.length) {
		const cap = out.length === 0 ? FIRST_GROUP_MAX_BYTES : maxRequestBytes;

		// Accumulate the maximal run of whole paragraphs that fits the cap.
		const members: Paragraph[] = [paragraphs[i]!];
		let bytes = paragraphs[i]!.byteLength;
		let j = i + 1;
		while (j < paragraphs.length) {
			const next = bytes + PARAGRAPH_GAP.length + paragraphs[j]!.byteLength;
			if (next > cap) break;
			members.push(paragraphs[j]!);
			bytes = next;
			j++;
		}

		// Decide the cut: prefer the most-recent internal heading, else take all.
		let cut = members.length;
		for (let k = members.length - 1; k >= 1; k--) {
			if (members[k]!.headingLevel > 0) {
				const prefixChars = members
					.slice(0, k)
					.reduce((n, p) => n + p.strippedText.trim().length, 0);
				if (prefixChars >= MIN_GROUP_CHARS) cut = k;
				break; // only the most-recent heading is considered
			}
		}

		const group = members.slice(0, cut);
		out.push({ ...mergeAll(group), index: out.length });
		i += cut;
	}

	return out;
}

function mergeAll(group: Paragraph[]): Paragraph {
	return group.reduce((acc, p) => mergeParagraphs(acc, p));
}

function mergeParagraphs(a: Paragraph, b: Paragraph): Paragraph {
	const strippedText = a.strippedText + PARAGRAPH_GAP + b.strippedText;
	// The gap is whitespace and gets trimmed off sentence boundaries; any valid
	// source offset within the first paragraph keeps the map well-formed.
	const gapSource = a.strippedToSource[a.strippedToSource.length - 1] ?? a.sourceStart;
	const strippedToSource = new Uint32Array(
		a.strippedToSource.length + PARAGRAPH_GAP.length + b.strippedToSource.length,
	);
	strippedToSource.set(a.strippedToSource, 0);
	for (let k = 0; k < PARAGRAPH_GAP.length; k++) {
		strippedToSource[a.strippedToSource.length + k] = gapSource;
	}
	strippedToSource.set(b.strippedToSource, a.strippedToSource.length + PARAGRAPH_GAP.length);
	return {
		index: a.index,
		sourceStart: a.sourceStart,
		sourceEnd: b.sourceEnd,
		sourceText: a.sourceText + b.sourceText,
		strippedText,
		strippedToSource,
		byteLength: new TextEncoder().encode(strippedText).byteLength,
		headingLevel: a.headingLevel,
	};
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
		// A heading always begins a fresh paragraph, even with no blank line before it.
		if (headingLevelOf(nextLine) > 0) return lineEnd + 1;

		i = lineEnd + 1;
	}
	return i;
}
