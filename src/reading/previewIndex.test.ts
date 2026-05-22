// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildTextIndex } from "./previewIndex";

function fragment(html: string): HTMLElement {
	const doc = new DOMParser().parseFromString(
		`<div>${html}</div>`,
		"text/html",
	);
	return doc.body.firstElementChild as HTMLElement;
}

describe("buildTextIndex", () => {
	it("concatenates text across nested inline elements", () => {
		const root = fragment(
			"This is <strong>bold and <a href='#'>linked</a></strong> text.",
		);
		const index = buildTextIndex(root);
		expect(index.buffer).toBe("This is bold and linked text.");
	});

	it("builds a Range spanning an element boundary whose text equals the target", () => {
		const root = fragment(
			"This is <strong>bold and <a href='#'>linked</a></strong> text.",
		);
		const index = buildTextIndex(root);
		const start = index.buffer.indexOf("bold and linked");
		const end = start + "bold and linked".length;
		const range = index.rangeFor(start, end);
		expect(range).not.toBeNull();
		expect(range!.toString()).toBe("bold and linked");
	});

	it("builds a Range within a single text node", () => {
		const root = fragment("Just one plain paragraph here.");
		const index = buildTextIndex(root);
		const start = index.buffer.indexOf("plain paragraph");
		const range = index.rangeFor(start, start + "plain paragraph".length);
		expect(range!.toString()).toBe("plain paragraph");
	});

	it("returns null for out-of-range or inverted offsets", () => {
		const index = buildTextIndex(fragment("Short."));
		expect(index.rangeFor(-1, 3)).toBeNull();
		expect(index.rangeFor(0, index.buffer.length + 1)).toBeNull();
		expect(index.rangeFor(4, 2)).toBeNull();
	});
});
