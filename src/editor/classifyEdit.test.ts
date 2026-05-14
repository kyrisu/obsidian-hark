import { describe, it, expect } from "vitest";
import { ChangeSet } from "@codemirror/state";
import { classifyEdit } from "./highlightExtension";

const DOC_LEN = 1000;

function changes(spec: { from: number; to?: number; insert?: string }[]): ChangeSet {
	return ChangeSet.of(spec, DOC_LEN);
}

const playingRange = { from: 100, to: 200 };
const prefetched = [
	{ index: 1, from: 250, to: 350 },
	{ index: 2, from: 400, to: 500 },
];

describe("classifyEdit", () => {
	it("ignores edits entirely before the playing range", () => {
		const result = classifyEdit(changes([{ from: 0, to: 10, insert: "x" }]), playingRange, []);
		expect(result.pauseRequired).toBe(false);
		expect(result.invalidatePrefetchIndexes).toEqual([]);
	});

	it("ignores edits entirely after the playing range", () => {
		const result = classifyEdit(changes([{ from: 600, to: 610, insert: "" }]), playingRange, []);
		expect(result.pauseRequired).toBe(false);
		expect(result.invalidatePrefetchIndexes).toEqual([]);
	});

	it("pauses when an edit overlaps the playing range", () => {
		const result = classifyEdit(changes([{ from: 150, to: 160, insert: "y" }]), playingRange, []);
		expect(result.pauseRequired).toBe(true);
	});

	it("pauses for a zero-length insertion inside the playing range", () => {
		const result = classifyEdit(changes([{ from: 150, insert: "z" }]), playingRange, []);
		expect(result.pauseRequired).toBe(true);
	});

	it("pauses for an edit touching the playing-range boundary", () => {
		const result = classifyEdit(changes([{ from: 200, to: 205, insert: "" }]), playingRange, []);
		expect(result.pauseRequired).toBe(true);
	});

	it("flags prefetched paragraphs whose source range is touched", () => {
		const result = classifyEdit(
			changes([{ from: 300, to: 310, insert: "q" }]),
			playingRange,
			prefetched,
		);
		expect(result.pauseRequired).toBe(false);
		expect(result.invalidatePrefetchIndexes).toEqual([1]);
	});

	it("flags multiple prefetched paragraphs when a single edit spans both", () => {
		const result = classifyEdit(
			changes([{ from: 260, to: 460, insert: "" }]),
			playingRange,
			prefetched,
		);
		expect(result.invalidatePrefetchIndexes.sort()).toEqual([1, 2]);
	});

	it("deduplicates indexes across multiple changes", () => {
		const result = classifyEdit(
			changes([
				{ from: 260, to: 270, insert: "a" },
				{ from: 300, to: 310, insert: "b" },
			]),
			null,
			prefetched,
		);
		expect(result.invalidatePrefetchIndexes).toEqual([1]);
	});

	it("returns no pause when playingRange is null even for overlapping edits", () => {
		const result = classifyEdit(changes([{ from: 150, to: 160, insert: "x" }]), null, prefetched);
		expect(result.pauseRequired).toBe(false);
		expect(result.invalidatePrefetchIndexes).toEqual([]);
	});
});
