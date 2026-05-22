import { Editor, MarkdownView, Notice, Plugin } from "obsidian";
import {
	DEFAULT_SETTINGS,
	GEMINI_API_KEY_SECRET_ID,
	Paragraph,
	PlaybackUiState,
	PluginSettings,
} from "./types";
import { HarkSettingTab } from "./settings";
import { groupParagraphs, parseParagraphs } from "./editor/paragraphParser";
import { paragraphsFromSelection } from "./editor/selectionReader";
import { ACTIVE_TTS_MODEL } from "./tts/GeminiTtsClient";
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
import {
	attachMediaSession,
	setNowPlaying,
	setPlaybackState,
} from "./playback/MediaSessionBinding";
import { MAX_RATE, MIN_RATE, SPEED_OPTIONS } from "./playback/rate";
import { registerCommands } from "./commands";
import { StatusBar } from "./ui/StatusBar";
import { FloatingPlayer } from "./ui/FloatingPlayer";
import { ReadingHighlighter } from "./reading/ReadingHighlighter";
import { clamp } from "./utils/math";

export default class HarkPlugin extends Plugin {
	settings!: PluginSettings;
	cache!: Cache;
	synthesizer!: Synthesizer;
	player!: Player;
	playbackQueue: PlaybackQueue | null = null;

	private statusBar: StatusBar | null = null;
	private floatingPlayer: FloatingPlayer | null = null;
	private readingHighlighter: ReadingHighlighter | null = null;

	async onload() {
		await this.loadSettings();
		this.cache = new Cache(
			this.app.vault.adapter,
			this.settings.cacheMaxBytes,
		);
		await this.cache.init();
		this.synthesizer = new Synthesizer(this.cache, () => this.getApiKey());
		this.readingHighlighter = new ReadingHighlighter(() => {
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			return view && view.getMode() === "preview" ? view : null;
		});
		this.register(() => this.readingHighlighter?.dispose());
		let lastSentenceFrom: number | null = null;
		this.player = new Player({
			onHighlightChange: (state) => {
				const view =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view) {
					this.readingHighlighter?.clear();
					return;
				}
				if (view.getMode() === "preview") {
					if (state === null) {
						this.readingHighlighter?.clear();
						return;
					}
					this.readingHighlighter?.highlight(state);
					return;
				}
				this.readingHighlighter?.clear();
				const cm = activeEditorView(this.app);
				if (!cm) return;
				const sentenceChanged =
					state?.sentence.from !== lastSentenceFrom;
				lastSentenceFrom = state?.sentence.from ?? null;
				applyHighlight(cm, state, sentenceChanged && state !== null);
			},
			onEnded: () => this.playbackQueue?.handleTrackEnded(),
			onError: (err) => {
				new Notice(
					`Playback error: ${err instanceof Error ? err.message : String(err)}`,
				);
			},
		});
		this.registerEditorExtension([
			ttsHighlightField,
			makeAutoPauseExtension(() => this.playbackQueue),
		]);
		this.addSettingTab(new HarkSettingTab(this.app, this));

		const statusBarEl = this.addStatusBarItem();
		this.statusBar = new StatusBar(statusBarEl, () =>
			this.playbackQueue?.togglePause(),
		);
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

