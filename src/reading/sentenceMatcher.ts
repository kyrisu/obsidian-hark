const WHITESPACE = /\s/;

interface Normalized {
	text: string;
	// rawIndex[i] is the offset in the original string of normalized character i.
	rawIndex: number[];
}

// Collapses every run of whitespace to a single space and trims leading/trailing
// whitespace, while recording, for each surviving character, its offset in the
// original string. A collapsed space is mapped to the first whitespace character
// of the run it replaces; that mapping is never read at a match boundary because
// the normalized sentence is trimmed (its first and last characters are
// non-whitespace), so boundaries always land on real characters.
function normalize(raw: string): Normalized {
	let text = "";
	const rawIndex: number[] = [];
	let pendingSpaceAt = -1;
	let started = false;
	for (let i = 0; i < raw.length; i++) {
		const ch = raw.charAt(i);
		if (WHITESPACE.test(ch)) {
			if (started && pendingSpaceAt === -1) pendingSpaceAt = i;
			continue;
		}
		if (pendingSpaceAt !== -1) {
			text += " ";
			rawIndex.push(pendingSpaceAt);
			pendingSpaceAt = -1;
		}
		text += ch;
		rawIndex.push(i);
		started = true;
	}
	return { text, rawIndex };
}

// Locates `sentenceText` within `buffer`, tolerant of whitespace differences
// between the rendered text and the stripped sentence (newlines, multiple
// spaces). Returns raw-buffer [start, end) offsets, or null when no contiguous
// match exists in the buffer (e.g. the rendered sentence contains math/embed/
// footnote-marker text absent from the stripped sentence). The search is scoped
// to a single section by the caller, so the first match within the buffer is the
// intended one; no forward cursor or backtrack window is needed.
export function findSentenceInText(
	buffer: string,
	sentenceText: string,
): { start: number; end: number } | null {
	const needle = normalize(sentenceText).text;
	if (needle.length === 0) return null;

	const hay = normalize(buffer);
	const at = hay.text.indexOf(needle);
	if (at === -1) return null;

	const start = hay.rawIndex[at];
	const lastChar = hay.rawIndex[at + needle.length - 1];
	if (start === undefined || lastChar === undefined) return null;
	return { start, end: lastChar + 1 };
}
