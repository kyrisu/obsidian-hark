import { describe, expect, it } from "vitest";
import { pcmDurationSec, pcmToWav } from "./wav";

function ascii(view: DataView, offset: number, len: number): string {
	let s = "";
	for (let i = 0; i < len; i++)
		s += String.fromCharCode(view.getUint8(offset + i));
	return s;
}

describe("pcmToWav", () => {
	it("prepends a correct 44-byte little-endian WAV header for 24kHz mono", () => {
		const pcm = new Uint8Array([1, 2, 3, 4]).buffer;
		const wav = pcmToWav(pcm, 24000, 1);
		const view = new DataView(wav);

		expect(wav.byteLength).toBe(48);
		expect(ascii(view, 0, 4)).toBe("RIFF");
		expect(view.getUint32(4, true)).toBe(36 + 4);
		expect(ascii(view, 8, 4)).toBe("WAVE");
		expect(ascii(view, 12, 4)).toBe("fmt ");
		expect(view.getUint32(16, true)).toBe(16);
		expect(view.getUint16(20, true)).toBe(1); // PCM
		expect(view.getUint16(22, true)).toBe(1); // channels
		expect(view.getUint32(24, true)).toBe(24000); // sampleRate
		expect(view.getUint32(28, true)).toBe(48000); // byteRate
		expect(view.getUint16(32, true)).toBe(2); // blockAlign
		expect(view.getUint16(34, true)).toBe(16); // bitsPerSample
		expect(ascii(view, 36, 4)).toBe("data");
		expect(view.getUint32(40, true)).toBe(4);
		expect(Array.from(new Uint8Array(wav, 44))).toEqual([1, 2, 3, 4]);
	});

	it("reflects channel count in blockAlign and byteRate", () => {
		const wav = pcmToWav(new Uint8Array(8).buffer, 48000, 2);
		const view = new DataView(wav);
		expect(view.getUint16(22, true)).toBe(2);
		expect(view.getUint16(32, true)).toBe(4); // 2 channels * 2 bytes
		expect(view.getUint32(28, true)).toBe(48000 * 4);
	});
});

describe("pcmDurationSec", () => {
	it("computes duration from PCM byte length", () => {
		expect(pcmDurationSec(48000, 24000, 1)).toBe(1);
		expect(pcmDurationSec(190608, 24000, 1)).toBeCloseTo(3.97, 1);
	});

	it("returns 0 when the byte rate is zero", () => {
		expect(pcmDurationSec(1000, 0, 1)).toBe(0);
	});
});
