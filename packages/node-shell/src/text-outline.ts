// SPDX-License-Identifier: MPL-2.0
/** Parse each immutable glyph once; pixel placement performs only numeric transforms. */
import type { GlyphOutline } from './text-glyphs.ts';
const compiled = new WeakMap<GlyphOutline, Array<{ command: string; points: number[] }>>();
const round = (n: number): number => Math.round(n * 10000) / 10000;
export function textOutlinePixels(glyph: GlyphOutline, x: number, y: number, scale: number): string {
  let commands = compiled.get(glyph);
  if (!commands) {
    commands = [...glyph.path.matchAll(/([MLCQZ])([^MLCQZ]*)/gu)].map(match => ({
      command: match[1]!, points: (match[2]!.match(/-?\d*\.?\d+(?:[eE][+-]?\d+)?/gu) ?? []).map(Number),
    }));
    compiled.set(glyph, commands);
  }
  let path = '';
  for (const {command, points} of commands) {
    path += command;
    for (let i = 0; i + 1 < points.length; i += 2) {
      if (i) path += ' ';
      path += `${round((points[i]! + x) * scale)},${round(-(points[i + 1]! + y) * scale)}`;
    }
  }
  return path;
}
