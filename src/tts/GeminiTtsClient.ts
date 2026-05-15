import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from "obsidian";
import { pcmDurationSec, pcmToWav } from "./wav";

const ENDPOINT_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
export const GEMINI_TTS_MODEL = "gemini-2.5-flash-preview-tts";

// Not an API hard limit — the Gemini Developer API is token-bounded and far
// larger. This is the byte threshold at which the synthesizer splits an
// oversize paragraph at sentence boundaries.
export const MAX_REQUEST_BYTES = 5000;

const DEFAULT_SAMPLE_RATE = 24000;
const PCM_CHANNELS = 1;

export interface GeminiTtsRequest {
	text: string;
	voiceId: string;
	apiKey: string;
	signal?: AbortSignal;
}

export interface SpeechResult {
	audio: ArrayBuffer; // WAV-wrapped PCM
	durationSec: number;
}

export class GeminiTtsError extends Error {
	constructor(
		message: string,
		readonly status?: number,
	) {
		super(message);
		this.name = "GeminiTtsError";
	}
}

export class RequestTooLargeError extends GeminiTtsError {
	constructor(byteLength: number) {
		super(`Paragraph is ${byteLength} bytes, over the ${MAX_REQUEST_BYTES}-byte per-request cap.`);
		this.name = "RequestTooLargeError";
	}
}

export class RequestAbortedError extends GeminiTtsError {
	constructor() {
		super("Request aborted.");
		this.name = "RequestAbortedError";
	}
}

interface InlineData {
	mimeType?: string;
	data?: string;
}

interface GenerateContentResponse {
	candidates?: Array<{
		content?: { parts?: Array<{ inlineData?: InlineData }> };
		finishReason?: string;
	}>;
	error?: {
		message?: string;
		status?: string;
		code?: number;
		details?: Array<{ reason?: string }>;
	};
}

export async function synthesizeSpeech(req: GeminiTtsRequest): Promise<SpeechResult> {
	const byteLength = new TextEncoder().encode(req.text).byteLength;
	if (byteLength > MAX_REQUEST_BYTES) throw new RequestTooLargeError(byteLength);
	if (req.signal?.aborted) throw new RequestAbortedError();

	const body = JSON.stringify({
		contents: [{ parts: [{ text: req.text }] }],
		generationConfig: {
			responseModalities: ["AUDIO"],
			speechConfig: {
				voiceConfig: { prebuiltVoiceConfig: { voiceName: req.voiceId } },
			},
		},
	});

	const params: RequestUrlParam = {
		url: `${ENDPOINT_BASE}/${GEMINI_TTS_MODEL}:generateContent`,
		method: "POST",
		contentType: "application/json",
		headers: { "x-goog-api-key": req.apiKey },
		body,
		throw: false,
	};

	const resp = await requestUrl(params);
	if (req.signal?.aborted) throw new RequestAbortedError();

	let parsed: GenerateContentResponse = {};
	try {
		parsed = resp.json as GenerateContentResponse;
	} catch {
		try {
			parsed = JSON.parse(resp.text) as GenerateContentResponse;
		} catch {
			parsed = {};
		}
	}

	if (parsed.error) {
		throw new GeminiTtsError(
			parsed.error.message ?? "Gemini TTS request failed.",
			parsed.error.code ?? resp.status,
		);
	}
	if (resp.status < 200 || resp.status >= 300) {
		throw new GeminiTtsError(`Gemini TTS request failed with status ${resp.status}.`, resp.status);
	}

	const candidate = parsed.candidates?.[0];
	const finishReason = candidate?.finishReason;
	if (finishReason && finishReason !== "STOP") {
		throw new GeminiTtsError(`Gemini TTS stopped early (${finishReason}).`);
	}

	const inlineData = candidate?.content?.parts?.find((p) => p.inlineData)?.inlineData;
	if (!inlineData?.data) {
		throw new GeminiTtsError("Gemini TTS returned no audio data.");
	}

	// The response MIME label is `audio/L16` (big-endian per RFC 2586), but Gemini
	// TTS emits little-endian PCM — verified empirically. WAV PCM is little-endian,
	// so the bytes copy through unchanged.
	const pcm = decodeBase64(inlineData.data);
	const sampleRate = parseSampleRate(inlineData.mimeType) ?? DEFAULT_SAMPLE_RATE;
	return {
		audio: pcmToWav(pcm, sampleRate, PCM_CHANNELS),
		durationSec: pcmDurationSec(pcm.byteLength, sampleRate, PCM_CHANNELS),
	};
}

