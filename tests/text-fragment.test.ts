// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import type { TextDocumentV1 } from '@lolly-tools/core';
import { createTextStory, parseTextDocument } from '../engine/src/text-story-document.ts';
import { importTextFragment, sliceTextDocument } from '../engine/src/text-fragment.ts';
import { replaceStoryRange } from '../engine/src/text-edits.ts';
import { textStyleResolver } from '../engine/src/text-styles.ts';
function fixture(): TextDocumentV1 {
  const story = createTextStory('story', 'A\u00a0e\u0301 👨‍👩‍👧‍👦\r\nSecond\u2028line\n', index => `p${index}`);
  story.defaultStyle = 'body'; story.frameIds = ['frame'];
  story.spans = [{ start: 2, end: 4, style: 'accent', noBreak: true }];
  story.paragraphs[1]!.paragraph = { align: 'center', spaceBefore: 12 };
  return { version: 1, stories: [story], fonts: [{ id: 'font', family: 'Test', sha256: 'a'.repeat(64), faceIndex: 0, source: { kind: 'bundled', path: '/fonts/test.ttf' } }],
    styles: [{ id: 'body', name: 'Body', kind: 'paragraph', paragraph: { character: { font: 'font', size: 32 } } }, { id: 'accent', name: 'Accent', kind: 'character', character: { weight: 700, color: '#e03050' } }] };
}
test('rich fragments preserve source, typed breaks and resolved styles across conflicting documents', () => {
  const source = fixture(), story = source.stories[0]!, frozen = JSON.stringify(source);
  const fragment = sliceTextDocument(source, story, { start: 2, end: story.source.length });
  assert.equal(fragment.stories[0]!.source, story.source.slice(2)); assert.deepEqual(fragment.styles, []);
  const target = fixture(); target.stories = [createTextStory('target', 'Before\n', index => `dest${index}`)]; target.fonts[0]!.sha256 = 'b'.repeat(64);
  const imported = importTextFragment(target, fragment, () => 'new-inline');
  const next = replaceStoryRange(target.stories[0]!, { start: 7, end: 7 }, imported.insertion, { paragraphId: () => crypto.randomUUID() }).story;
  imported.document.stories = [next]; parseTextDocument(imported.document);
  assert.equal(next.source, 'Before\n' + story.source.slice(2));
  assert.equal(next.spans[0]!.noBreak, true);
  const resolve = textStyleResolver(imported.document), style = resolve.character(next, next.paragraphs[1]!, 7);
  assert.equal(style.weight, 700); assert.equal(style.color, '#e03050');
  assert.notEqual(style.font, 'font'); assert.equal(imported.document.fonts.find(font => font.id === style.font)!.sha256, 'a'.repeat(64));
  assert.equal(resolve.paragraph(next, next.paragraphs[2]!).align, 'center');
  assert.equal(next.breaks.find(item => next.source.slice(item.start, item.start + item.length) === '\u2028')!.kind, 'soft');
  assert.equal(JSON.stringify(source), frozen);
});
test('a pasted inline receives an independent identity and complete artwork', () => {
  const doc = fixture(), story = createTextStory('symbols', '\ufffc', () => 'p');
  story.inlines = [{ id: 'old', offset: 0, label: 'Symbol', originalText: '😀', svg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0H1V1Z"/></svg>', width: 32, ascent: 28, descent: 4 }];
  doc.stories = [story];
  const imported = importTextFragment(fixture(), doc, () => 'new');
  assert.equal(imported.insertion.inlines![0]!.id, 'new'); assert.equal(imported.insertion.inlines![0]!.svg, story.inlines[0]!.svg);
  assert.throws(() => sliceTextDocument(fixture(), fixture().stories[0]!, { start: 3, end: 4 }), /boundaries/);
});
