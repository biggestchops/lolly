// SPDX-License-Identifier: MPL-2.0
/** Shared web/Node outline reuse. Shaping and pixel placement remain per run. */
export interface GlyphExtents {
  xBearing: number;
  yBearing: number;
  width: number;
  height: number;
}

export interface GlyphSource {
  glyphToPath(id: number): string;
  glyphExtents(id: number): GlyphExtents | undefined | null;
}

export interface GlyphOutline {
  readonly path: string;
  readonly extents: Readonly<GlyphExtents> | null;
}

/**
 * A font must keep its face, variations and scale unchanged while cached.
 * Object identity includes that resolved state; URLs or family names do not.
 * Bytes account for UTF-16 path storage plus a fixed metadata allowance, not
 * a measurement of the JS heap. The entry limit bounds object overhead too.
 */
export function createGlyphCache(maxBytes = 4 * 1024 * 1024, maxEntries = 4096) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || !Number.isSafeInteger(maxEntries) || maxEntries < 0) {
    throw new RangeError('Glyph cache limits must be non-negative integers');
  }
  const fonts = new WeakMap<GlyphSource, number>();
  const entries = new Map<string, { glyph: GlyphOutline; bytes: number }>();
  let nextFont = 0, bytes = 0, hits = 0, misses = 0;
  return {
    get(font: GlyphSource, id: number): GlyphOutline {
      let fontId = fonts.get(font);
      if (fontId === undefined) { fontId = ++nextFont; fonts.set(font, fontId); }
      const key = `${fontId}:${id}`;
      const cached = entries.get(key);
      if (cached) {
        hits++;
        entries.delete(key); entries.set(key, cached);
        return cached.glyph;
      }
      misses++;
      const path = font.glyphToPath(id);
      const extents = font.glyphExtents(id);
      const glyph = Object.freeze({ path, extents: extents ? Object.freeze({ ...extents }) : null });
      const cost = path.length * 2 + key.length * 2 + 128;
      if (maxEntries > 0 && cost <= maxBytes) {
        while (entries.size && (entries.size >= maxEntries || bytes + cost > maxBytes)) {
          const oldest = entries.keys().next().value!;
          bytes -= entries.get(oldest)!.bytes;
          entries.delete(oldest);
        }
        entries.set(key, { glyph, bytes: cost }); bytes += cost;
      }
      return glyph;
    },
    clear(): void { entries.clear(); bytes = 0; },
    stats() { return { entries: entries.size, bytes, hits, misses, maxBytes, maxEntries }; },
  };
}
