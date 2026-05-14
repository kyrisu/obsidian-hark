import type { Paragraph, SourceWord } from "../types";

export interface Sentence {
	strippedStart: number;
	strippedEnd: number;
	sourceStart: number;
	sourceEnd: number;
	text: string;
	byteLength: number;
	words: SourceWord[];
}

const ABBREVIATIONS = new Set([
	"Mr", "Mrs", "Ms", "Mx", "Dr", "Sr", "Jr", "St", "Mt", "Ft",
	"Rev", "Hon", "Prof", "Sen", "Gen", "Col", "Cmdr", "Capt", "Lt",
	"Sgt", "Cpl", "Pvt", "Inc", "Ltd", "Co", "Corp", "etc", "vs", "cf",
	"i.e", "e.g", "Ph.D", "U.S", "U.K", "a.m", "p.m",
]);

const WHITESPACE = /\s/;
const TERMINATORS = ".!?";

export function splitSentences(paragraph: Paragraph): Sentence[] {
	const text = paragraph.strippedText;
	if (text.length === 0) return [];

	const boundaries: number[] = [];
	const parenStack: boolean[] = [];

	let i = 0;
	while (i < text.length) {
		const ch = text.charAt(i);

		if (ch === "(" || ch === "[") {
			parenStack.push(false);
			i++;
			continue;
		}

		if (ch === ")" || ch === "]") {
			const hadTerminator = parenStack.pop() ?? false;
			if (hadTerminator) {
				const after = i + 1;
				if (after >= text.length || WHITESPACE.test(text.charAt(after))) {
					boundaries.push(after);
					i = skipWhitespace(text, after);
					continue;
				}
			}
			i++;
			continue;
		}

		if (TERMINATORS.includes(ch)) {
			let q = i;
			while (q < text.length && TERMINATORS.includes(text.charAt(q))) q++;
			const afterPunct = q;

			if (parenStack.length > 0) {
				parenStack[parenStack.length - 1] = true;
				i = q;
				continue;
			}

			if (afterPunct >= text.length || WHITESPACE.test(text.charAt(afterPunct))) {
				const word = wordBefore(text, i);
				if (!ABBREVIATIONS.has(word)) {
					boundaries.push(afterPunct);
					i = skipWhitespace(text, afterPunct);
					continue;
				}
			}
			i = q;
			continue;
		}

		i++;
	}

	const segments = boundaries[boundaries.length - 1] === text.length
		? boundaries
		: [...boundaries, text.length];

	const sentences: Sentence[] = [];
	let prev = 0;
	let sIdx = 0;

	for (const segEnd of segments) {
		const start = skipWhitespace(text, prev);
		if (start >= segEnd) {
			prev = segEnd;
			continue;
		}
		let end = segEnd;
		while (end > start && WHITESPACE.test(text.charAt(end - 1))) end--;
		if (end <= start) {
			prev = segEnd;
			continue;
		}

		const senText = text.slice(start, end);
		const sourceStart = paragraph.strippedToSource[start] ?? paragraph.sourceStart;
		const lastSourceIdx = paragraph.strippedToSource[end - 1] ?? paragraph.sourceStart;
		const sourceEnd = lastSourceIdx + 1;

		const words = tokenizeWords(text, start, end, paragraph);

		sentences.push({
			strippedStart: start,
			strippedEnd: end,
			sourceStart,
			sourceEnd,
			text: senText,
			byteLength: new TextEncoder().encode(senText).byteLength,
			words,
		});
		sIdx++;
		prev = segEnd;
	}

	void sIdx;
	return sentences;
}

function skipWhitespace(text: string, from: number): number {
	let i = from;
	while (i < text.length && WHITESPACE.test(text.charAt(i))) i++;
	return i;
}

function wordBefore(text: string, atPunct: number): string {
	let k = atPunct - 1;
	while (k >= 0) {
		const ch = text.charAt(k);
		if ((ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9") || ch === ".") {
			k--;
			continue;
		}
		break;
	}
	return text.slice(k + 1, atPunct);
}

function tokenizeWords(
	text: string,
	start: number,
	end: number,
	paragraph: Paragraph,
): SourceWord[] {
	const words: SourceWord[] = [];
	let wordStart = -1;
	for (let k = start; k <= end; k++) {
		const isBoundary = k >= end || WHITESPACE.test(text.charAt(k));
		if (isBoundary) {
			if (wordStart !== -1) {
				const wText = text.slice(wordStart, k);
				const wSrcStart = paragraph.strippedToSource[wordStart] ?? paragraph.sourceStart;
				const wSrcEnd =
					(paragraph.strippedToSource[k - 1] ?? paragraph.sourceStart) + 1;
				words.push({ text: wText, sourceStart: wSrcStart, sourceEnd: wSrcEnd });
				wordStart = -1;
			}
		} else if (wordStart === -1) {
			wordStart = k;
		}
	}
	return words;
}
