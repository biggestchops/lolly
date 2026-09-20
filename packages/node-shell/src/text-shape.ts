// SPDX-License-Identifier: MPL-2.0
/** Shared HarfBuzz adapter. The caller supplies an immutable, content-pinned face. */
import type * as HarfBuzz from 'harfbuzzjs';
import type { TextFontV1, TextShapedRunV1 } from '@lolly-tools/core';
import { textBoundaries, TextSourceError } from '@lolly/engine';
import { textOutlinePixels } from './text-outline.ts';
import { createGlyphCache } from './text-glyphs.ts';
const glyphs = createGlyphCache();
const round = (n: number): number => Math.round(n * 10000) / 10000;
export interface ShapeTextRunOptions {
  outline?: boolean;
  text: string;
  start: number;
  direction: 'ltr' | 'rtl';
  script: string;
  language: string;
  size: number;
  tracking?: number;
  identity: TextFontV1;
  context?: { before: string; after: string };
}
/** Offsets are logical UTF-16; paths and carets use the run's visual coordinates. */
export function shapeTextRun(hb: typeof HarfBuzz, font: HarfBuzz.Font, options: ShapeTextRunOptions): TextShapedRunV1 {
  const { text, start, direction, script, language, size, identity, tracking = 0 } = options;
  const boundaries = [...textBoundaries(text)];
  const boundaryIndex = new Map(boundaries.map((at, index) => [at, index]));
  const clusterAt = new Uint32Array(text.length + 1);
  for (let i = 1; i < boundaries.length; i++) clusterAt.fill(boundaries[i - 1]!, boundaries[i - 1]!, boundaries[i]!);
  clusterAt[text.length] = text.length;
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isFinite(size) || size <= 0 || size > 10000 || !Number.isFinite(tracking) || Math.abs(tracking) > 1000) throw new TextSourceError('shape-options', 'Invalid text shaping dimensions or source origin.');
  if (!/^[A-Za-z]{4}$/u.test(script) || !/^[a-zA-Z0-9-]{1,63}$/u.test(language) || !/^[a-f0-9]{64}$/u.test(identity.sha256)) throw new TextSourceError('shape-options', 'Text shaping requires a script, language and exact font identity.');
  const scale = size / font.face.upem, dir = direction === 'rtl' ? hb.Direction.RTL : hb.Direction.LTR;
  const buffer = new hb.Buffer();
  const before = options.context?.before ?? '', after = options.context?.after ?? '';
  const contextual = before + text + after;
  const contextualBoundaries = textBoundaries(contextual);
  if (!contextualBoundaries.has(before.length) || !contextualBoundaries.has(before.length + text.length)) throw new TextSourceError('shape-boundary', 'Shaping context must preserve complete character boundaries.');
  buffer.addText(contextual, before.length, text.length);
  buffer.setFlags((before ? 0 : hb.BufferFlag.BOT) | (after ? 0 : hb.BufferFlag.EOT));
  buffer.setDirection(dir); buffer.setScript(script); buffer.setLanguage(language);
  buffer.setClusterLevel(hb.ClusterLevel.MONOTONE_GRAPHEMES);
  const features = Object.entries(identity.features).map(([tag, value]) => {
    if (!/^[A-Za-z0-9]{4}$/u.test(tag) || !Number.isSafeInteger(value) || value < 0 || value > 65535) throw new TextSourceError('shape-feature', `Invalid OpenType feature: ${tag}`);
    const feature = hb.Feature.fromString(`${tag}=${value}`);
    if (!feature) throw new TextSourceError('shape-feature', `Invalid OpenType feature: ${tag}`);
    return feature;
  });
  hb.shape(font, buffer, features);
  const output = buffer.getGlyphInfosAndPositions();
  if (output.length > 131072) throw new TextSourceError('shape-size', 'The shaped run exceeds the supported glyph count.');
  type Piece = { start: number; x: number; advance: number; d: string; missing: boolean; glyphs: Array<{ id: number; x: number }> };
  const pieces = new Map<number, Piece>(); let pen = 0, previous: Piece | undefined;
  for (const glyph of output) {
    const at = glyph.cluster - before.length;
    if (!Number.isInteger(at) || at < 0 || at >= text.length || /[\udc00-\udfff]/u.test(text[at]!)) throw new TextSourceError('shape-boundary', 'The font shaper returned an invalid source cluster.');
    // HarfBuzz can subdivide Indic conjuncts that Unicode 17 groups as one grapheme.
    const origin = clusterAt[at]!;
    let piece = pieces.get(origin);
    if (!piece) {
      if (previous) { previous.advance += tracking; pen += tracking; }
      piece = { start: origin, x: pen, advance: 0, d: '', missing: false, glyphs: [] };
      pieces.set(origin, piece); previous = piece;
    }
    const x = pen + (glyph.xOffset ?? 0) * scale;
    if (options.outline !== false) piece.d += textOutlinePixels(glyphs.get(font, glyph.codepoint), x / scale, glyph.yOffset ?? 0, scale);
    piece.glyphs.push({ id: glyph.codepoint, x });
    piece.missing ||= glyph.codepoint === 0;
    piece.advance += (glyph.xAdvance ?? 0) * scale;
    pen += (glyph.xAdvance ?? 0) * scale;
  }
  const logical = [...pieces.values()].sort((a, b) => a.start - b.start);
  const clusters = logical.map((piece, index) => {
    const end = logical[index + 1]?.start ?? text.length;
    const stops = boundaries.slice(boundaryIndex.get(piece.start)!, boundaryIndex.get(end)! + 1);
    const advance = round(piece.advance), x = round(piece.x);
    let interior: number[] = [];
    if (piece.glyphs.length === 1 && stops.length > 2) {
      const glyph = piece.glyphs[0]!;
      interior = font.getLigatureCarets(dir, glyph.id).map(value => glyph.x - piece.x + value * scale).filter(value => value > 0 && value < piece.advance).sort((a, b) => a - b);
      if (interior.length !== stops.length - 2) interior = [];
    }
    const positions = [0, ...(interior.length ? interior : stops.slice(1, -1).map((_, i) => advance * (i + 1) / (stops.length - 1))), advance];
    if (direction === 'rtl') positions.reverse();
    return { start: start + piece.start, end: start + end, x, advance, d: piece.d,
      carets: stops.map((offset, i) => ({ offset: start + offset, x: round(x + positions[i]!) })) };
  });
  const extents = font.hExtents();
  return { start, end: start + text.length, text, direction, script, language, font: structuredClone(identity), size,
    advance: round(pen), ascent: round(extents.ascender * scale), descent: round(-extents.descender * scale), lineGap: round(extents.lineGap * scale), clusters,
    missing: logical.flatMap((piece, i) => piece.missing ? [{ start: start + piece.start, end: start + (logical[i + 1]?.start ?? text.length) }] : []) };
}
