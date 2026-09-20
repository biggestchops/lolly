// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { createTextStory, parseTextDocument } from '../engine/src/text-story-document.ts';
import { formatStoryParagraphs, formatStoryRange, replaceStoryRange, storyParagraphIds } from '../engine/src/text-edits.ts';
import { textBoundaries } from '../engine/src/text-source.ts';
import type { TextStoryV1 } from '@lolly-tools/core';
let next = 0;
const opts = () => ({ paragraphId: () => `added${++next}` });
const valid = (story: TextStoryV1): void => { parseTextDocument({ version: 1, stories: [story], styles: [], fonts: [] }); };
const story = (source: string): TextStoryV1 => createTextStory('story1', source, i => `p${i}`);
test('paragraph and soft-break edits preserve source and stable unaffected paragraph ids', () => {
  const initial = story('First\nSecond\nThird'); const saved = JSON.stringify(initial);
  const split = replaceStoryRange(initial, { start: 2, end: 2 }, { source: '\n' }, opts());
  assert.equal(split.story.source, 'Fi\nrst\nSecond\nThird');
  assert.equal(split.story.paragraphs[0]!.id, 'p0');
  assert.deepEqual(split.story.paragraphs.slice(2).map(p => p.id), ['p1', 'p2']);
  assert.equal(JSON.stringify(initial), saved); valid(split.story);
  const soft = replaceStoryRange(initial, { start: 2, end: 2 }, { source: '\u2028' }, opts());
  assert.equal(soft.story.paragraphs.length, 3); valid(soft.story);
  const joined = replaceStoryRange(initial, { start: 5, end: 6 }, { source: '' }, opts());
  assert.equal(joined.story.source, 'FirstSecond\nThird');
  assert.deepEqual(joined.story.paragraphs.map(p => p.id), ['p0', 'p2']); valid(joined.story);
});
test('typing into styled text extends the style without splitting newly joined graphemes', () => {
  const initial = formatStoryRange(story('ab'), { start: 0, end: 1 }, { character: { weight: 700 } });
  const edit = replaceStoryRange(initial, { start: 1, end: 1 }, { source: '\u0301' }, opts());
  assert.equal(edit.story.source, 'a\u0301b');
  assert.deepEqual(edit.story.spans, [{ start: 0, end: 2, character: { weight: 700 } }]);
  assert.deepEqual(edit.selection, { start: 2, end: 2 }); valid(edit.story);
});
test('formatting a subrange merges overrides and resetting restores inherited values', () => {
  let text = formatStoryRange(story('one two three'), { start: 0, end: 13 }, { character: { size: 24, color: '#123456' } });
  text = formatStoryRange(text, { start: 4, end: 7 }, { character: { weight: 700 }, noBreak: true });
  assert.equal(text.spans.length, 3); assert.equal(text.spans[1]!.character!.size, 24);
  text = formatStoryRange(text, { start: 4, end: 7 }, { character: { weight: null }, noBreak: null });
  assert.deepEqual(text.spans, [{ start: 0, end: 13, character: { size: 24, color: '#123456' } }]); valid(text);
});
test('paragraph scope excludes the paragraph starting at the selection end', () => {
  const text = story('one\ntwo\nthree');
  assert.deepEqual(storyParagraphIds(text, { start: 0, end: 4 }), ['p0']);
  assert.deepEqual(storyParagraphIds(text, { start: 4, end: 4 }), ['p1']);
  const changed = formatStoryParagraphs(text, ['p1'], { composition: 'balanced' });
  assert.deepEqual(changed.paragraphs[1]!.paragraph, { composition: 'balanced' });
  assert.equal(changed.paragraphs[0], text.paragraphs[0]); valid(changed);
});
test('joining a CR and LF creates one separator without losing a source unit', () => {
  const changed = replaceStoryRange(story('one\rX\ntwo'), { start: 4, end: 5 }, { source: '' }, opts()).story;
  assert.equal(changed.source, 'one\r\ntwo');
  assert.deepEqual(changed.breaks, [{ start: 3, length: 2, kind: 'paragraph' }]); valid(changed);
});
test('seeded mixed-script edits remain admitted and exactly source preserving', () => {
  let seed = 0x271, text = story('A😀\nעברית e\u0301 العربية\r\nक्ष');
  const random = (max: number): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  const insertions = ['', 'a', '👩🏽‍💻', '\u0301', '\n', '\r', '\u2028', 'אב', 'क्ष', '\u00a0'];
  for (let i = 0; i < 800; i++) {
    const boundaries = [...textBoundaries(text.source)];
    const a = boundaries[random(boundaries.length)]!, b = boundaries[random(boundaries.length)]!;
    const range = { start: Math.min(a, b), end: Math.max(a, b) };
    const insert = insertions[random(insertions.length)]!;
    const expected = text.source.slice(0, range.start) + insert + text.source.slice(range.end);
    text = replaceStoryRange(text, range, { source: insert }, opts()).story;
    assert.equal(text.source, expected); valid(text);
    if (text.source) text = formatStoryRange(text, { start: 0, end: text.source.length }, { character: { size: 12 + random(36) } });
    valid(text);
  }
});
