// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { fixture, style } from './helpers/emoji-fixtures.ts';
import { applyEmojiToSvgText, revertEmojiSvgText } from '../engine/src/emoji-svg-text.ts';
import type { TextAPI } from '../packages/core/src/host-v1.ts';

const f = await fixture();
const dom = new JSDOM('');
const io = { loadArtwork: async () => f.artwork, parseXml: (source: string) => new dom.window.DOMParser().parseFromString(source, 'image/svg+xml') };
const shaper: TextAPI = { preload: async () => {}, fontUrl: async () => ({ url: 'pinned.ttf' }),
  toPath: async ({ text, fontSize, clusters }) => ({ d: text.trim() ? 'M0 0L1 -1' : '', advanceWidth: text.length * fontSize / 2, bbox: null, ...(clusters?{clusters:[...text].map((_,i)=>({start:i,end:i+1,d:`M${i*fontSize/2} 0L${i*fontSize/2+1} -1`,x:i*fontSize/2,advance:fontSize/2}))}:{}) }) };

test('SVG emoji use admitted vectors, preserve text, and replay identical placements', async () => {
  const doc = new dom.window.DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg"><text id="heading" x="20" y="40" font-size="20" font-family="Fixture" text-anchor="middle">Hi &#x1f600;!</text></svg>', 'image/svg+xml');
  const root = doc.documentElement;
  const first = await applyEmojiToSvgText(root, style(f.lock.pin), [f.pack], io, shaper);
  assert.equal(first.replaced, 1); assert.equal(first.unresolved, 0); assert.equal(first.census.length, 1);
  assert.equal(root.querySelectorAll('g[data-lolly-emoji-svg] > g svg').length, 1);
  assert.equal(root.querySelectorAll('#heading').length, 1);
  assert.equal(root.querySelector('defs text')?.textContent, 'Hi \u{1f600}!');
  const bytes = root.outerHTML;
  const second = await applyEmojiToSvgText(root, style(f.lock.pin), [f.pack], io, shaper);
  assert.deepEqual(second, first); assert.equal(root.outerHTML, bytes);
  revertEmojiSvgText(root);
  assert.equal(root.querySelector('text')?.id, 'heading');
  assert.equal(root.querySelectorAll('g').length, 0);
});

test('SVG layout refusal keeps meaning in the source and never draws a native emoji', async () => {
  const doc = new dom.window.DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg"><text x="1 2">Hi &#x1f600;</text></svg>', 'image/svg+xml');
  const result = await applyEmojiToSvgText(doc.documentElement, style(f.lock.pin), [f.pack], io, shaper);
  assert.equal(result.replaced, 0); assert.equal(result.unresolved, 1);
  assert.match(doc.querySelector('[data-emoji-layout-issue]')!.getAttribute('data-emoji-layout-issue')!, /coordinates/);
  assert.equal(doc.querySelector('g > text')?.textContent, 'Hi \u25a1');
});

test('SVG path emoji retain the curved baseline and percentage anchor',async()=>{
  const doc=new dom.window.DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><defs><path id="arc" d="M10 80 Q100 -20 190 80"/></defs><text font-size="20" font-family="Fixture" text-anchor="middle"><textPath href="#arc" startOffset="50%">Hi 😀</textPath></text></svg>','image/svg+xml');
  const result=await applyEmojiToSvgText(doc.documentElement,style(f.lock.pin),[f.pack],io,shaper);
  assert.equal(result.replaced,1);assert.equal(result.unresolved,0);
  assert.match(doc.querySelector('[data-lolly-emoji-svg]')!.outerHTML,/rotate\(/);
  assert.equal(doc.querySelector('defs textPath')?.getAttribute('startOffset'),'50%');
  revertEmojiSvgText(doc.documentElement);
  assert.equal(doc.querySelector('text > textPath')?.textContent,'Hi 😀');
});

test('SVG text path sampling refuses disconnected and oversized geometry',async()=>{
  const {emojiTextPath}=await import('../engine/src/emoji-text-path.ts');
  assert.throws(()=>emojiTextPath('M0 0L10 0M20 0L30 0'),/continuous/);
  assert.throws(()=>emojiTextPath('M0 0L1000001 0'),/coordinates/);
  assert.throws(()=>emojiTextPath(' '.repeat(32769)),/budget/);
  const path=emojiTextPath('M0 0L100 0');assert.equal(path.length,100);assert.deepEqual(path.at(50),{x:50,y:0,angle:0});
});
