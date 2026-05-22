import type { MarkdownView } from "obsidian";
import type { HighlightTarget } from "../types";
import { buildTextIndex } from "./previewIndex";
import { findSentenceInText } from "./sentenceMatcher";

const HIGHLIGHT_NAME = "hark-tts";

// Frames to wait for `applyScroll` to finish rendering the target section before
// giving up. Render is asynchronous; ~10 frames (≈150 ms) covers it without a
// visible lag. When the section is already rendered (the common case on desktop,
// where the preview is not virtualized) the match succeeds on the first frame.
const MAX_RETRY_FRAMES = 10;

// Internal shape of `MarkdownPreviewView.renderer.sections`, verified live
// against Obsidian 1.11.4. `start`/`end` carry both a source character `offset`
// and a `line`; neither is in the public typings, the same category as the
// already-accepted `view.editor.cm` access.
interface PreviewSection {
	el: HTMLElement;
	start: { line: number; offset: number };
	end: { line: number; offset: number };
}

type HighlightConstructor = new (...ranges: Range[]) => object;
interface HighlightRegistry {
	set(name: string, highlight: object): void;
	delete(name: string): void;
}

// The CSS Custom Highlight API is reached through casts because it is newer than
// the configured TypeScript DOM lib. Both are present on Obsidian's desktop
// Chromium and iOS 17.2+; absent elsewhere, in which case highlighting no-ops.
function highlightRegistry(): HighlightRegistry | null {
	return (
		(CSS as unknown as { highlights?: HighlightRegistry }).highlights ??
		null
	);
}

function highlightConstructor(): HighlightConstructor | null {
	return (
		(globalThis as unknown as { Highlight?: HighlightConstructor })
			.Highlight ?? null
	);
}

function sectionsOf(view: MarkdownView): PreviewSection[] | null {
	const renderer = (
		view.previewMode as unknown as {
			renderer?: { sections?: PreviewSection[] };
		}
	).renderer;
	return renderer?.sections ?? null;
}

function sectionForOffset(
	view: MarkdownView,
	offset: number,
): PreviewSection | null {
	const sections = sectionsOf(view);
	if (!sections) return null;
	return (
		sections.find(
			(s) =>
				s.start &&
				s.end &&
				s.start.offset <= offset &&
				offset < s.end.offset,
		) ?? null
	);
}

export class ReadingHighlighter {
	private rafHandle: number | null = null;

	constructor(private getView: () => MarkdownView | null) {}

	// Resolves the section containing the sentence's source offset, scrolls it
	// into view (which also forces it to render if it was unloaded), then matches
	// the sentence text within that one section and paints it.
	highlight(target: HighlightTarget): void {
		this.cancelPending();
		if (!target.text) {
			this.clear();
			return;
		}
		const view = this.getView();
		if (!view) {
			this.clear();
			return;
		}
		const section = sectionForOffset(view, target.sentence.from);
		if (!section) {
			this.clear();
			return;
		}
		view.previewMode.applyScroll(section.start.line);
		this.paintWhenReady(view, target, 0);
	}

	clear(): void {
		highlightRegistry()?.delete(HIGHLIGHT_NAME);
	}

	dispose(): void {
		this.cancelPending();
		this.clear();
	}

	private paintWhenReady(
		view: MarkdownView,
		target: HighlightTarget,
		frame: number,
	): void {
		this.rafHandle = requestAnimationFrame(() => {
			this.rafHandle = null;
			// A file/leaf change mid-retry would leave us painting into a stale
			// document; bail if the active preview view is no longer the one we
			// scrolled.
			if (this.getView() !== view) {
				this.clear();
				return;
			}
			if (this.tryPaint(view, target)) return;
			if (frame + 1 < MAX_RETRY_FRAMES) {
				this.paintWhenReady(view, target, frame + 1);
			} else {
				this.clear();
			}
		});
	}

	private tryPaint(view: MarkdownView, target: HighlightTarget): boolean {
		const section = sectionForOffset(view, target.sentence.from);
		if (!section || (section.el.textContent ?? "").length === 0)
			return false;
		const index = buildTextIndex(section.el);
		const match = findSentenceInText(index.buffer, target.text);
		if (!match) return false;
		const range = index.rangeFor(match.start, match.end);
		if (!range) return false;
		const registry = highlightRegistry();
		const Highlight = highlightConstructor();
		if (!registry || !Highlight) return false;
		registry.set(HIGHLIGHT_NAME, new Highlight(range));
		this.centerRange(section.el, range);
		return true;
	}

	// `applyScroll` lands the section flush against the top edge. Re-center the
	// highlighted sentence in the viewport to match the editing-mode highlight,
	// which scrolls with `y: "center"` (see `applyHighlight`).
	private centerRange(sectionEl: HTMLElement, range: Range): void {
		const scroller = sectionEl.closest<HTMLElement>(
			".markdown-preview-view",
		);
		if (!scroller) return;
		const rangeRect = range.getBoundingClientRect();
		const scrollerRect = scroller.getBoundingClientRect();
		const targetTop = scrollerRect.height / 2 - rangeRect.height / 2;
		scroller.scrollTop += rangeRect.top - scrollerRect.top - targetTop;
	}

	private cancelPending(): void {
		if (this.rafHandle !== null) {
			cancelAnimationFrame(this.rafHandle);
			this.rafHandle = null;
		}
	}
}
