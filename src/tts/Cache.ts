import type { DataAdapter } from "obsidian";
import type { CacheEntry, CacheIndex, SentenceTiming, SynthResult } from "../types";

const CACHE_DIR = ".tts-cache";
const INDEX_FILE = `${CACHE_DIR}/index.json`;
const INDEX_TMP = `${CACHE_DIR}/index.json.tmp`;
const FLUSH_DELAY_MS = 5_000;

export class Cache {
	private index: CacheIndex = { version: 1, entries: [], totalBytes: 0 };
	private byHash = new Map<string, CacheEntry>();
	private flushHandle: number | null = null;
	private writeQueue: Promise<unknown> = Promise.resolve();

	constructor(
		private adapter: DataAdapter,
		private cacheMaxBytes: number,
	) {}

	async init(): Promise<void> {
		await this.ensureDir();
		const loaded = await this.readIndex();
		if (loaded) {
			this.adoptIndex(loaded);
			return;
		}
		const rebuilt = await this.rebuildIndex();
		this.adoptIndex(rebuilt);
		await this.writeIndexNow();
	}

	async get(hash: string): Promise<SynthResult | null> {
		const entry = this.byHash.get(hash);
		if (!entry) return null;

		const audioPath = this.audioPath(hash);
		const timingsPath = this.timingsPath(hash);
		if (!(await this.adapter.exists(audioPath)) || !(await this.adapter.exists(timingsPath))) {
			this.dropEntry(hash);
			this.scheduleFlush();
			return null;
		}

		const audio = await this.adapter.readBinary(audioPath);
		const timingsRaw = await this.adapter.read(timingsPath);
		const { audioDurationSec, sentences } = JSON.parse(timingsRaw) as {
			audioDurationSec: number;
			sentences: SentenceTiming[];
		};

		entry.lastAccessedMs = Date.now();
		this.scheduleFlush();

		return { audio, audioDurationSec, sentences };
	}

	async put(hash: string, snippet: string, result: SynthResult): Promise<void> {
		await (this.writeQueue = this.writeQueue.then(() => this.putInternal(hash, snippet, result)));
	}

	async clear(): Promise<void> {
		await (this.writeQueue = this.writeQueue.then(() => this.clearInternal()));
	}

	async size(): Promise<number> {
		return this.index.totalBytes;
	}

	setMaxBytes(maxBytes: number): void {
		this.cacheMaxBytes = maxBytes;
	}

	async entries(): Promise<CacheEntry[]> {
		return this.index.entries.slice().sort((a, b) => b.lastAccessedMs - a.lastAccessedMs);
	}

	private async putInternal(hash: string, snippet: string, result: SynthResult): Promise<void> {
		const audioPath = this.audioPath(hash);
		const timingsPath = this.timingsPath(hash);
		await this.adapter.writeBinary(audioPath, result.audio);
		await this.adapter.write(
			timingsPath,
			JSON.stringify({
				audioDurationSec: result.audioDurationSec,
				sentences: result.sentences,
			}),
		);

		const sizeBytes = result.audio.byteLength;
		const prior = this.byHash.get(hash);
		if (prior) this.index.totalBytes -= prior.sizeBytes;

		const entry: CacheEntry = {
			hash,
			sizeBytes,
			lastAccessedMs: Date.now(),
			textSnippet: snippet,
		};
		this.byHash.set(hash, entry);
		this.index.totalBytes += sizeBytes;
		this.rebuildEntriesList();

		await this.evictIfNeeded();
		await this.writeIndexNow();
	}

	private async clearInternal(): Promise<void> {
		this.cancelFlush();
		for (const entry of this.index.entries) {
			await this.removeEntryFiles(entry.hash);
		}
		this.index = { version: 1, entries: [], totalBytes: 0 };
		this.byHash.clear();
		await this.writeIndexNow();
	}

	private async evictIfNeeded(): Promise<void> {
		if (this.index.totalBytes <= this.cacheMaxBytes) return;
		const sorted = this.index.entries.slice().sort((a, b) => a.lastAccessedMs - b.lastAccessedMs);
		for (const entry of sorted) {
			if (this.index.totalBytes <= this.cacheMaxBytes) break;
			this.dropEntry(entry.hash);
			await this.removeEntryFiles(entry.hash);
		}
	}

