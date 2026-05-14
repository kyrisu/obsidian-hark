import { describe, expect, it } from "vitest";
import { cacheKey, sha256Hex } from "./Hash";

describe("cacheKey", () => {
	it("normalises internal whitespace runs to a single space", () => {
		expect(cacheKey("  hello   world  ", "v")).toBe("hello world|v");
	});

	it("preserves single spaces and trims edges", () => {
		expect(cacheKey("hello world", "voice-1")).toBe("hello world|voice-1");
	});

	it("collapses tabs and newlines into single spaces", () => {
		expect(cacheKey("a\tb\nc\r\nd", "v")).toBe("a b c d|v");
	});

	it("keeps the voice id separator literal", () => {
		expect(cacheKey("text", "")).toBe("text|");
	});
});

describe("sha256Hex", () => {
	it("matches the known vector for 'hello'", async () => {
		expect(await sha256Hex("hello")).toBe(
			"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
		);
	});

	it("produces a 64-character lowercase hex digest", async () => {
		const digest = await sha256Hex("any input");
		expect(digest).toMatch(/^[0-9a-f]{64}$/);
	});

	it("returns the empty-string vector", async () => {
		expect(await sha256Hex("")).toBe(
			"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		);
	});
});
