import { setIcon } from "obsidian";
import type { PlaybackUiState } from "../types";
import { clamp } from "../utils/math";

export interface FloatingPlayerOptions {
	initialPosition: { x: number; y: number } | null;
	speeds: readonly number[];
	initialRate: number;
	onPlayPause: () => void;
	onStop: () => void;
	onSkipNext: () => void;
	onSkipPrevious: () => void;
	onSpeedChange: (rate: number) => void;
	onSeekFraction: (fraction: number) => void;
	onPositionPersist: (pos: { x: number; y: number }) => void;
	getCurrentTime: () => number;
	getDuration: () => number;
}

const TICK_MS = 250;
const MARGIN = 8;

export class FloatingPlayer {
	private readonly root: HTMLElement;
	private readonly handle: HTMLElement;
	private readonly playPauseBtn: HTMLButtonElement;
	private readonly paraIndicator: HTMLElement;
	private readonly progressTrack: HTMLElement;
	private readonly progressFill: HTMLElement;
	private readonly timeLabel: HTMLElement;
	private readonly speedSelect: HTMLSelectElement;
	private state: PlaybackUiState = "idle";
	private tickHandle: number | null = null;
	private drag: { offsetX: number; offsetY: number; width: number; height: number } | null = null;
	private lastProgressWidth = -1;
	private lastTimeLabel = "";

	constructor(private readonly options: FloatingPlayerOptions) {
		this.root = document.createElement("div");
		this.root.addClass("tts-floating-player");
		this.root.setAttribute("data-state", "idle");

		this.handle = this.root.createEl("div", {
			cls: "tts-floating-player__drag",
			text: "⠿",
			attr: { title: "Drag to move" },
		});
		this.handle.addEventListener("mousedown", this.handleDragStart);

		const controls = this.root.createEl("div", { cls: "tts-floating-player__controls" });

		this.makeButton(controls, "skip-back", "Previous section", () =>
			this.options.onSkipPrevious(),
		);
		this.playPauseBtn = this.makeButton(controls, "play", "Play / pause", () =>
			this.options.onPlayPause(),
		);
		this.makeButton(controls, "skip-forward", "Next section", () => this.options.onSkipNext());
		this.makeButton(controls, "square", "Stop", () => this.options.onStop());

		this.paraIndicator = controls.createEl("span", {
			cls: "tts-floating-player__paragraph",
			text: "—",
		});

		this.progressTrack = controls.createEl("div", { cls: "tts-floating-player__progress" });
		this.progressFill = this.progressTrack.createEl("div", {
			cls: "tts-floating-player__progress-fill",
		});
		this.progressTrack.addEventListener("click", this.handleSeekClick);

		// Shown only while loading; swaps in for the (frozen) seek bar, so the
		// player keeps its width. Decorative — the status bar carries the
		// "Loading audio…" announcement for screen readers.
		const equalizer = controls.createEl("div", {
			cls: "tts-floating-player__equalizer",
			attr: { "aria-hidden": "true" },
		});
		const barCount = 16;
		for (let i = 0; i < barCount; i++) {
			const bar = equalizer.createEl("span");
			// Negative, linearly increasing delay makes the pulse travel
			// left-to-right across the bars.
			const delay = -(i / barCount);
			bar.setCssStyles({ animationDelay: `${delay.toFixed(3)}s` });
		}

		this.timeLabel = controls.createEl("span", {
			cls: "tts-floating-player__time",
			text: "00:00 / 00:00",
		});

		this.speedSelect = controls.createEl("select", { cls: "tts-floating-player__speed" });
		for (const s of options.speeds) {
			this.speedSelect.createEl("option", { value: String(s), text: `${s}×` });
		}
		this.speedSelect.value = nearestSpeed(options.speeds, options.initialRate);
		this.speedSelect.addEventListener("change", () => {
			const rate = Number(this.speedSelect.value);
			if (Number.isFinite(rate)) this.options.onSpeedChange(rate);
		});

		document.body.appendChild(this.root);
		this.applyInitialPosition(options.initialPosition);
	}

	setState(next: PlaybackUiState): void {
		if (this.state === next) return;
		this.state = next;
		this.root.setAttribute("data-state", next);
		// Leave the play/pause icon untouched while loading so a mid-note gap
		// keeps the pause icon (the user is still conceptually playing).
		if (next !== "loading")
			setIcon(this.playPauseBtn, next === "playing" ? "pause" : "play");
		if (next === "playing") this.startTick();
		else this.stopTick();
		if (next === "idle") this.updateProgress(0, 0);
	}

	setParagraphIndex(idx: number, total: number): void {
		this.paraIndicator.textContent = total <= 0 ? "—" : `${idx + 1} / ${total}`;
	}

	setRate(rate: number): void {
		this.speedSelect.value = nearestSpeed(this.options.speeds, rate);
	}

