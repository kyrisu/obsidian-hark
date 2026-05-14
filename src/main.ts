import { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, PluginSettings } from "./types";
import { ReadAloudSettingTab } from "./settings";
import { cacheKey, sha256Hex } from "./tts/Hash";
import { stripMarkdown } from "./editor/markdownStripper";
import { parseParagraphs } from "./editor/paragraphParser";
import { splitSentences } from "./editor/sentenceSplitter";
import { paragraphsFromSelection } from "./editor/selectionReader";

export default class ReadAloudPlugin extends Plugin {
	settings!: PluginSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new ReadAloudSettingTab(this.app, this));

		if (DEV) {
			(this as unknown as { devModules: unknown }).devModules = {
				tts: { Hash: { sha256Hex, cacheKey } },
				editor: {
					markdownStripper: { stripMarkdown },
					paragraphParser: { parseParagraphs },
					sentenceSplitter: { splitSentences },
					selectionReader: { paragraphsFromSelection },
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
}
