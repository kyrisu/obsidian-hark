import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { MarkdownView, type App } from "obsidian";

export interface TtsHighlightState {
	sentence: { from: number; to: number };
	word: { from: number; to: number } | null;
}

export const setTtsHighlight = StateEffect.define<TtsHighlightState | null>();

export const ttsHighlightField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(deco, tr) {
		for (const e of tr.effects) {
			if (e.is(setTtsHighlight)) {
				if (!e.value) return Decoration.none;
				const marks = [
					Decoration.mark({ class: "tts-sentence" }).range(
						e.value.sentence.from,
						e.value.sentence.to,
					),
				];
				if (e.value.word) {
					marks.push(
						Decoration.mark({ class: "tts-word-cursor" }).range(
							e.value.word.from,
							e.value.word.to,
						),
					);
				}
				// CM6 requires marks sorted by `from` ascending; sub-cursor sits inside the sentence range.
				marks.sort((a, b) => a.from - b.from);
				return Decoration.set(marks);
			}
		}
		return deco.map(tr.changes);
	},
	provide: (f) => EditorView.decorations.from(f),
});

export function applyHighlight(
	view: EditorView,
	state: TtsHighlightState | null,
	scroll: boolean,
): void {
	const effects: StateEffect<unknown>[] = [setTtsHighlight.of(state)];
	if (scroll && state) {
		effects.push(EditorView.scrollIntoView(state.sentence.from, { y: "center" }));
	}
	view.dispatch({ effects });
}

export function activeEditorView(app: App): EditorView | null {
	const view = app.workspace.getActiveViewOfType(MarkdownView);
	// `editor.cm` is not in public typings but is a stable community pattern for reaching the CM6 view.
	return ((view?.editor as { cm?: EditorView } | undefined)?.cm) ?? null;
}
