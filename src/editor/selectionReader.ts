import type { Editor } from "obsidian";
import type { Paragraph } from "../types";
import { stripMarkdown } from "./markdownStripper";

export function paragraphsFromSelection(
	editor: Editor,
	documentParagraphs: Paragraph[],
): Paragraph[] {
	const fromOffset = editor.posToOffset(editor.getCursor("from"));
	const toOffset = editor.posToOffset(editor.getCursor("to"));
	if (fromOffset === toOffset) return [];

	const result: Paragraph[] = [];
	let outIdx = 0;

	for (const p of documentParagraphs) {
		if (p.sourceEnd <= fromOffset || p.sourceStart >= toOffset) continue;

		const trimStart = Math.max(p.sourceStart, fromOffset);
		const trimEnd = Math.min(p.sourceEnd, toOffset);

		if (trimStart === p.sourceStart && trimEnd === p.sourceEnd) {
			result.push({ ...p, index: outIdx++ });
			continue;
		}

		const sliceStart = trimStart - p.sourceStart;
		const sliceEnd = trimEnd - p.sourceStart;
		const sourceText = p.sourceText.slice(sliceStart, sliceEnd);
		const { strippedText, strippedToSource } = stripMarkdown(sourceText, trimStart);
		const byteLength = new TextEncoder().encode(strippedText).byteLength;
		result.push({
			index: outIdx++,
			sourceStart: trimStart,
			sourceEnd: trimEnd,
			sourceText,
			strippedText,
			strippedToSource,
			byteLength,
		});
	}

	return result;
}
