import { App, Notice, PluginSettingTab, SecretComponent, Setting } from "obsidian";
import type ReadAloudPlugin from "./main";
import { GOOGLE_TTS_SECRET_ID } from "./types";
import { GEMINI_VOICES, type GeminiVoice } from "./tts/voices";
import { validateApiKey } from "./tts/GeminiTtsClient";
import { VoicePreview } from "./tts/VoicePreview";
import { ClearCacheModal } from "./ui/ClearCacheModal";
import { MAX_RATE, MIN_RATE } from "./playback/rate";
import { formatBytes } from "./utils/format";

const MB = 1024 * 1024;
const MIN_CACHE_MB = 100;
const MAX_CACHE_MB = 2048;
const CACHE_STEP_MB = 100;
const API_KEY_URL = "https://aistudio.google.com/apikey";

export class ReadAloudSettingTab extends PluginSettingTab {
	private voicePreview: VoicePreview;

	constructor(
		app: App,
		public plugin: ReadAloudPlugin,
	) {
		super(app, plugin);
		this.voicePreview = new VoicePreview(() => this.plugin.getGoogleApiKey());
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		this.renderCredentials(containerEl);
		this.renderVoice(containerEl);
		this.renderPlayback(containerEl);
		this.renderCache(containerEl);
	}

	hide(): void {
		this.voicePreview.dispose();
	}

	private renderCredentials(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("API credentials").setHeading();

		const desc = new DocumentFragment();
		desc.append("Your Google Gemini API key, kept in Obsidian's secret storage. ");
		desc.createEl("a", { text: "Get a key", href: API_KEY_URL });

		new Setting(containerEl)
			.setName("Gemini API key")
			.setDesc(desc)
			.addComponent((el) => {
				const secret = new SecretComponent(this.app, el);
				secret.setValue(this.app.secretStorage.getSecret(GOOGLE_TTS_SECRET_ID) ?? "");
				secret.onChange((value) => {
					this.app.secretStorage.setSecret(GOOGLE_TTS_SECRET_ID, value.trim());
				});
				return secret;
			});

		const validateSetting = new Setting(containerEl)
			.setName("Validate key")
			.setDesc("Sends a no-cost request to confirm the key works.");
		const statusEl = validateSetting.controlEl.createSpan({ cls: "tts-settings-status" });
		validateSetting.addButton((btn) =>
			btn.setButtonText("Validate").onClick(async () => {
				btn.setDisabled(true);
				statusEl.setText("Validating…");
				statusEl.removeClasses(["is-ok", "is-error"]);
				try {
					const result = await validateApiKey(await this.plugin.getGoogleApiKey());
					statusEl.setText(result.message);
					statusEl.toggleClass("is-ok", result.ok);
					statusEl.toggleClass("is-error", !result.ok);
				} finally {
					btn.setDisabled(false);
				}
			}),
		);
	}

	private renderVoice(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Voice").setHeading();

		new Setting(containerEl)
			.setName("Voice")
			.setDesc("Gemini voice used to read notes aloud.")
			.addDropdown((dd) => {
				for (const voice of GEMINI_VOICES) {
					dd.addOption(voice.id, `${voice.displayName} (${genderLabel(voice.gender)})`);
				}
				dd.setValue(this.plugin.settings.voiceId);
				dd.onChange(async (value) => {
					this.plugin.settings.voiceId = value;
					await this.plugin.saveSettings();
				});
			})
			.addButton((btn) =>
				btn
					.setIcon("play")
					.setButtonText("Preview")
					.onClick(() => {
						this.voicePreview.play(this.plugin.settings.voiceId).catch((err) => {
							new Notice(
								`Voice preview failed: ${err instanceof Error ? err.message : String(err)}`,
							);
						});
					}),
			);
	}

	private renderPlayback(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Playback").setHeading();

		new Setting(containerEl)
			.setName("Default speed")
			.setDesc("Playback rate applied when a note starts.")
			.addSlider((s) =>
				s
					.setLimits(MIN_RATE, MAX_RATE, 0.25)
					.setValue(this.plugin.settings.playbackRate)
					.setDynamicTooltip()
					.onChange((value) => {
						void this.plugin.applyRate(value);
					}),
			);

		new Setting(containerEl)
			.setName("Auto-advance")
			.setDesc("Continue to the next paragraph automatically.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.autoAdvance).onChange(async (value) => {
					this.plugin.settings.autoAdvance = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Prefetch lookahead")
			.setDesc("Paragraphs to synthesise ahead of the one playing.")
			.addSlider((s) =>
				s
					.setLimits(1, 3, 1)
					.setValue(this.plugin.settings.prefetchLookahead)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.prefetchLookahead = value;
						await this.plugin.saveSettings();
					}),
			);
	}

	private renderCache(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Cache").setHeading();

		const sizeSetting = new Setting(containerEl).setName("Cache size").setDesc("Loading…");
		void this.plugin.cache.size().then((bytes) => {
			sizeSetting.setDesc(
				`${formatBytes(bytes)} of ${formatBytes(this.plugin.settings.cacheMaxBytes)} used.`,
			);
		});

		new Setting(containerEl)
			.setName("Cache size limit")
			.setDesc("Maximum disk space for cached audio, in megabytes.")
			.addSlider((s) =>
				s
					.setLimits(MIN_CACHE_MB, MAX_CACHE_MB, CACHE_STEP_MB)
					.setValue(Math.round(this.plugin.settings.cacheMaxBytes / MB))
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.cacheMaxBytes = value * MB;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Clear cache")
			.setDesc("Delete every cached audio file.")
			.addButton((btn) =>
				btn
					.setButtonText("Clear cache")
					.setWarning()
					.onClick(async () => {
						const bytes = await this.plugin.cache.size();
						new ClearCacheModal(this.app, bytes, () => {
							void this.plugin.cache.clear().then(() => {
								new Notice("Audio cache cleared.");
								this.display();
							});
						}).open();
					}),
			);
	}
}

function genderLabel(gender: GeminiVoice["gender"]): string {
	if (gender === "F") return "Female";
	if (gender === "M") return "Male";
	return "Neutral";
}
