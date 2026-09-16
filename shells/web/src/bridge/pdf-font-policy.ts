// SPDX-License-Identifier: MPL-2.0
import { readFontEmbedding } from '../lib/font-utils.ts';
import { parseSfnt } from './export-pdf-sfnt.ts';

/** The PDF writer supports subsetted TrueType outlines. Font flags can restrict that. */
export function canEmbedPdfSubset(bytes: Uint8Array): boolean {
  const info = readFontEmbedding(bytes.slice().buffer);
  return info.permission !== 'restricted' && info.permission !== 'unknown'
    && !info.noSubsetting && !info.bitmapOnly && parseSfnt(bytes) !== null;
}
