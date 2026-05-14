import { Editor, MarkdownView, Notice, Plugin } from "obsidian";
import { DEFAULT_SETTINGS, Paragraph, PluginSettings } from "./types";
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
import { PlaybackQueue, QueueState } from "./playback/PlaybackQueue";
import { registerCommands } from "./commands";
import { StatusBar, StatusBarState } from "./ui/StatusBar";
import { FloatingPlayer, FloatingPlayerState } from "./ui/FloatingPlayer";

const MIN_RATE = 0.5;
const MAX_RATE = 2.0;
const SPEED_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

export default class ReadAloudPlugin extends Plugin {
	settings!: PluginSettings;
	cache!: Cache;
	synthesizer!: Synthesizer;
	player!: Player;
	playbackQueue: PlaybackQueue | null = null;
	__devKey?: string;

	private statusBar: StatusBar | null = null;
	private floatingPlayer: FloatingPlayer | null = null;
	private activeTotalParagraphs = 0;

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

		const statusBarEl = this.addStatusBarItem();
		this.statusBar = new StatusBar(statusBarEl, () => this.playbackQueue?.togglePause());
		this.register(() => this.statusBar?.dispose());

		this.floatingPlayer = new FloatingPlayer({
			initialPosition: this.settings.floatingPlayerPosition,
			speeds: SPEED_OPTIONS,
			initialRate: this.settings.playbackRate,
			onPlayPause: () => this.playbackQueue?.togglePause(),
			onStop: () => this.playbackQueue?.stop(),
			onSkipNext: () => {
				void this.playbackQueue?.skipNext();
			},
			onSkipPrevious: () => {
				void this.playbackQueue?.skipPrevious();
			},
			onSpeedChange: (rate) => {
				void this.applyRate(rate);
			},
			onSeekFraction: (fraction) => {
				const duration = this.player.duration;
				if (duration > 0) this.player.seek(fraction * duration);
			},
			onPositionPersist: (pos) => {
				this.settings.floatingPlayerPosition = pos;
				void this.saveSettings();
			},
			getCurrentTime: () => this.player.currentTime,
			getDuration: () => this.player.duration,
		});
		this.register(() => this.floatingPlayer?.remove());

		this.addRibbonIcon("audio-file", "Read note aloud", () => {
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!view) {
				new Notice("Open a note to read aloud.");
				return;
			}
			void this.startPlaybackFromCursor(view.editor);
		});

		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor) => {
				if (editor.getSelection().length === 0) return;
				menu.addItem((item) =>
					item
						.setTitle("Read selection aloud")
						.setIcon("audio-file")
						.onClick(() => {
							void this.startPlaybackFromSelection(editor);
						}),
				);
			}),
		);

		registerCommands(this);

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

	async startPlaybackFromCursor(editor: Editor): Promise<void> {
		const paragraphs = parseParagraphs(editor.getValue());
		if (paragraphs.length === 0) {
			new Notice("Note has no readable paragraphs.");
			return;
		}
		const cursorOffset = editor.posToOffset(editor.getCursor());
		const startIdx = findParagraphAtOffset(paragraphs, cursorOffset);
		await this.startPlayback(paragraphs, startIdx);
	}

	async startPlaybackFromTop(editor: Editor): Promise<void> {
		const paragraphs = parseParagraphs(editor.getValue());
		if (paragraphs.length === 0) {
			new Notice("Note has no readable paragraphs.");
			return;
		}
		await this.startPlayback(paragraphs, 0);
	}

	async startPlaybackFromSelection(editor: Editor): Promise<void> {
		const documentParagraphs = parseParagraphs(editor.getValue());
		const selected = paragraphsFromSelection(editor, documentParagraphs);
		if (selected.length === 0) {
			new Notice("Make a selection to read aloud.");
			return;
		}
		await this.startPlayback(selected, 0);
	}

	bumpRate(delta: number): void {
		const next = clamp(this.settings.playbackRate + delta, MIN_RATE, MAX_RATE);
		void this.applyRate(next);
	}

	private async applyRate(rate: number): Promise<void> {
		const clamped = clamp(rate, MIN_RATE, MAX_RATE);
		this.settings.playbackRate = clamped;
		this.player.setRate(clamped);
		this.floatingPlayer?.setRate(clamped);
		await this.saveSettings();
	}

	private async startPlayback(paragraphs: Paragraph[], startIdx: number): Promise<void> {
		const voiceId = this.settings.voiceId;
		if (!voiceId) {
			new Notice("Set a voice in plugin settings before playback.");
			return;
		}
		this.playbackQueue?.stop();
		this.activeTotalParagraphs = paragraphs.length;
		this.floatingPlayer?.setParagraphIndex(startIdx, paragraphs.length);
		this.floatingPlayer?.setRate(this.settings.playbackRate);
		this.playbackQueue = new PlaybackQueue(paragraphs, voiceId, this.synthesizer, this.player, {
			prefetchLookahead: this.settings.prefetchLookahead,
			autoAdvance: this.settings.autoAdvance,
			onStateChange: (state) => this.handleQueueState(state),
			onPositionChange: (paragraphIdx) => {
				this.floatingPlayer?.setParagraphIndex(paragraphIdx, this.activeTotalParagraphs);
				this.player.setRate(this.settings.playbackRate);
			},
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

	private handleQueueState(state: QueueState): void {
		const ui = queueStateToUi(state);
		this.statusBar?.setState(ui);
		this.floatingPlayer?.setState(uiToFloating(ui));
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

function queueStateToUi(state: QueueState): StatusBarState {
	switch (state) {
		case "playing":
			return "playing";
		case "paused":
			return "paused";
		case "loading":
			return "loading";
		case "error":
			return "error";
		case "idle":
		case "ended":
		default:
			return "idle";
	}
}

function uiToFloating(state: StatusBarState): FloatingPlayerState {
	return state;
}

function clamp(value: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, value));
}
