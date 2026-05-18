import type { Paragraph } from "../types";

export interface Sentence {
	strippedStart: number;
	strippedEnd: number;
	sourceStart: number;
	sourceEnd: number;
	text: string;
	byteLength: number;
}

// Case-sensitive: lowercase entries are Polish, capitalized are English/Spanish
// titles. Lowercasing the lookup would merge English sentences ending in words
// like "CD." into whatever follows.
const ABBREVIATIONS = new Set([
	// English
	"Mr", "Mrs", "Ms", "Mx", "Dr", "Sr", "Jr", "St", "Mt", "Ft",
	"Rev", "Hon", "Prof", "Sen", "Gen", "Col", "Cmdr", "Capt", "Lt",
	"Sgt", "Cpl", "Pvt", "Inc", "Ltd", "Co", "Corp", "etc", "vs", "cf",
	"i.e", "e.g", "Ph.D", "U.S", "U.K", "a.m", "p.m",
	// Spanish
	"Sra", "Srta", "Sres", "Ud", "Uds", "Vd", "Vds", "Dra", "Dña",
	"Lic", "Ing", "Profa", "Gral", "Excmo", "Excma", "Sto", "Sta",
	"pág", "págs", "núm", "Av", "Avda",
	// Polish
	"np", "itd", "itp", "tj", "tzn", "tzw", "m.in", "dr", "prof",
	"mgr", "inż", "ul", "nr", "godz", "wg", "ds", "św", "płk",
	"kpt", "pkt", "ww", "cd",
]);

const WHITESPACE = /\s/;
const WORD_CHAR = /[\p{L}\p{N}]/u;
const TERMINATORS = ".!?";

export function splitSentences(paragraph: Paragraph): Sentence[] {
	const text = paragraph.strippedText;
	if (text.length === 0) return [];

	const boundaries: number[] = [];
	const parenStack: boolean[] = [];

	let i = 0;
	while (i < text.length) {
		const ch = text.charAt(i);

		// A blank line is a hard sentence boundary. It only ever appears here in
		// a paragraph merged from several (see groupParagraphs), so the
		// heading/sentence it joined stays a distinct sentence for highlight
		// and timing. A single newline (soft-wrapped line) is not a boundary.
		if (ch === "\n" && text.charAt(i + 1) === "\n") {
			let q = i;
			while (q < text.length && text.charAt(q) === "\n") q++;
			boundaries.push(i);
			// A blank line ends the joined paragraph: an unclosed bracket before
			// it must not suppress sentence breaks in what follows.
			parenStack.length = 0;
			i = q;
			continue;
		}

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

		sentences.push({
			strippedStart: start,
			strippedEnd: end,
			sourceStart,
			sourceEnd,
			text: senText,
			byteLength: new TextEncoder().encode(senText).byteLength,
		});
		prev = segEnd;
	}

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
		if (WORD_CHAR.test(ch) || ch === ".") {
			k--;
			continue;
		}
		break;
	}
	return text.slice(k + 1, atPunct);
}
