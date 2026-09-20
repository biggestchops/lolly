// SPDX-License-Identifier: MPL-2.0
/** Repeated line content shares outlines; callers receive their own logical offsets. */
import type { TextShapeRunRequestV1, TextShapedRunV1 } from '@lolly-tools/core';
function copyRun(run: TextShapedRunV1, start = run.start): TextShapedRunV1 {
  const delta = start - run.start;
  return { ...run, start, end: run.end + delta,
    font: { ...run.font, axes: { ...run.font.axes }, features: { ...run.font.features } },
    clusters: run.clusters.map(cluster => ({ ...cluster, start: cluster.start + delta, end: cluster.end + delta,
      carets: cluster.carets.map(caret => ({ ...caret, offset: caret.offset + delta })) })),
    missing: run.missing.map(range => ({ ...range, start: range.start + delta, end: range.end + delta })),
  };
}
export function createTextShapeCache() {
  const entries = new Map<string, { run: TextShapedRunV1; bytes: number }>(); let bytes = 0;
  return {
    key(request: TextShapeRunRequestV1): string {
      const { start: _start, font, ...shape } = request;
      return JSON.stringify([font.sha256,font.faceIndex,font.id,font.family,shape]);
    },
    read(key: string, start: number): TextShapedRunV1 | undefined {
      const entry = entries.get(key); if (!entry) return;
      entries.delete(key); entries.set(key, entry);
      return copyRun(entry.run, start);
    },
    remember(key: string, run: TextShapedRunV1): void {
      const cost = 2 * (key.length + JSON.stringify(run).length), limit = 16 * 1024 * 1024;
      if (cost > limit) return;
      const old = entries.get(key); if (old) { bytes -= old.bytes; entries.delete(key); }
      while (entries.size && (entries.size >= 256 || bytes + cost > limit)) {
        const first = entries.keys().next().value!; bytes -= entries.get(first)!.bytes; entries.delete(first);
      }
      entries.set(key, { run: copyRun(run), bytes: cost }); bytes += cost;
    },
    clear(): void { entries.clear(); bytes = 0; },
  };
}
