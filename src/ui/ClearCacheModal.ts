import { App, Modal, Setting } from "obsidian";
import { formatBytes } from "../utils/format";

export class ClearCacheModal extends Modal {
	constructor(
		app: App,
		private sizeBytes: number,
		private onConfirm: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText("Clear the audio cache?");
		this.contentEl.createEl("p", {
			text: `This deletes all cached audio (${formatBytes(this.sizeBytes)}). Notes will re-synthesise from the API on the next playback.`,
		});
		new Setting(this.contentEl)
			.addButton((b) =>
				b.setButtonText("Cancel").onClick(() => this.close()),
			)
			.addButton((b) =>
				b
					.setButtonText(`Clear (${formatBytes(this.sizeBytes)})`)
					.setWarning()
					.onClick(() => {
						this.onConfirm();
						this.close();
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
