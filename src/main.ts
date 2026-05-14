import { MarkdownView, Notice, Plugin } from "obsidian";
import { DEFAULT_SETTINGS, PluginSettings } from "./types";
import { ReadAloudSettingTab } from "./settings";
import { cacheKey, sha256Hex } from "./tts/Hash";
import { stripMarkdown } from "./editor/markdownStripper";
import { parseParagraphs } from "./editor/paragraphParser";
import { splitSentences } from "./editor/sentenceSplitter";
import { paragraphsFromSelection } from "./editor/selectionReader";
import {
	activeEditorView,
	applyHighlight,
	makeAutoPauseExtension,
	ttsHighlightField,
} from "./editor/highlightExtension";
import { Cache } from "./tts/Cache";
import { Synthesizer } from "./tts/Synthesizer";
import { Player } from "./playback/Player";
import { PlaybackQueue } from "./playback/PlaybackQueue";

export default class ReadAloudPlugin extends Plugin {
	settings!: PluginSettings;
	cache!: Cache;
	synthesizer!: Synthesizer;
	player!: Player;
	playbackQueue: PlaybackQueue | null = null;
	__devKey?: string;

	async onload() {
		await this.loadSettings();
		this.cache = new Cache(this.app.vault.adapter, this.settings.cacheMaxBytes);
		await this.cache.init();
		this.synthesizer = new Synthesizer(this.cache, () => this.resolveApiKey());
		let lastSentenceFrom: number | null = null;
		this.player = new Player({
			onHighlightChange: (state) => {
				const view = activeEditorView(this.app);
				if (!view) return;
				const sentenceChanged = state?.sentence.from !== lastSentenceFrom;
				lastSentenceFrom = state?.sentence.from ?? null;
				applyHighlight(view, state, sentenceChanged && state !== null);
			},
			onEnded: () => this.playbackQueue?.handleTrackEnded(),
			onError: (err) => {
				new Notice(`Playback error: ${err instanceof Error ? err.message : String(err)}`);
			},
		});
		this.registerEditorExtension([
			ttsHighlightField,
			makeAutoPauseExtension(() => this.playbackQueue),
		]);
		this.addSettingTab(new ReadAloudSettingTab(this.app, this));

		if (DEV) {
			(this as unknown as { devModules: unknown }).devModules = {
				tts: { Hash: { sha256Hex, cacheKey } },
				editor: {
					markdownStripper: { stripMarkdown },
					paragraphParser: { parseParagraphs },
					sentenceSplitter: { splitSentences },
					selectionReader: { paragraphsFromSelection },
					highlightExtension: { activeEditorView, applyHighlight },
				},
			};
		}
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<PluginSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	onunload() {
		this.playbackQueue?.stop();
		this.player?.dispose();
	}

	async startPlaybackFromCursor(): Promise<void> {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) {
			new Notice("Open a note to read aloud.");
			return;
		}
		const voiceId = this.settings.voiceId;
		if (!voiceId) {
			new Notice("Set a voice in plugin settings before playback.");
			return;
		}
		const source = view.editor.getValue();
		const paragraphs = parseParagraphs(source);
		if (paragraphs.length === 0) {
			new Notice("Note has no readable paragraphs.");
			return;
		}
		const cursorOffset = view.editor.posToOffset(view.editor.getCursor());
		const startIdx = findParagraphAtOffset(paragraphs, cursorOffset);
		this.playbackQueue?.stop();
		this.playbackQueue = new PlaybackQueue(paragraphs, voiceId, this.synthesizer, this.player, {
			prefetchLookahead: this.settings.prefetchLookahead,
			autoAdvance: this.settings.autoAdvance,
			onError: (err) => {
				new Notice(`Playback error: ${err instanceof Error ? err.message : String(err)}`);
			},
			onClearHighlight: () => {
				const v = activeEditorView(this.app);
				if (v) applyHighlight(v, null, false);
			},
		});
		await this.playbackQueue.play(startIdx);
	}

	private async resolveApiKey(): Promise<string> {
		if (this.__devKey) return this.__devKey;
		return "";
	}
}

function findParagraphAtOffset(
	paragraphs: { sourceStart: number; sourceEnd: number }[],
	offset: number,
): number {
	for (let i = 0; i < paragraphs.length; i++) {
		const p = paragraphs[i];
		if (p && offset <= p.sourceEnd) return i;
	}
	return Math.max(0, paragraphs.length - 1);
}
