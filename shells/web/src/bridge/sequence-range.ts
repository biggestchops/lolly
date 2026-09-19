// SPDX-License-Identifier: MPL-2.0
import { parseSequenceMarks, sequenceRange } from '../../../../engine/src/sequence-marks.ts';
import { projectRate } from '../../../../engine/src/timebase.ts';
import type { MixSpec } from './mix-window.ts';

export function sequenceSettings(node: Element, durationMs: number): { fromMs: number; toMs: number; fps: number } {
  const stage = (node.matches('[data-sequence]') ? node : node.querySelector('[data-sequence]')) as HTMLElement | null;
  const rate = projectRate(stage?.dataset.seqFps);
  return { ...sequenceRange(parseSequenceMarks(stage?.dataset.seqMarks), durationMs), fps: rate.numerator / rate.denominator };
}
/** Move the mix origin; local automation and source samples retain their positions. */
export function offsetMix(spec: MixSpec | null, fromMs: number): MixSpec | null {
  if (!spec || fromMs === 0) return spec;
  const samples = Math.round(fromMs * (spec.rate ?? 48_000) / 1000);
  return { ...spec, clips: spec.clips.map(clip => ({ ...clip, startMs: clip.startMs - fromMs })),
    beds: spec.beds.map(bed => ({ ...bed, startSample: (bed.startSample ?? 0) - samples })) };
}
