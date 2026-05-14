import { Plugin } from "obsidian";
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
	ttsHighlightField,
} from "./editor/highlightExtension";
import { Cache } from "./tts/Cache";
import { Synthesizer } from "./tts/Synthesizer";

export default class ReadAloudPlugin extends Plugin {
	settings!: PluginSettings;
	cache!: Cache;
	synthesizer!: Synthesizer;
	__devKey?: string;

	async onload() {
		await this.loadSettings();
		this.cache = new Cache(this.app.vault.adapter, this.settings.cacheMaxBytes);
		await this.cache.init();
		this.synthesizer = new Synthesizer(this.cache, () => this.resolveApiKey());
		this.registerEditorExtension(ttsHighlightField);
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

	onunload() {}

	private async resolveApiKey(): Promise<string> {
		if (this.__devKey) return this.__devKey;
		return "";
	}
}
