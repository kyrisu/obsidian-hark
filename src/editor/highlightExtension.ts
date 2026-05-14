import { type ChangeSet, StateEffect, StateField } from "@codemirror/state";
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

export interface EditAffect {
	pauseRequired: boolean;
	invalidatePrefetchIndexes: number[];
}

export function classifyEdit(
	changes: ChangeSet,
	playingRange: { from: number; to: number } | null,
	prefetchedRanges: { index: number; from: number; to: number }[],
): EditAffect {
	// iterChanges yields positions in this update's pre-state; stored ranges drift after multiple
	// edits. Approximate enough for pause/invalidate decisions; an exact fix would re-map ranges
	// through each ChangeSet.
	let pauseRequired = false;
	const touchedPrefetch = new Set<number>();
	changes.iterChanges((fromA, toA) => {
		if (playingRange && !(toA < playingRange.from || fromA > playingRange.to)) {
			pauseRequired = true;
		}
		for (const r of prefetchedRanges) {
			if (!(toA < r.from || fromA > r.to)) touchedPrefetch.add(r.index);
		}
	});
	return { pauseRequired, invalidatePrefetchIndexes: [...touchedPrefetch] };
}

export interface AutoPauseQueue {
	affectedRange(): { from: number; to: number } | null;
	prefetchedRanges(): { index: number; from: number; to: number }[];
	pause(): void;
	invalidatePrefetch(index: number): void;
}

export function makeAutoPauseExtension(getQueue: () => AutoPauseQueue | null) {
	return EditorView.updateListener.of((update) => {
		if (!update.docChanged) return;
		const queue = getQueue();
		if (!queue) return;
		const decision = classifyEdit(
			update.changes,
			queue.affectedRange(),
			queue.prefetchedRanges(),
		);
		if (decision.pauseRequired) queue.pause();
		for (const idx of decision.invalidatePrefetchIndexes) queue.invalidatePrefetch(idx);
	});
}
