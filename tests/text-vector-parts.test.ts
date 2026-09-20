// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { Resvg } from '@resvg/resvg-js';
import { importVectorPaint } from '../engine/src/vector-paint-import.ts';
import { splitVectorPaint } from '../engine/src/vector-paint-parts.ts';
import { renderVectorPaint } from '../engine/src/vector-paint.ts';
import { toSvgPathData } from '../engine/src/geom/path.ts';
import { boxToPath } from '../shells/web/src/views/vector-ops.ts';
import { editableVectorPart } from '../shells/web/src/views/text-vector-parts.ts';
const parser = new (new JSDOM('').window.DOMParser)();
const parse = (value: string) => parser.parseFromString(value, 'image/svg+xml');
test('separated solid emoji pieces have normal fills and tight frames without changing rotated ink', () => {
  const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><g transform="translate(12 8)" fill="#ffaa22"><path d="M0 0H70V80H0Z M10 10V70H60V10Z" fill-rule="evenodd"/><g opacity="0.6"><path fill="#22aaff" d="M90 10H130V50H90Z"/></g></g></svg>';
  const vector = importVectorPaint(source, parse), box = { id: 'emoji', kind: 'path', x: 100, y: 120, w: 400, h: 200, rot: 12, opacity: 80, vectorSource: 'credits' };
  const parts = splitVectorPaint(vector.path, vector.paint).map(part => editableVectorPart(box, part, {}));
  assert.equal(parts.length, 2);assert.ok(parts.every(part => !part.pathPaint && Number(part.w) < box.w && Number(part.h) < box.h && part.vectorSource === 'credits'));
  assert.equal(parts[0]!.bg, '#ffaa22');assert.equal(parts[0]!.fillRule, 'evenodd');assert.equal(parts[1]!.bg, '#22aaff');assert.equal(parts[1]!.opacity, 48);
  const root = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="500">${body}</svg>`;
  const before = root(`<g opacity="0.8" transform="rotate(12 300 220)"><g transform="translate(100 120)">${renderVectorPaint(vector.path, vector.paint, 400, 200, 'source')}</g></g>`);
  const after = root(parts.map(part => `<path d="${toSvgPathData(boxToPath(part)!)}" fill="${part.bg}" fill-rule="${part.fillRule}" opacity="${Number(part.opacity)/100}"/>`).join(''));
  const a = new Resvg(before).render().pixels, b = new Resvg(after).render().pixels;
  const error = a.reduce((sum, value, index) => sum + Math.abs(value - b[index]!), 0) / a.length;assert.ok(error < 0.03, `mean channel error ${error}`);
  parts[1]!.bg = '#ee1166';assert.equal(parts[0]!.bg, '#ffaa22', 'fills remain independent');
});
test('gradient and clipped parts retain their exact paint and editable geometry', () => {
  const vector = importVectorPaint('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><path d="M0 0H20V20H0Z" fill="url(#g)"/><path d="M30 0H50V20H30Z"/></svg>', parse);
  const part = splitVectorPaint(vector.path, vector.paint)[0]!, box = { x: 12, y: 15, w: 200, h: 300, rot: 12 };
  const result = editableVectorPart(box, part, {});assert.equal(result.path, part.path);assert.ok(result.pathPaint);assert.equal(result.rot, 0);assert.ok(Number(result.w)<box.w&&Number(result.h)<box.h);
  const wrap=(content:string)=>`<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500">${content}</svg>`;
  const before=wrap(`<g transform="rotate(12 112 165)"><g transform="translate(12 15)">${renderVectorPaint(part.path,part.paint,200,300,'before')}</g></g>`);
  const after=wrap(`<g transform="translate(${result.x} ${result.y})">${renderVectorPaint(String(result.path),result.pathPaint,Number(result.w),Number(result.h),'after')}</g>`);
  const a=new Resvg(before).render().pixels,b=new Resvg(after).render().pixels;assert.ok(a.reduce((sum,value,index)=>sum+Math.abs(value-b[index]!),0)/a.length<0.03);
});
