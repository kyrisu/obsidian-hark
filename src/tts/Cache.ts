import type { DataAdapter } from "obsidian";
import type { CacheEntry, SynthResult } from "../types";

export class Cache {
	constructor(
		private adapter: DataAdapter,
		private cacheMaxBytes: number,
	) {
		void this.adapter;
		void this.cacheMaxBytes;
	}

	async init(): Promise<void> {}

	async get(_hash: string): Promise<SynthResult | null> {
		return null;
	}

	async put(_hash: string, _snippet: string, _result: SynthResult): Promise<void> {}

	async clear(): Promise<void> {}

	async size(): Promise<number> {
		return 0;
	}

	async entries(): Promise<CacheEntry[]> {
		return [];
	}
}
