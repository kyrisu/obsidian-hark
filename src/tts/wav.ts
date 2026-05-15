const WAV_HEADER_BYTES = 44;
const BYTES_PER_SAMPLE = 2; // 16-bit PCM

/**
 * Wraps raw little-endian 16-bit PCM in a minimal WAV container so the bytes are
 * playable by HTMLAudioElement and cacheable as a self-describing file.
 */
export function pcmToWav(pcm: ArrayBuffer, sampleRate: number, channels: number): ArrayBuffer {
	const dataLength = pcm.byteLength;
	const blockAlign = channels * BYTES_PER_SAMPLE;
	const byteRate = sampleRate * blockAlign;
	const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataLength);
	const view = new DataView(buffer);

	writeAscii(view, 0, "RIFF");
	view.setUint32(4, 36 + dataLength, true);
	writeAscii(view, 8, "WAVE");
	writeAscii(view, 12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true); // AudioFormat: 1 = PCM
	view.setUint16(22, channels, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, byteRate, true);
	view.setUint16(32, blockAlign, true);
	view.setUint16(34, BYTES_PER_SAMPLE * 8, true);
	writeAscii(view, 36, "data");
	view.setUint32(40, dataLength, true);

	new Uint8Array(buffer, WAV_HEADER_BYTES).set(new Uint8Array(pcm));
	return buffer;
}

export function pcmDurationSec(
	pcmByteLength: number,
	sampleRate: number,
	channels: number,
): number {
	const byteRate = sampleRate * channels * BYTES_PER_SAMPLE;
	return byteRate > 0 ? pcmByteLength / byteRate : 0;
}

function writeAscii(view: DataView, offset: number, text: string): void {
	for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}
