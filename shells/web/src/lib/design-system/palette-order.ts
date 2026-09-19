// SPDX-License-Identifier: MPL-2.0
/** Display order uses stable token keys, leaving values and role aliases intact. */
import { TOKEN_EXT } from '@lolly/engine';
import { isRec } from '../brand-doc.ts';

export function paletteOrder(doc: unknown): string[] {
  if (!isRec(doc) || !isRec(doc.$extensions)) return [];
  const vendor = doc.$extensions[TOKEN_EXT];
  return isRec(vendor) && Array.isArray(vendor.paletteOrder)
    ? [...new Set(vendor.paletteOrder.filter((key): key is string => typeof key === 'string'))] : [];
}

export function writePaletteOrder(doc: unknown, keys: string[]): void {
  if (!isRec(doc)) return;
  if (!isRec(doc.$extensions)) doc.$extensions = {};
  const ext = doc.$extensions as Record<string, unknown>;
  if (!isRec(ext[TOKEN_EXT])) ext[TOKEN_EXT] = {};
  (ext[TOKEN_EXT] as Record<string, unknown>).paletteOrder = [...new Set(keys)];
}

export function orderPalette<T extends { key: string }>(items: T[], order: string[]): T[] {
  const positions = new Map(order.map((key, i) => [key, i]));
  return [...items].sort((a, b) => (positions.get(a.key) ?? Infinity) - (positions.get(b.key) ?? Infinity));
}
