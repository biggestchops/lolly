// SPDX-License-Identifier: MPL-2.0
/** Keep portrait and landscape in the same export class. */
export function sequenceExportSize(width: number, height: number, seconds: number, codec = ''): { width: number; height: number; reduced: boolean } {
  if (![width, height, seconds].every(Number.isFinite) || width <= 0 || height <= 0 || seconds < 0) {
    throw new RangeError('Invalid sequence dimensions or duration');
  }
  const costly = seconds > 300 && /^(vp09|vp9|av01|av1|hev1|hvc1|hevc)/i.test(codec);
  const longEdge = costly ? 1920 : 4096;
  const shortEdge = costly ? 1080 : 2160;
  const scale = Math.min(1, longEdge / Math.max(width, height), shortEdge / Math.min(width, height));
  const even = (n: number): number => Math.max(2, Math.floor(n / 2) * 2);
  return { width: even(width * scale), height: even(height * scale), reduced: scale < 1 };
}
