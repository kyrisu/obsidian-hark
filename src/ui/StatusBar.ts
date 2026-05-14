export type StatusBarState = "idle" | "playing" | "paused" | "loading" | "error";

export class StatusBar {
	constructor(private el: HTMLElement) {
		void this.el;
	}

	setState(_state: StatusBarState): void {}
}
