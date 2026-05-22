import { MarkdownView, Notice } from "obsidian";
import type HarkPlugin from "../main";

export function registerCommands(plugin: HarkPlugin): void {
	// `checkCallback` rather than `editorCallback`: the latter is suppressed when
	// no editor is focused, so it never fires in Reading mode. `view.editor`
	// exists in both modes (`getCursor` returns the last cursor position).
	plugin.addCommand({
		id: "play-from-cursor",
		name: "Read note aloud from cursor",
		checkCallback: (checking) => {
			const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
			if (!view) return false;
			if (checking) return true;
			void plugin.startPlaybackFromCursor(view.editor);
			return true;
		},
	});
	plugin.addCommand({
		id: "play-from-top",
		name: "Read note aloud from beginning",
		checkCallback: (checking) => {
			const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
			if (!view) return false;
			if (checking) return true;
			void plugin.startPlaybackFromTop(view.editor);
			return true;
		},
	});
	plugin.addCommand({
		id: "pause-resume",
		name: "Pause or resume reading",
		callback: () => plugin.playbackQueue?.togglePause(),
	});
	plugin.addCommand({
		id: "stop",
		name: "Stop reading",
		callback: () => plugin.playbackQueue?.stop(),
	});
	plugin.addCommand({
		id: "speed-up",
		name: "Increase reading speed",
		callback: () => {
			void plugin.bumpRate(+0.25);
		},
	});
	plugin.addCommand({
		id: "speed-down",
		name: "Decrease reading speed",
		callback: () => {
			void plugin.bumpRate(-0.25);
		},
	});
	plugin.addCommand({
		id: "next-paragraph",
		name: "Skip to next section",
		callback: () => {
			void plugin.playbackQueue?.skipNext();
		},
	});
	plugin.addCommand({
		id: "previous-paragraph",
		name: "Go back one section",
		callback: () => {
			void plugin.playbackQueue?.skipPrevious();
		},
	});
	plugin.addCommand({
		id: "read-selection",
		name: "Read selection aloud",
		editorCheckCallback: (checking, editor) => {
			const hasSelection = editor.getSelection().length > 0;
			if (checking) return hasSelection;
			void plugin.startPlaybackFromSelection(editor);
			return true;
		},
	});
	plugin.addCommand({
		id: "clear-cache",
		name: "Clear cache",
		callback: async () => {
			await plugin.cache.clear();
			new Notice("Read aloud cache cleared.");
		},
	});
}
