export interface StripResult {
	strippedText: string;
	strippedToSource: Uint32Array;
}

const MAX_HEADING_HASHES = 6;
const MAX_LEADING_SPACES = 3;

export function stripMarkdown(source: string, sourceBase: number): StripResult {
	const out: string[] = [];
	const map: number[] = [];

	const emitChar = (c: string, srcIdx: number) => {
		out.push(c);
		map.push(srcIdx + sourceBase);
	};

	const emitInner = (sub: StripResult) => {
		for (let k = 0; k < sub.strippedText.length; k++) {
			out.push(sub.strippedText.charAt(k));
			map.push(sub.strippedToSource[k] ?? 0);
		}
	};

	let i = 0;
	let atLineStart = true;

	while (i < source.length) {
		if (atLineStart) {
			const consumed = consumeLineStart(source, i);
			if (consumed > 0) {
				i += consumed;
				atLineStart = false;
				continue;
			}
		}

		const c = source.charAt(i);

		if (c === "\n") {
			emitChar("\n", i);
			i++;
			atLineStart = true;
			continue;
		}

		atLineStart = false;

		if ((c === "*" || c === "_") && source.charAt(i + 1) === c) {
			i += 2;
			continue;
		}
		if (c === "*" || c === "_") {
			i++;
			continue;
		}

		if (c === "~" && source.charAt(i + 1) === "~") {
			i += 2;
			continue;
		}

		if (c === "`") {
			const end = source.indexOf("`", i + 1);
			if (end > -1) {
				for (let j = i + 1; j < end; j++) {
					emitChar(source.charAt(j), j);
				}
				i = end + 1;
				continue;
			}
		}

		if (c === "[" && source.charAt(i + 1) === "^") {
			const end = source.indexOf("]", i + 2);
			if (end > -1) {
				i = end + 1;
				continue;
			}
		}

		if (c === "[" && source.charAt(i + 1) === "[") {
			const end = source.indexOf("]]", i + 2);
			if (end > -1) {
				const innerSlice = source.slice(i + 2, end);
				const pipeIdx = innerSlice.indexOf("|");
				const innerStart = pipeIdx > -1 ? i + 2 + pipeIdx + 1 : i + 2;
				const sub = stripMarkdown(
					source.slice(innerStart, end),
					sourceBase + innerStart,
				);
				emitInner(sub);
				i = end + 2;
				continue;
			}
		}

		if (c === "!" && source.charAt(i + 1) === "[") {
			const close = source.indexOf("]", i + 2);
			if (close > -1 && source.charAt(close + 1) === "(") {
				const parenClose = source.indexOf(")", close + 2);
				if (parenClose > -1) {
					const sub = stripMarkdown(
						source.slice(i + 2, close),
						sourceBase + i + 2,
					);
					emitInner(sub);
					i = parenClose + 1;
					continue;
				}
			}
		}

		if (c === "[") {
			const close = source.indexOf("]", i + 1);
			if (close > -1 && source.charAt(close + 1) === "(") {
				const parenClose = source.indexOf(")", close + 2);
				if (parenClose > -1) {
					const sub = stripMarkdown(
						source.slice(i + 1, close),
						sourceBase + i + 1,
					);
					emitInner(sub);
					i = parenClose + 1;
					continue;
				}
			}
		}

		if (c === "$" && source.charAt(i + 1) === "$") {
			const end = source.indexOf("$$", i + 2);
			if (end > -1) {
				i = end + 2;
				continue;
			}
		}

		if (c === "$" && i + 1 < source.length) {
			const next = source.charAt(i + 1);
			if (next !== " " && next !== "\n" && next !== "\t" && next !== "$") {
				let q = i + 1;
				let found = -1;
				while (q < source.length && source.charAt(q) !== "\n") {
					if (
						source.charAt(q) === "$" &&
						q > i + 1 &&
						source.charAt(q - 1) !== " " &&
						source.charAt(q - 1) !== "\t"
					) {
						found = q;
						break;
					}
					q++;
				}
				if (found > -1) {
					i = found + 1;
					continue;
				}
			}
		}

		if (c === "<") {
			const next = source.charAt(i + 1);
			const isTagStart =
				next === "/" ||
				next === "!" ||
				(next >= "a" && next <= "z") ||
				(next >= "A" && next <= "Z");
			if (isTagStart) {
				const end = source.indexOf(">", i + 1);
				if (end > -1) {
					i = end + 1;
					continue;
				}
			}
		}

		emitChar(c, i);
		i++;
	}

	return {
		strippedText: out.join(""),
		strippedToSource: new Uint32Array(map),
	};
}

function consumeLineStart(source: string, i: number): number {
	let p = i;
	let leadingSpaces = 0;
	while (
		p < source.length &&
		source.charAt(p) === " " &&
		leadingSpaces < MAX_LEADING_SPACES
	) {
		p++;
		leadingSpaces++;
	}

	if (source.charAt(p) === "#") {
		let q = p;
		let hashCount = 0;
		while (
			q < source.length &&
			source.charAt(q) === "#" &&
			hashCount < MAX_HEADING_HASHES
		) {
			q++;
			hashCount++;
		}
		if (q < source.length && (source.charAt(q) === " " || source.charAt(q) === "\t")) {
			while (q < source.length && (source.charAt(q) === " " || source.charAt(q) === "\t")) {
				q++;
			}
			return q - i;
		}
	}

	if (source.charAt(p) === ">") {
		let q = p;
		while (q < source.length && source.charAt(q) === ">") q++;
		if (source.charAt(q) === " ") q++;
		return q - i;
	}

	const marker = source.charAt(p);
	if ((marker === "-" || marker === "*" || marker === "+") && source.charAt(p + 1) === " ") {
		return p + 2 - i;
	}

	let q = p;
	while (q < source.length) {
		const ch = source.charAt(q);
		if (ch < "0" || ch > "9") break;
		q++;
	}
	if (q > p && source.charAt(q) === "." && source.charAt(q + 1) === " ") {
		return q + 2 - i;
	}

	if (source.charAt(p) === "=" || source.charAt(p) === "-") {
		const lineCh = source.charAt(p);
		let r = p;
		while (r < source.length && source.charAt(r) === lineCh) r++;
		if (r - p >= 2 && (r === source.length || source.charAt(r) === "\n")) {
			return r - i;
		}
	}

	return 0;
}
