import type { PlaybackUiState } from "../types";

const LABELS: Record<PlaybackUiState, string> = {
	idle: "",
	loading: "Loading audio…",
	playing: "▶ Reading",
	paused: "⏸ Paused",
	error: "⚠ Read aloud error",
};

export class StatusBar {
	private state: PlaybackUiState = "idle";

	constructor(
		private readonly el: HTMLElement,
		private readonly onToggle: () => void,
	) {
		this.el.addClass("tts-status-bar");
		this.el.setAttribute("role", "status");
		this.el.setAttribute("aria-live", "polite");
		this.el.addEventListener("click", this.handleClick);
		this.render();
	}

	setState(next: PlaybackUiState): void {
		if (this.state === next) return;
		this.state = next;
		this.render();
	}

	dispose(): void {
		this.el.removeEventListener("click", this.handleClick);
	}

	private handleClick = (): void => {
		if (this.state === "playing" || this.state === "paused")
			this.onToggle();
	};

	private render(): void {
		this.el.setText(LABELS[this.state]);
		this.el.toggleClass("tts-status-bar--hidden", this.state === "idle");
	}
}
