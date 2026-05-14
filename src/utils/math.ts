export function clamp(value: number, lo: number, hi: number): number {
	if (hi < lo) return lo;
	return Math.max(lo, Math.min(hi, value));
}