		this.addRibbonIcon("audio-file", "Read aloud from cursor", () => {
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!view) {
				new Notice("Open a note to read aloud.");
				return;
			}
			void this.startPlaybackFromCursor(view.editor);
		});

		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor) => {
				menu.addItem((item) =>
					item
						.setTitle("Read aloud from here")
						.setIcon("audio-file")
						.onClick(() => {
							void this.startPlaybackFromCursor(editor);
						}),
				);
				if (editor.getSelection().length > 0) {
					menu.addItem((item) =>
						item
							.setTitle("Read selection aloud")
							.setIcon("audio-file")
							.onClick(() => {
								void this.startPlaybackFromSelection(editor);
							}),
					);
				}
			}),
		);

		// The reading highlight paints a Range over nodes in the active document; a
		// leaf or file change leaves those nodes stale, so drop it on either event.
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () =>
				this.readingHighlighter?.clear(),
			),
		);
		this.registerEvent(
			this.app.workspace.on("file-open", () =>
				this.readingHighlighter?.clear(),
			),
		);

		const detachMediaSession = attachMediaSession({
			togglePause: () => this.playbackQueue?.togglePause(),
			stop: () => this.playbackQueue?.stop(),
			skipNext: () => {
				void this.playbackQueue?.skipNext();
			},
			skipPrevious: () => {
				void this.playbackQueue?.skipPrevious();
			},
		});
		this.register(detachMediaSession);

		registerCommands(this);
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
		this.cache.setMaxBytes(this.settings.cacheMaxBytes);
		this.playbackQueue?.applySettings({
			voiceId: this.settings.voiceId,
			prefetchLookahead: this.settings.prefetchLookahead,
			autoAdvance: this.settings.autoAdvance,
		});
	}

	async getApiKey(): Promise<string> {
		return this.app.secretStorage.getSecret(GEMINI_API_KEY_SECRET_ID) ?? "";
	}

	onunload() {
		this.playbackQueue?.stop();
		this.player?.dispose();
	}

	async startPlaybackFromCursor(editor: Editor): Promise<void> {
		await this.startFromFullDoc(editor, (paragraphs) =>
			findParagraphAtOffset(
				paragraphs,
				editor.posToOffset(editor.getCursor()),
			),
		);
	}

	async startPlaybackFromTop(editor: Editor): Promise<void> {
		await this.startFromFullDoc(editor, () => 0);
	}

	async startPlaybackFromSelection(editor: Editor): Promise<void> {
		const documentParagraphs = parseParagraphs(editor.getValue());
		const selected = paragraphsFromSelection(editor, documentParagraphs);
		if (selected.length === 0) {
			new Notice("Make a selection to read aloud.");
			return;
		}
		const groups = groupParagraphs(
			selected,
			0,
			ACTIVE_TTS_MODEL.maxRequestBytes,
		);
		await this.startPlayback(groups);
	}

	bumpRate(delta: number): void {
		void this.applyRate(this.settings.playbackRate + delta);
	}

	async applyRate(rate: number): Promise<void> {
		const clamped = clamp(rate, MIN_RATE, MAX_RATE);
		this.settings.playbackRate = clamped;
		this.player.setRate(clamped);
		this.floatingPlayer?.setRate(clamped);
		await this.saveSettings();
	}

	private async startFromFullDoc(
		editor: Editor,
		pickStart: (paragraphs: Paragraph[]) => number,
	): Promise<void> {
		const paragraphs = parseParagraphs(editor.getValue());
		if (paragraphs.length === 0) {
			new Notice("Note has no readable paragraphs.");
			return;
		}
		const groups = groupParagraphs(
			paragraphs,
			pickStart(paragraphs),
			ACTIVE_TTS_MODEL.maxRequestBytes,
		);
		await this.startPlayback(groups);
	}

	private async startPlayback(paragraphs: Paragraph[]): Promise<void> {
		const voiceId = this.settings.voiceId;
		if (!voiceId) {
			new Notice("Set a voice in plugin settings before playback.");
			return;
		}
		this.playbackQueue?.stop();
		setNowPlaying({
			title: this.app.workspace.getActiveFile()?.basename ?? "Untitled",
			artist: "Hark",
		});
		this.floatingPlayer?.setParagraphIndex(0, paragraphs.length);
		this.floatingPlayer?.setRate(this.settings.playbackRate);
		this.playbackQueue = new PlaybackQueue(
			paragraphs,
			voiceId,
			this.synthesizer,
			this.player,
			{
				prefetchLookahead: this.settings.prefetchLookahead,
				autoAdvance: this.settings.autoAdvance,
				onStateChange: (state) => this.handleQueueState(state),
				onPositionChange: (paragraphIdx) => {
					const count = this.playbackQueue?.paragraphCount ?? 0;
					this.floatingPlayer?.setParagraphIndex(paragraphIdx, count);
					// Re-apply rate after each track load: el.src reassignment may reset playbackRate
					// in some browsers, so the explicit re-application keeps bumpRate / dropdown changes sticky.
					this.player.setRate(this.settings.playbackRate);
				},
				onError: (err) => {
					new Notice(
						`Playback error: ${err instanceof Error ? err.message : String(err)}`,
					);
				},
				onClearHighlight: () => {
					this.readingHighlighter?.clear();
					const v = activeEditorView(this.app);
					if (v) applyHighlight(v, null, false);
				},
			},
		);
		await this.playbackQueue.play(0);
	}

	private handleQueueState(state: QueueState): void {
		const ui = queueStateToUi(state);
		this.statusBar?.setState(ui);
		this.floatingPlayer?.setState(ui);
		// Treat `loading` as `playing` so the OS Now Playing widget appears
		// immediately on the first press instead of flickering through `none`.
		setPlaybackState(
			state === "playing" || state === "loading"
				? "playing"
				: state === "paused"
					? "paused"
					: "none",
		);
		if (state === "idle" || state === "ended") setNowPlaying(null);
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

function queueStateToUi(state: QueueState): PlaybackUiState {
	if (state === "ended") return "idle";
	return state;
}
