// SPDX-License-Identifier: MPL-2.0
import type { ExportOpts } from './export-shared.ts';
import type { HdrBoostOptions } from '../../../../engine/src/hdr.ts';
export function wantsDeepExport(format:string,opts:ExportOpts):boolean {
  return !!opts.deepFrame || opts.sourceDocument?.toolId === 'design' && (opts.sourceDocument.values.editingRange === 'hdr' || !!opts.hdr) && !['mp4','webm','gif','apng','webp-anim','svg-anim','lottie','html'].includes(format);
}

export function hdrTune(opts: ExportOpts): Partial<HdrBoostOptions> {
  const t: Partial<HdrBoostOptions> = {};
  if (opts.hdrPeakNits != null) t.peakNits = opts.hdrPeakNits;
  if (opts.hdrReach != null) {
    const r = Math.min(1, Math.max(0, opts.hdrReach / 100));
    const center = 0.65 - 0.45 * r;               // r=0 → 0.65 (brights only); r=1 → 0.20 (almost all)
    t.kneeLo = Math.max(0, center - 0.12);
    t.kneeHi = Math.min(1, center + 0.12);
  }
  if (opts.hdrLift != null) t.boostFloor = Math.min(1, Math.max(0, opts.hdrLift / 100));
  if (opts.hdrRichness != null) t.richness = Math.min(1, Math.max(0, opts.hdrRichness / 100));
  return t;
}
