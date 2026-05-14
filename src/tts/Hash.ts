export async function sha256Hex(input: string): Promise<string> {
	const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
	return Array.from(new Uint8Array(buf))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

export function cacheKey(text: string, voiceId: string): string {
	const normalized = text.trim().replace(/\s+/g, " ");
	return `${normalized}|${voiceId}`;
}
