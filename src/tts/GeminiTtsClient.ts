export interface GeminiTtsRequest {
	text: string;
	voiceId: string;
	apiKey: string;
	signal?: AbortSignal;
}

export class GeminiTtsError extends Error {}

export class RequestTooLargeError extends GeminiTtsError {}

export async function synthesizeMp3(_req: GeminiTtsRequest): Promise<ArrayBuffer> {
	throw new GeminiTtsError("synthesizeMp3 not implemented");
}
