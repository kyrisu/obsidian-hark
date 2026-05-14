import { App, PluginSettingTab, Setting } from "obsidian";
import type ReadAloudPlugin from "./main";

export class ReadAloudSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		public plugin: ReadAloudPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("API credentials").setHeading();

		new Setting(containerEl)
			.setName("API key")
			.setDesc("Used to synthesise speech.")
			.addText((t) => t.setPlaceholder("Configured later"));
	}
}