export async function validateApiKey(
	apiKey: string,
): Promise<{ ok: boolean; message: string }> {
	const key = apiKey.trim();
	if (!key) return { ok: false, message: "No API key set." };

	console.debug(
		`[Read Aloud] Validating API key: length ${key.length}, ` +
			`${key.slice(0, 8)}…${key.slice(-4)}`,
	);

	let resp: RequestUrlResponse;
	try {
		resp = await requestUrl({
			url: ENDPOINT_BASE,
			method: "GET",
			headers: { "x-goog-api-key": key },
			throw: false,
		});
	} catch (err) {
		console.error("[Read Aloud] API key validation could not reach Google:", err);
		const detail = err instanceof Error ? err.message : String(err);
		return { ok: false, message: `Could not reach the Gemini API: ${detail}` };
	}

	if (resp.status >= 200 && resp.status < 300) {
		return { ok: true, message: "API key is valid." };
	}

	console.error(`[Read Aloud] API key validation failed (HTTP ${resp.status}):`, resp.text);
	let message = describeUpstreamError(resp.status, resp.text);
	if (!looksLikeGoogleApiKey(key)) {
		message +=
			' Note: this value does not look like a Google API key — those start with "AIza" and are 39 characters with no dashes. The UUID in a Cloud Console key URL is the key ID, not the key; use "Show key" to copy the real value, or create one at aistudio.google.com/apikey.';
	}
	return { ok: false, message };
}

function looksLikeGoogleApiKey(key: string): boolean {
	return /^AIza[\w-]{35}$/.test(key);
}

function describeUpstreamError(status: number, rawBody: string): string {
	let parsed: GenerateContentResponse = {};
	try {
		parsed = JSON.parse(rawBody) as GenerateContentResponse;
	} catch {
		/* response body was not JSON */
	}
	const err = parsed.error;
	if (!err) {
		const snippet = rawBody.trim().slice(0, 200);
		return snippet
			? `Validation failed (HTTP ${status}): ${snippet}`
			: `Validation failed (HTTP ${status}).`;
	}
	const reason = err.details?.find((d) => d.reason)?.reason;
	const tags = [err.status, reason, `HTTP ${status}`].filter(Boolean).join(", ");
	const base = err.message ?? `Request failed with HTTP ${status}`;
	const hint = hintForUpstreamError(reason, status);
	return hint ? `${base} (${tags}) — ${hint}` : `${base} (${tags})`;
}

function hintForUpstreamError(reason: string | undefined, status: number): string {
	switch (reason) {
		case "API_KEY_INVALID":
			return "Check for a typo or stray characters, and confirm the key was created at aistudio.google.com/apikey.";
		case "SERVICE_DISABLED":
		case "API_KEY_SERVICE_BLOCKED":
			return "Enable the Generative Language API for this key's Google Cloud project, or create a fresh key at aistudio.google.com/apikey.";
		case "API_KEY_HTTP_REFERRER_BLOCKED":
		case "API_KEY_IP_ADDRESS_BLOCKED":
		case "API_KEY_ANDROID_APP_BLOCKED":
		case "API_KEY_IOS_APP_BLOCKED":
			return "This key has application restrictions that block the request. Use a key with no application restrictions.";
		default:
			if (status === 403) return "The key was recognised but lacks permission for the Gemini API.";
			if (status === 429) return "Rate or quota limit reached — wait a moment and try again.";
			return "";
	}
}

function parseSampleRate(mimeType: string | undefined): number | null {
	if (!mimeType) return null;
	const match = /rate=(\d+)/.exec(mimeType);
	return match ? Number(match[1]) : null;
}

function decodeBase64(b64: string): ArrayBuffer {
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes.buffer;
}