	remove(): void {
		this.stopTick();
		this.handle.removeEventListener("mousedown", this.handleDragStart);
		this.progressTrack.removeEventListener("click", this.handleSeekClick);
		document.removeEventListener("mousemove", this.handleDragMove);
		document.removeEventListener("mouseup", this.handleDragEnd);
		this.root.remove();
	}

	private makeButton(
		parent: HTMLElement,
		icon: string,
		title: string,
		onClick: () => void,
	): HTMLButtonElement {
		const btn = parent.createEl("button", {
			cls: "tts-floating-player__btn clickable-icon",
			attr: { title, "aria-label": title },
		});
		setIcon(btn, icon);
		btn.addEventListener("click", onClick);
		return btn;
	}

	private applyInitialPosition(pos: { x: number; y: number } | null): void {
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		this.root.setCssStyles({ left: `${0}px`, top: `${0}px` });
		// `data-state="idle"` hides the element via display:none, which makes
		// getBoundingClientRect return zero size. Temporarily switch to a visible
		// state that shows the full transport controls — the widest layout — so the
		// placement clamp accounts for the player's real size, then restore idle.
		this.root.setAttribute("data-state", "paused");
		const rect = this.root.getBoundingClientRect();
		this.root.setAttribute("data-state", "idle");
		const fallback = {
			x: Math.max(MARGIN, vw - rect.width - MARGIN),
			y: Math.max(MARGIN, vh - rect.height - MARGIN * 4),
		};
		const target = pos ?? fallback;
		const x = clamp(target.x, MARGIN, vw - rect.width - MARGIN);
		const y = clamp(target.y, MARGIN, vh - rect.height - MARGIN);
		this.root.style.left = `${x}px`;
		this.root.style.top = `${y}px`;
	}

	private handleDragStart = (event: MouseEvent): void => {
		if (event.button !== 0) return;
		event.preventDefault();
		const rect = this.root.getBoundingClientRect();
		this.drag = {
			offsetX: event.clientX - rect.left,
			offsetY: event.clientY - rect.top,
			width: rect.width,
			height: rect.height,
		};
		this.handle.addClass("is-dragging");
		document.addEventListener("mousemove", this.handleDragMove);
		document.addEventListener("mouseup", this.handleDragEnd);
	};

	private handleDragMove = (event: MouseEvent): void => {
		const d = this.drag;
		if (!d) return;
		const x = clamp(event.clientX - d.offsetX, MARGIN, window.innerWidth - d.width - MARGIN);
		const y = clamp(event.clientY - d.offsetY, MARGIN, window.innerHeight - d.height - MARGIN);
		this.root.style.left = `${x}px`;
		this.root.style.top = `${y}px`;
	};

	private handleDragEnd = (): void => {
		if (!this.drag) return;
		this.drag = null;
		this.handle.removeClass("is-dragging");
		document.removeEventListener("mousemove", this.handleDragMove);
		document.removeEventListener("mouseup", this.handleDragEnd);
		const x = parseFloat(this.root.style.left);
		const y = parseFloat(this.root.style.top);
		if (Number.isFinite(x) && Number.isFinite(y)) {
			this.options.onPositionPersist({ x, y });
		}
	};

	private handleSeekClick = (event: MouseEvent): void => {
		const rect = this.progressTrack.getBoundingClientRect();
		if (rect.width <= 0) return;
		const fraction = clamp((event.clientX - rect.left) / rect.width, 0, 1);
		this.options.onSeekFraction(fraction);
	};

	private startTick(): void {
		this.stopTick();
		this.tickHandle = window.setInterval(() => {
			this.updateProgress(this.options.getCurrentTime(), this.options.getDuration());
		}, TICK_MS);
	}

	private stopTick(): void {
		if (this.tickHandle !== null) {
			window.clearInterval(this.tickHandle);
			this.tickHandle = null;
		}
	}

	private updateProgress(elapsed: number, duration: number): void {
		const fraction = duration > 0 ? clamp(elapsed / duration, 0, 1) : 0;
		const widthPct = Math.round(fraction * 1000) / 10;
		if (widthPct !== this.lastProgressWidth) {
			this.lastProgressWidth = widthPct;
			this.progressFill.style.width = `${widthPct}%`;
		}
		const label = `${formatTime(elapsed)} / ${formatTime(duration)}`;
		if (label !== this.lastTimeLabel) {
			this.lastTimeLabel = label;
			this.timeLabel.textContent = label;
		}
	}
}

function formatTime(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
	const total = Math.floor(seconds);
	const mm = Math.floor(total / 60);
	const ss = total % 60;
	return `${pad2(mm)}:${pad2(ss)}`;
}

function pad2(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}

function nearestSpeed(speeds: readonly number[], rate: number): string {
	let best = speeds[0] ?? 1;
	let bestDist = Infinity;
	for (const s of speeds) {
		const d = Math.abs(s - rate);
		if (d < bestDist) {
			bestDist = d;
			best = s;
		}
	}
	return String(best);
}
