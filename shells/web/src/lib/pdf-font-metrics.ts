// SPDX-License-Identifier: MPL-2.0
import { PDFArray, type PDFContext } from 'pdf-lib';
import { getKey, nameOf, numOf, type Ref } from './pdf-objects.ts';
import type { PdfFontInfo } from '../../../../engine/src/pdf-map.ts';

/** Read advances by character code, independently of Unicode decoding. */
export function pdfFontMetrics(ctx: PDFContext, font: Ref): Pick<PdfFontInfo, 'widths' | 'defaultWidth'> {
  const widths: Record<number, number> = {};
  if (nameOf(ctx, getKey(ctx, font, 'Subtype')) === 'Type0') {
    const descendants = ctx.lookup(getKey(ctx, font, 'DescendantFonts'));
    const descendant = descendants instanceof PDFArray ? descendants.get(0) : undefined;
    const defaultWidth = numOf(ctx, getKey(ctx, descendant, 'DW')) ?? 1000;
    const entries = ctx.lookup(getKey(ctx, descendant, 'W'));
    if (entries instanceof PDFArray) {
      for (let i = 0; i < entries.size();) {
        const first = numOf(ctx, entries.get(i++));
        if (first == null || !Number.isInteger(first) || first < 0 || first > 65535 || i >= entries.size()) break;
        const next = ctx.lookup(entries.get(i++));
        if (next instanceof PDFArray) {
          for (let j = 0; j < next.size() && first + j <= 65535; j++) {
            const width = numOf(ctx, next.get(j));
            if (width != null && Number.isFinite(width)) widths[first + j] = width;
          }
        } else {
          const last = numOf(ctx, next);
          const width = i < entries.size() ? numOf(ctx, entries.get(i++)) : null;
          if (last == null || width == null || !Number.isFinite(width) || last < first || last > 65535) break;
          for (let code = first; code <= last; code++) widths[code] = width;
        }
      }
    }
    return { widths, defaultWidth };
  }
  const first = numOf(ctx, getKey(ctx, font, 'FirstChar')) ?? 0;
  const entries = ctx.lookup(getKey(ctx, font, 'Widths'));
  if (entries instanceof PDFArray) {
    for (let i = 0; i < entries.size() && first + i <= 255; i++) {
      const width = numOf(ctx, entries.get(i));
      if (width != null && Number.isFinite(width)) widths[first + i] = width;
    }
  }
  const missing = numOf(ctx, getKey(ctx, getKey(ctx, font, 'FontDescriptor'), 'MissingWidth'));
  return { ...(Object.keys(widths).length ? { widths } : {}), ...(missing == null ? {} : { defaultWidth: missing }) };
}
