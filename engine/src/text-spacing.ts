// SPDX-License-Identifier: MPL-2.0
/** Word spacing moves clusters and source carets together without scaling glyph ink. */
import type { ShapedTextLine } from './text-paragraph.ts';
import { parseSvgPath } from './svg-path.ts';
const n = (value: number) => Math.round(value * 10000) / 10000;
export function transformTextPath(d: string, matrix: {a:number;b:number;c:number;d:number;e:number;f:number}): string {
  const at=(x:number,y:number)=>`${n(matrix.a*x+matrix.c*y+matrix.e)},${n(matrix.b*x+matrix.d*y+matrix.f)}`;
  return parseSvgPath(d).map(path=>path.segments.map(segment=>segment.op==='C'?`C${at(segment.x1,segment.y1)} ${at(segment.x2,segment.y2)} ${at(segment.x,segment.y)}`:`${segment.op}${at(segment.x,segment.y)}`).join('')+(path.closed?'Z':'')).join('');
}
export function translateTextPath(d: string, x: number, y = 0): string {
  if (!d || !x && !y) return d;
  return parseSvgPath(d).map(path => path.segments.map(segment => segment.op === 'C'
    ? `C${n(segment.x1 + x)},${n(segment.y1 + y)} ${n(segment.x2 + x)},${n(segment.y2 + y)} ${n(segment.x + x)},${n(segment.y + y)}`
    : `${segment.op}${n(segment.x + x)},${n(segment.y + y)}`).join('') + (path.closed ? 'Z' : '')).join('');
}
export function textSpaceWidth(line: ShapedTextLine, source: string): number {
  return line.pieces.reduce((sum, piece) => sum + (piece.artwork?.whitespace?piece.advance:piece.shape?.clusters.reduce((sum, cluster) => sum + (/^[ \u00a0\u202f]+$/u.test(source.slice(cluster.start, cluster.end)) ? cluster.advance : 0), 0) ?? 0), 0);
}
/** factor multiplies the already settled word-space advances, including nonbreaking spaces. */
export function spaceTextLine(line: ShapedTextLine, source: string, factor: number): ShapedTextLine {
  if (Math.abs(factor - 1) < .000001) return line;
  let pen = 0;
  const pieces = line.pieces.map(piece => {
    const x = pen;
    if (!piece.shape) { const scale=piece.artwork?.whitespace?factor:1,advance=piece.advance*scale;pen += advance; return { ...piece, x,advance, carets: piece.carets.map(caret => ({ ...caret, x: n((caret.x - piece.x)*scale + x) })) }; }
    const visual = [...piece.shape.clusters].sort((a,b) => a.x-b.x), moved = new Map<number, typeof visual[number]>(); let delta = 0;
    for (const cluster of visual) {
      const extra = /^[ \u00a0\u202f]+$/u.test(source.slice(cluster.start, cluster.end)) ? cluster.advance * (factor - 1) : 0;
      moved.set(cluster.start, { ...cluster, x: n(cluster.x + delta), advance: n(cluster.advance + extra), d: translateTextPath(cluster.d, delta),
        carets: cluster.carets.map(caret => ({ ...caret, x: n(caret.x + delta + (cluster.advance ? (caret.x - cluster.x) / cluster.advance * extra : 0)) })) });
      delta += extra;
    }
    const advance = n(piece.advance + delta), shape = { ...piece.shape, advance, clusters: piece.shape.clusters.map(cluster => moved.get(cluster.start)!) };
    pen += advance;
    return { ...piece, x: n(x), advance, shape, carets: shape.clusters.flatMap(cluster => cluster.carets.map(caret => ({ ...caret, x: n(x + caret.x) }))) };
  });
  return { ...line, pieces, advance: n(pen + (line.hyphen?.shape.advance ?? 0)) };
}
