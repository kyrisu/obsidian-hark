export interface TextIndex {
	buffer: string;
	// Maps raw-buffer offsets [start, end) to a DOM Range, or null when the
	// offsets fall outside the buffer.
	rangeFor(start: number, end: number): Range | null;
}

interface Segment {
	node: Text;
	bufferStart: number;
}

// Walks every text node under `root` in document order into one flat buffer,
// recording each node's start offset, and returns an index that converts
// raw-buffer offsets back into a DOM Range. The walk is element-agnostic, so a
// Range can span inline element boundaries (bold/link/code) transparently.
export function buildTextIndex(root: HTMLElement): TextIndex {
	const walker = root.ownerDocument.createTreeWalker(
		root,
		NodeFilter.SHOW_TEXT,
	);
	const segments: Segment[] = [];
	let buffer = "";
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const text = node as Text;
		segments.push({ node: text, bufferStart: buffer.length });
		buffer += text.data;
	}

	// Resolves a buffer character position to its containing text node and the
	// local offset within that node, skipping zero-length nodes.
	function charAt(pos: number): { node: Text; offset: number } | null {
		let lo = 0;
		let hi = segments.length - 1;
		let found = -1;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			const seg = segments[mid];
			if (seg && seg.bufferStart <= pos) {
				found = mid;
				lo = mid + 1;
			} else {
				hi = mid - 1;
			}
		}
		while (found >= 0 && found < segments.length) {
			const seg = segments[found];
			if (seg && pos < seg.bufferStart + seg.node.data.length) break;
			found++;
		}
		const seg =
			found >= 0 && found < segments.length ? segments[found] : undefined;
		if (!seg || pos < seg.bufferStart) return null;
		return { node: seg.node, offset: pos - seg.bufferStart };
	}

	function rangeFor(start: number, end: number): Range | null {
		if (start < 0 || end > buffer.length || start >= end) return null;
		const s = charAt(start);
		// `end` is exclusive: the last included character is at end - 1, and the
		// range end sits just after it.
		const e = charAt(end - 1);
		if (!s || !e) return null;
		const range = root.ownerDocument.createRange();
		range.setStart(s.node, s.offset);
		range.setEnd(e.node, e.offset + 1);
		return range;
	}

	return { buffer, rangeFor };
}
