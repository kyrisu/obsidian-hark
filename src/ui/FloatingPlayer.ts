export type FloatingPlayerState = "idle" | "loading" | "playing" | "paused" | "error";

export interface FloatingPlayerOptions {
	initialPosition: { x: number; y: number } | null;
	speeds: number[];
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
	private readonly stopBtn: HTMLButtonElement;
	private readonly prevBtn: HTMLButtonElement;
	private readonly nextBtn: HTMLButtonElement;
	private readonly paraIndicator: HTMLElement;
	private readonly progressTrack: HTMLElement;
	private readonly progressFill: HTMLElement;
	private readonly timeLabel: HTMLElement;
	private readonly speedSelect: HTMLSelectElement;
	private state: FloatingPlayerState = "idle";
	private tickHandle: number | null = null;
	private drag: { offsetX: number; offsetY: number } | null = null;

	constructor(private readonly options: FloatingPlayerOptions) {
		this.root = document.createElement("div");
		this.root.className = "tts-floating-player";
		this.root.setAttribute("data-state", "idle");

		this.handle = el("div", "tts-floating-player__drag", "⠿");
		this.handle.title = "Drag to move";
		this.handle.addEventListener("mousedown", this.handleDragStart);

		this.prevBtn = button("⏮", "Previous paragraph", () => this.options.onSkipPrevious());
		this.playPauseBtn = button("▶", "Play / pause", () => this.options.onPlayPause());
		this.nextBtn = button("⏭", "Next paragraph", () => this.options.onSkipNext());
		this.stopBtn = button("⏹", "Stop", () => this.options.onStop());

		this.paraIndicator = el("span", "tts-floating-player__paragraph", "—");

		this.progressTrack = el("div", "tts-floating-player__progress");
		this.progressFill = el("div", "tts-floating-player__progress-fill");
		this.progressTrack.appendChild(this.progressFill);
		this.progressTrack.addEventListener("click", this.handleSeekClick);

		this.timeLabel = el("span", "tts-floating-player__time", "00:00 / 00:00");

		this.speedSelect = document.createElement("select");
		this.speedSelect.className = "tts-floating-player__speed";
		for (const s of options.speeds) {
			const opt = document.createElement("option");
			opt.value = String(s);
			opt.text = `${s}×`;
			this.speedSelect.appendChild(opt);
		}
		this.speedSelect.value = nearestSpeed(options.speeds, options.initialRate);
		this.speedSelect.addEventListener("change", () => {
			const rate = Number(this.speedSelect.value);
			if (Number.isFinite(rate)) this.options.onSpeedChange(rate);
		});

		this.root.append(
			this.handle,
			this.prevBtn,
			this.playPauseBtn,
			this.nextBtn,
			this.stopBtn,
			this.paraIndicator,
			this.progressTrack,
			this.timeLabel,
			this.speedSelect,
		);

		document.body.appendChild(this.root);
		this.applyInitialPosition(options.initialPosition);
	}

	setState(next: FloatingPlayerState): void {
		if (this.state === next) return;
		this.state = next;
		this.root.setAttribute("data-state", next);
		this.playPauseBtn.textContent = next === "playing" ? "⏸" : "▶";
		if (next === "playing") this.startTick();
		else this.stopTick();
		if (next === "idle") this.updateProgress(0, 0);
	}

	setParagraphIndex(idx: number, total: number): void {
		if (total <= 0) this.paraIndicator.textContent = "—";
		else this.paraIndicator.textContent = `${idx + 1} / ${total}`;
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

	private applyInitialPosition(pos: { x: number; y: number } | null): void {
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		this.root.setCssStyles({ left: `${0}px`, top: `${0}px` });
		// `data-state="idle"` hides the element via display:none, which makes
		// getBoundingClientRect return zero size. Temporarily switch to a visible
		// state for the measurement, then restore idle.
		this.root.setAttribute("data-state", "loading");
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
		};
		this.handle.addClass("is-dragging");
		document.addEventListener("mousemove", this.handleDragMove);
		document.addEventListener("mouseup", this.handleDragEnd);
	};

	private handleDragMove = (event: MouseEvent): void => {
		if (!this.drag) return;
		const rect = this.root.getBoundingClientRect();
		const x = clamp(event.clientX - this.drag.offsetX, MARGIN, window.innerWidth - rect.width - MARGIN);
		const y = clamp(event.clientY - this.drag.offsetY, MARGIN, window.innerHeight - rect.height - MARGIN);
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
		this.progressFill.style.width = `${fraction * 100}%`;
		this.timeLabel.textContent = `${formatTime(elapsed)} / ${formatTime(duration)}`;
	}
}

function el(tag: string, className: string, text?: string): HTMLElement {
	const node = document.createElement(tag);
	node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

function button(label: string, title: string, onClick: () => void): HTMLButtonElement {
	const btn = document.createElement("button");
	btn.className = "tts-floating-player__btn";
	btn.textContent = label;
	btn.title = title;
	btn.setAttribute("aria-label", title);
	btn.addEventListener("click", onClick);
	return btn;
}

function clamp(value: number, lo: number, hi: number): number {
	if (hi < lo) return lo;
	return Math.max(lo, Math.min(hi, value));
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

function nearestSpeed(speeds: number[], rate: number): string {
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
