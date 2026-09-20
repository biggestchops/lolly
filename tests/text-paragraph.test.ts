// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { TextDocumentV1 } from '@lolly-tools/core';
import { createPinnedTextShaper } from '../packages/node-shell/src/text-fonts.ts';
import { createTextStory } from '../engine/src/text-story-document.ts';
import { prepareTextParagraph } from '../engine/src/text-paragraph.ts';
import { textBoundaries } from '../engine/src/text-source.ts';
const paths = {
  latin: 'shells/web/public/fonts/SUSE[wght].ttf',
  arabic: 'tests/fixtures/text-composition/fonts/notosansarabic/NotoSansArabic[wdth,wght].ttf',
  hebrew: 'tests/fixtures/text-composition/fonts/notosanshebrew/NotoSansHebrew[wdth,wght].ttf',
  devanagari: 'tests/fixtures/text-composition/fonts/notosansdevanagari/NotoSansDevanagari[wdth,wght].ttf',
};
const bytes = new Map(Object.entries(paths).map(([id, path]) => [id, readFileSync(path)]));
function fixture(source: string) {
  const story = createTextStory('story', source, index => `p${index}`); story.defaultStyle = 'body';
  const document: TextDocumentV1 = { version: 1, stories: [story], fonts: [...bytes].map(([id, data]) => ({ id, family: id,
    sha256: createHash('sha256').update(data).digest('hex'), faceIndex: 0, source: { kind: 'bundled', path: `/fonts/${id}.ttf` } })),
    styles: [{ id: 'body', kind: 'paragraph', name: 'Body', paragraph: { character: { font: 'latin', fallbackFonts: ['arabic', 'hebrew', 'devanagari'], size: 24, weight: 400 } } }] };
  const services = createPinnedTextShaper(async font => bytes.get(font.id)!);
  return { document, story, services };
}
test('mixed scripts retain logical source and all grapheme carets in visual run order', async () => {
  const { document, story, services } = fixture('Hello العربية 123 עִבְרִית क्षेत्र');
  const prepared = await prepareTextParagraph(document, story, story.paragraphs[0]!, services);
  const shaped = await prepared.shape({ start: 0, end: story.source.length });
  assert.deepEqual([...new Set(shaped.pieces.flatMap(piece => piece.carets.map(caret => caret.offset)))].sort((a,b) => a-b), [...textBoundaries(story.source)]);
  assert.equal([...shaped.pieces].sort((a,b)=>a.start-b.start).map(piece => story.source.slice(piece.start,piece.end)).join(''), story.source);
  assert.ok(shaped.pieces.some(piece=>piece.shape?.font.id === 'arabic' && piece.shape.direction === 'rtl'));
  assert.ok(shaped.pieces.some(piece=>piece.shape?.font.id === 'devanagari'));
  assert.ok(shaped.pieces.every((piece,i)=>i===0 || piece.x >= shaped.pieces[i-1]!.x));
  assert.deepEqual(await prepared.shape({ start: 0, end: story.source.length }), shaped);
});
test('styled Arabic runs retain joining context, and line ends shape in isolation', async () => {
  const { document, story, services } = fixture('بتب');
  story.spans = [{ start: 1, end: 2, character: { color: '#ff0000' } }];
  const prepared = await prepareTextParagraph(document, story, story.paragraphs[0]!, services);
  const whole = await prepared.shape({ start: 0, end: 3 }), single = await prepared.shape({ start: 1, end: 2 });
  const joined = whole.pieces.find(piece=>piece.start===1)!;
  assert.notDeepEqual(joined.shape?.clusters.map(cluster=>cluster.d), single.pieces[0]!.shape?.clusters.map(cluster=>cluster.d));
  assert.equal(joined.style.color, '#ff0000');
  assert.equal(joined.shape?.text, 'ت');
});
test('chosen emoji artwork is one indivisible source range with its own advance', async () => {
  const { document, story, services } = fixture('A👨‍👩‍👧‍👦B');
  const art = { start: 1, end: story.source.length-1, width: 24, ascent: 21, descent: 3,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0H1V1H0Z"/></svg>', id: 'test-family', sha256: 'a'.repeat(64) };
  const prepared = await prepareTextParagraph(document, story, story.paragraphs[0]!, services, [art]);
  const result = await prepared.shape({ start: 0, end: story.source.length });
  const piece = result.pieces.find(piece=>piece.artwork)!;
  assert.equal(piece.advance,24); assert.deepEqual(piece.carets.map(caret=>caret.offset),[art.start,art.end]);
  await assert.rejects(prepareTextParagraph(document, story, story.paragraphs[0]!, services), { code:'font-glyph' });
});
test('trailing break spaces collapse only in layout; NBSP and the original source survive', async () => {
  const { document, story, services } = fixture('A\u00a0B  ');
  const prepared = await prepareTextParagraph(document, story, story.paragraphs[0]!, services);
  const range = {start:0,end:story.source.length}, collapsed = await prepared.shape(range), literal = await prepared.shape(range,false);
  assert.ok(literal.advance > collapsed.advance);
  assert.equal(story.source,'A\u00a0B  ');
  assert.equal(collapsed.pieces.at(-1)!.carets.at(-1)!.offset, story.source.length);
});

test('display case preserves source offsets and expands capitals without splitting a source character',async()=>{
  const {document,story,services}=fixture('Straße Office');document.styles[0]!.paragraph!.character!.case='upper';
  const line=await (await prepareTextParagraph(document,story,story.paragraphs[0]!,services)).shape(story.paragraphs[0]!);
  assert.equal(story.source,'Straße Office');const clusters=line.pieces.flatMap(piece=>piece.shape?.clusters??[]);
  const sharp=clusters.filter(cluster=>cluster.start<=4&&cluster.end>4);assert.equal(sharp.length,1);assert.equal(sharp[0]!.start,4);assert.equal(sharp[0]!.end,5);
  assert.deepEqual([...new Set(line.pieces.flatMap(piece=>piece.carets.map(caret=>caret.offset)))].sort((a,b)=>a-b),[...textBoundaries(story.source)]);
  const literal=await services.shapeRun({font:document.fonts[0]!,text:'STRASSE OFFICE',start:0,direction:'ltr',script:'Latn',language:'und',size:24,axes:{wght:400}});
  assert.ok(Math.abs(line.advance-literal.advance)<.001);assert.equal(line.pieces[0]!.shape!.text,story.source);
});
