// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as hb from 'harfbuzzjs';
import { shapeTextRun } from '../packages/node-shell/src/text-shape.ts';
import { textBoundaries } from '../engine/src/text-source.ts';
const fixtures = [
  { file: 'shells/web/public/fonts/SUSE[wght].ttf', text: 'office e\u0301 fi ﬂ', direction: 'ltr', script: 'Latn', language: 'en' },
  { file: 'tests/fixtures/text-composition/fonts/notosansarabic/NotoSansArabic[wdth,wght].ttf', text: 'العربية', direction: 'rtl', script: 'Arab', language: 'ar' },
  { file: 'tests/fixtures/text-composition/fonts/notosanshebrew/NotoSansHebrew[wdth,wght].ttf', text: 'עִבְרִית', direction: 'rtl', script: 'Hebr', language: 'he' },
  { file: 'tests/fixtures/text-composition/fonts/notosansdevanagari/NotoSansDevanagari[wdth,wght].ttf', text: 'क्षेत्र हिन्दी', direction: 'ltr', script: 'Deva', language: 'hi' },
  { file: 'tests/fixtures/text-composition/fonts/notosansthai/NotoSansThai[wdth,wght].ttf', text: 'ภาษาไทย', direction: 'ltr', script: 'Thai', language: 'th' },
] as const;
for (const fixture of fixtures) test(`exact shaped source, metrics and caret coverage for ${fixture.script}`, () => {
  const bytes = readFileSync(fixture.file), font = new hb.Font(new hb.Face(new hb.Blob(bytes)));
  const identity = { id: fixture.script, faceIndex: 0, sha256: createHash('sha256').update(bytes).digest('hex'), family: fixture.script, axes: {}, features: { kern: 1, liga: 1 } };
  const options = { ...fixture, start: 8, size: 32, identity };
  const shaped = shapeTextRun(hb, font, options);
  assert.deepEqual(shapeTextRun(hb, font, options), shaped);
  assert.equal(shaped.text, fixture.text); assert.deepEqual(shaped.missing, []);
  assert.ok(shaped.advance > 0 && shaped.ascent > 0 && shaped.descent >= 0);
  assert.deepEqual([...new Set(shaped.clusters.flatMap(c => c.carets.map(p => p.offset - 8)))].sort((a,b)=>a-b), [...textBoundaries(fixture.text)]);
  assert.equal(shaped.clusters.map(c => fixture.text.slice(c.start - 8, c.end - 8)).join(''), fixture.text);
  const x = shaped.clusters.map(c=>c.x);
  assert.ok(x.every((n,i)=>!i || (fixture.direction === 'ltr' ? n >= x[i-1]! : n <= x[i-1]!)));
});
test('font GDEF caret positions are preferred and a missing table has a bounded fallback', () => {
  const bytes = readFileSync(fixtures[0]!.file), font = new hb.Font(new hb.Face(new hb.Blob(bytes)));
  const identity = { id: 'latin', faceIndex: 0, sha256: createHash('sha256').update(bytes).digest('hex'), family: 'SUSE', axes: {}, features: { liga: 1 } };
  const shaped = shapeTextRun(hb, font, { text: 'ffi', start: 0, size: 48, direction: 'ltr', script: 'Latn', language: 'en', identity });
  assert.deepEqual([...new Set(shaped.clusters.flatMap(c=>c.carets.map(p=>p.offset)))], [0,1,2,3]);
  assert.ok(shaped.clusters.every(c=>c.carets.every(p=>p.x >= c.x && p.x <= c.x+c.advance+0.0001)));
});

test('the shipped SUSE fi ligature uses its real unequal GDEF caret', () => {
  const bytes=readFileSync(fixtures[0]!.file),font=new hb.Font(new hb.Face(new hb.Blob(bytes)));
  const buffer=new hb.Buffer();buffer.addText('fi');buffer.guessSegmentProperties();hb.shape(font,buffer);
  const glyphs=buffer.getGlyphInfosAndPositions();assert.equal(glyphs.length,1);
  const authored=font.getLigatureCarets(hb.Direction.LTR,glyphs[0]!.codepoint);assert.equal(authored.length,1);
  const identity={id:'latin',faceIndex:0,sha256:createHash('sha256').update(bytes).digest('hex'),family:'SUSE',axes:{},features:{liga:1}};
  const shaped=shapeTextRun(hb,font,{text:'fi',start:0,size:48,direction:'ltr',script:'Latn',language:'en',identity});
  const cluster=shaped.clusters[0]!;assert.equal(cluster.carets[1]!.x,Math.round(authored[0]!*48/font.face.upem*10000)/10000);
  assert.notEqual(cluster.carets[1]!.x,cluster.advance/2,'font caret is used instead of equal division');
});
