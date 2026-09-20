// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { TextLayoutRequestV1 } from '@lolly-tools/core';
import { createPinnedTextShaper } from '../packages/node-shell/src/text-fonts.ts';
import { createTextStory } from '../engine/src/text-story-document.ts';
import { replaceStoryRange } from '../engine/src/text-edits.ts';
import { composeText } from '../engine/src/text-layout.ts';
import { createTextCompositionCache } from '../engine/src/text-composition-cache.ts';
const bytes = readFileSync('shells/web/public/fonts/SUSE[wght].ttf');
function fixture(): TextLayoutRequestV1 {
  const story = createTextStory('story', ['First paragraph with exact source and enough words to wrap.', 'Second paragraph has a different length and an office ligature.', 'Last paragraph gets edited at its end.'].join('\r\n'), i => `p${i}`);
  story.frameIds = ['a', 'b', 'c']; story.defaultStyle = 'body';
  return { storyId: story.id, document: { version: 1, stories: [story], fonts: [{ id: 'font', family: 'SUSE', faceIndex: 0, sha256: createHash('sha256').update(bytes).digest('hex'), source: { kind: 'bundled', path: '/fonts/SUSE[wght].ttf' } }], styles: [{ id: 'body', name: 'Body', kind: 'paragraph', paragraph: { character: { font: 'font', size: 20 }, lineHeight: 1.2 } }] }, frames: story.frameIds.map(id => ({ id, storyId: story.id, width: 220, height: 200, mode: 'fixed', inset: { top: 8, right: 8, bottom: 8, left: 8 }, columns: { count: 1, gutter: 12, balance: false }, verticalAlign: 'top' })) };
}
function edit(request: TextLayoutRequestV1, start: number, end: number, source: string): void {
  request.document.stories[0] = replaceStoryRange(request.document.stories[0]!, { start, end }, { source }, { paragraphId: () => `new-${start}` }).story;
}
test('incremental composition reuses settled paragraphs without exposing mutable results', async () => {
  const request = fixture(), cache = createTextCompositionCache(), base = createPinnedTextShaper(async () => bytes), cold = createPinnedTextShaper(async () => bytes);
  const shaped: number[] = [], services = { ...base, shapeRun: async (value: Parameters<typeof base.shapeRun>[0]) => { shaped.push(value.start); return base.shapeRun(value); } };
  const first = await composeText(request, services, cache); assert.deepEqual(first, await composeText(request, cold));
  const story = request.document.stories[0]!, affected = story.paragraphs[2]!.start;
  shaped.length = 0; edit(request, story.source.length - 1, story.source.length, '!');
  const next = await composeText(request, services, cache); assert.deepEqual(next, await composeText(request, cold));
  assert.ok(shaped.length > 0); assert.ok(shaped.every(at => at >= affected), JSON.stringify(shaped));
  next.lines[0]!.x = -999; next.lines[0]!.carets[0]!.x = -999; next.resources.length = 0;
  assert.deepEqual(await composeText(request, services, cache), await composeText(request, cold));
  cache.clear(); assert.deepEqual(await composeText(request, services, cache), await composeText(request, cold));
});
test('cache invalidates exact dependencies for edits, geometry, keep rules, wrapping and font style', async () => {
  const request = fixture(), cache = createTextCompositionCache(), services = createPinnedTextShaper(async () => bytes), cold = createPinnedTextShaper(async () => bytes);
  const compare = async () => assert.deepEqual(await composeText(request, services, cache), await composeText(request, cold));
  await compare();
  request.wrap = { placements: request.frames.map(frame => ({ id: frame.id, scope: 'page', x: 0, y: 0, width: frame.width, height: frame.height, rotation: 0 })), objects: [{ id: 'image', scope: 'page', x: 0, y: 35, width: 65, height: 60, rotation: 0, mode: 'box', offset: { top: 4, right: 4, bottom: 4, left: 4 }, geometry: { kind: 'rect' } }] }; await compare();
  request.wrap.objects[0]!.x = 140; await compare();
  delete request.wrap; await compare();
  request.document.stories[0]!.paragraphs[1]!.paragraph = { keep: { startLines: 1, endLines: 2, nextLines: 2, together: true } }; await compare();
  const last = request.document.stories[0]!.paragraphs[2]!; edit(request, last.start, last.end, 'New material with more words. '.repeat(12)); await compare();
  request.frames[1]!.width = 170; await compare();
  request.frames.forEach(frame => { frame.verticalAlign = 'bottom'; frame.height = 420; }); await compare();
  request.frames[2]!.columns = { count: 2, gutter: 16, balance: true }; await compare();
  request.document.styles[0]!.paragraph!.character!.axes = { wght: 650 }; await compare();
  request.document.stories[0]!.spans = [{ start: 0, end: 5, character: { size: 30, color: '#226677' } }]; await compare();
  edit(request, 0, 2, 'A longer first phrase'); await compare();
  request.frames.forEach(frame => { frame.height = 45; }); await compare();
  request.frames[0]!.hidden = true; request.frames[1]!.locked = true; await compare();
});
