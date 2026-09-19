// SPDX-License-Identifier: MPL-2.0
/** A bounded source-rate census. Editing and rendering still use seconds. */
export interface ClipFrameRate { fps: number; variable: boolean }
const cache = new Map<string, Promise<ClipFrameRate | null>>();
export function clipFrameRate(url: string): Promise<ClipFrameRate | null> {
  if (!/^(https?:|blob:|data:)/i.test(url)) return Promise.resolve(null);
  const found = cache.get(url);
  if (found) return found;
  const pending = (async (): Promise<ClipFrameRate | null> => {
    const { Input, UrlSource, MP4, QTFF, WEBM, MATROSKA } = await import('mediabunny');
    const input = new Input({ source: new UrlSource(url), formats: [MP4, QTFF, WEBM, MATROSKA] });
    const timer = setTimeout(() => input.dispose(), 5000);
    try {
      const track = await input.getPrimaryVideoTrack();
      const metrics = await track?.computeFrameRateMetrics({ targetPacketCount: 256 });
      return metrics && metrics.bestGuessFrameRate > 0
        ? { fps: metrics.bestGuessFrameRate, variable: !metrics.frameRateIsConstant } : null;
    } catch { return null; }
    finally { clearTimeout(timer); input.dispose(); }
  })().catch(() => null);
  cache.set(url, pending);
  if (cache.size > 24) cache.delete(cache.keys().next().value!);
  return pending;
}