	private async removeEntryFiles(hash: string): Promise<void> {
		const paths = [this.audioPath(hash), this.timingsPath(hash)];
		for (const p of paths) {
			if (await this.adapter.exists(p)) await this.adapter.remove(p);
		}
	}

	private dropEntry(hash: string): void {
		const entry = this.byHash.get(hash);
		if (!entry) return;
		this.byHash.delete(hash);
		this.index.totalBytes -= entry.sizeBytes;
		this.rebuildEntriesList();
	}

	private rebuildEntriesList(): void {
		this.index.entries = Array.from(this.byHash.values());
	}

	private adoptIndex(idx: CacheIndex): void {
		this.index = { version: 1, entries: idx.entries.slice(), totalBytes: idx.totalBytes };
		this.byHash.clear();
		for (const e of this.index.entries) this.byHash.set(e.hash, e);
	}

	private async ensureDir(): Promise<void> {
		if (!(await this.adapter.exists(CACHE_DIR))) {
			await this.adapter.mkdir(CACHE_DIR);
		}
	}

	private async readIndex(): Promise<CacheIndex | null> {
		if (!(await this.adapter.exists(INDEX_FILE))) return null;
		try {
			const raw = await this.adapter.read(INDEX_FILE);
			const parsed = JSON.parse(raw) as Partial<CacheIndex>;
			if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return null;
			const entries = parsed.entries.filter(
				(e): e is CacheEntry =>
					typeof e?.hash === "string" &&
					typeof e?.sizeBytes === "number" &&
					typeof e?.lastAccessedMs === "number" &&
					typeof e?.textSnippet === "string",
			);
			const totalBytes =
				typeof parsed.totalBytes === "number"
					? parsed.totalBytes
					: entries.reduce((s, e) => s + e.sizeBytes, 0);
			return { version: 1, entries, totalBytes };
		} catch {
			return null;
		}
	}

	private async rebuildIndex(): Promise<CacheIndex> {
		const listing = await this.adapter.list(CACHE_DIR);
		const entries: CacheEntry[] = [];
		let totalBytes = 0;
		for (const filePath of listing.files) {
			const base = filePath.split("/").pop() ?? "";
			if (!base.endsWith(".wav")) continue;
			const hash = base.slice(0, -".wav".length);
			const timingsPath = this.timingsPath(hash);
			if (!(await this.adapter.exists(timingsPath))) continue;
			const stat = await this.adapter.stat(filePath);
			const sizeBytes = stat?.size ?? 0;
			entries.push({
				hash,
				sizeBytes,
				lastAccessedMs: stat?.mtime ?? Date.now(),
				textSnippet: "",
			});
			totalBytes += sizeBytes;
		}
		return { version: 1, entries, totalBytes };
	}

	private scheduleFlush(): void {
		if (this.flushHandle !== null) return;
		const w = globalThis as unknown as {
			requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
		};
		if (typeof w.requestIdleCallback === "function") {
			this.flushHandle = w.requestIdleCallback(() => this.runScheduledFlush(), {
				timeout: FLUSH_DELAY_MS,
			});
		} else {
			this.flushHandle = window.setTimeout(() => this.runScheduledFlush(), FLUSH_DELAY_MS);
		}
	}

	private cancelFlush(): void {
		if (this.flushHandle === null) return;
		const w = globalThis as unknown as { cancelIdleCallback?: (h: number) => void };
		if (typeof w.cancelIdleCallback === "function") w.cancelIdleCallback(this.flushHandle);
		else window.clearTimeout(this.flushHandle);
		this.flushHandle = null;
	}

	private runScheduledFlush(): void {
		this.flushHandle = null;
		this.writeQueue = this.writeQueue.then(() => this.writeIndexNow());
	}

	private async writeIndexNow(): Promise<void> {
		const payload = JSON.stringify(this.index);
		await this.adapter.write(INDEX_TMP, payload);
		if (await this.adapter.exists(INDEX_FILE)) {
			await this.adapter.remove(INDEX_FILE);
		}
		await this.adapter.rename(INDEX_TMP, INDEX_FILE);
	}

	private audioPath(hash: string): string {
		return `${CACHE_DIR}/${hash}.wav`;
	}

	private timingsPath(hash: string): string {
		return `${CACHE_DIR}/${hash}.sentences.json`;
	}
}
