import { requestUrl, type RequestUrlParam } from "obsidian";
import { PLUGIN_LANGUAGE } from "../types";

export interface GeminiTtsRequest {
	text: string;
	voiceId: string;
	apiKey: string;
	signal?: AbortSignal;
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
		super(`Input is ${byteLength} bytes; the Cloud TTS limit is 5000 bytes.`);
		this.name = "RequestTooLargeError";
	}
}

export class RequestAbortedError extends GeminiTtsError {
	constructor() {
		super("Request aborted.");
		this.name = "RequestAbortedError";
	}
}

const MAX_REQUEST_BYTES = 5000;
const ENDPOINT = "https://texttospeech.googleapis.com/v1beta1/text:synthesize";
const GEMINI_FLASH_MODEL = "gemini-2.5-flash-tts";

interface SynthesizeResponseBody {
	audioContent?: string;
	error?: { message?: string; status?: string };
}

export async function synthesizeMp3(req: GeminiTtsRequest): Promise<ArrayBuffer> {
	const byteLength = new TextEncoder().encode(req.text).byteLength;
	if (byteLength > MAX_REQUEST_BYTES) throw new RequestTooLargeError(byteLength);

	if (req.signal?.aborted) throw new RequestAbortedError();

	const first = await postSynthesize(req, false);
	if (first.audioContent) return decodeBase64(first.audioContent);

	const message = first.error?.message ?? "";
	const looksLikeMissingModel =
		first.status === 400 &&
		/model/i.test(message) &&
		(/required/i.test(message) || /unknown/i.test(message));

	if (looksLikeMissingModel) {
		if (req.signal?.aborted) throw new RequestAbortedError();
		const retry = await postSynthesize(req, true);
		if (retry.audioContent) return decodeBase64(retry.audioContent);
		throw new GeminiTtsError(
			retry.error?.message ?? "Gemini-TTS returned no audioContent.",
			retry.status,
		);
	}

	throw new GeminiTtsError(
		message || `Gemini-TTS request failed with status ${first.status}.`,
		first.status,
	);
}

interface ParsedResponse {
	audioContent?: string;
	error?: { message?: string; status?: string };
	status: number;
}

async function postSynthesize(req: GeminiTtsRequest, withModel: boolean): Promise<ParsedResponse> {
	const voice: { languageCode: string; name: string; model?: string } = {
		languageCode: PLUGIN_LANGUAGE,
		name: req.voiceId,
	};
	if (withModel) voice.model = GEMINI_FLASH_MODEL;

	const body = JSON.stringify({
		input: { text: req.text },
		voice,
		audioConfig: { audioEncoding: "MP3" },
	});

	const params: RequestUrlParam = {
		url: `${ENDPOINT}?key=${encodeURIComponent(req.apiKey)}`,
		method: "POST",
		contentType: "application/json",
		body,
		throw: false,
	};

	const resp = await requestUrl(params);
	let parsed: SynthesizeResponseBody = {};
	try {
		parsed = resp.json as SynthesizeResponseBody;
	} catch {
		try {
			parsed = JSON.parse(resp.text) as SynthesizeResponseBody;
		} catch {
			parsed = {};
		}
	}
	return { ...parsed, status: resp.status };
}

function decodeBase64(b64: string): ArrayBuffer {
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes.buffer;
}
