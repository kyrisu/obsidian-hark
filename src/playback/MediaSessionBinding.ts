export function attachMediaSession(
	_audio: HTMLAudioElement,
	_getMetadata: () => { title: string; artist: string },
): (() => void) | undefined {
	return undefined;
}
