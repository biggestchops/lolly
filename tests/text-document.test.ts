// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { createTextStory, parseTextDocument, serializeTextDocument } from '../engine/src/text-story-document.ts';
import { deletionRange, snapTextRange, textBoundaries } from '../engine/src/text-source.ts';
import type { TextDocumentV1 } from '@lolly-tools/core';
const document = (source = ''): TextDocumentV1 => ({ version: 1, stories: [createTextStory('story1', source, i => `p${i}`)], styles: [], fonts: [] });
test('all separator and special-space bytes survive a canonical round trip', () => {
  for (const source of ['', '\n', '\r\n', 'a\r\nb\nc\rd\u2028e\u2029', 'NB\u00a0SP\u202fthin\u2009office', 'e\u0301 👨‍👩‍👧‍👦 🇬🇧 👩🏽‍💻', 'עברית 123 العربية', '*literal*\n']) {
    const doc = document(source); const parsed = parseTextDocument(serializeTextDocument(doc));
    assert.deepEqual(parsed, doc); assert.equal(parsed.stories[0]!.source, source);
    assert.notEqual(parsed.stories[0], doc.stories[0]);
  }
});
test('legacy newlines remain soft breaks while explicit paragraph separators keep meaning', () => {
  const story = createTextStory('story1', 'first\r\nsecond\n\u2029third', i => `p${i}`, 'soft');
  assert.equal(story.paragraphs.length, 2); assert.deepEqual(story.breaks.map(b => b.kind), ['soft', 'soft', 'paragraph']);
  assert.deepEqual(parseTextDocument({ ...document(), stories: [story] }).stories[0], story);
});
test('deletion and range snapping retain entire extended graphemes', () => {
  for (const cluster of ['e\u0301', '👨‍👩‍👧‍👦', '🇬🇧', '👩🏽‍💻', 'क्ष']) {
    const source = `A${cluster}Z`, end = 1 + cluster.length;
    assert.deepEqual(deletionRange(source, { start: end, end }, true), { start: 1, end });
    assert.deepEqual(deletionRange(source, { start: 1, end: 1 }, false), { start: 1, end });
    assert.deepEqual(snapTextRange(source, { start: 2, end: 2 }), { start: end, end });
    assert.deepEqual(snapTextRange(source, { start: 2, end: 2 }, 'upstream'), { start: 1, end: 1 });
  }
});
test('malformed boundaries, broken graphs and impossible style ranges are refused', () => {
  const rejects = (change: (doc: TextDocumentV1) => void, pattern: RegExp) => { const doc = document('A😀\nB'); change(doc); assert.throws(() => parseTextDocument(doc), pattern); };
  rejects(doc => doc.stories[0]!.spans.push({ start: 2, end: 3, noBreak: true }), /complete character/);
  rejects(doc => doc.stories[0]!.breaks = [], /break record/);
  rejects(doc => doc.stories[0]!.paragraphs[1]!.start = 0, /Paragraph boundaries/);
  rejects(doc => doc.stories[0]!.paragraphs[1]!.id = 'p0', /Duplicate paragraph/);
  rejects(doc => doc.stories[0]!.frameIds = ['f1', 'f1'], /belongs to more/);
  rejects(doc => doc.stories[0]!.defaultStyle = 'missing', /Missing text style/);
  rejects(doc => doc.styles.push({ id: 'a', name: 'a', kind: 'paragraph', basedOn: 'b' }, { id: 'b', name: 'b', kind: 'paragraph', basedOn: 'a' }), /acyclic/);
  rejects(doc => doc.stories[0]!.spans.push({ start: 0, end: 3 }, { start: 1, end: 3 }), /nonoverlapping/);
  rejects(doc => doc.stories[0]!.paragraphs[0]!.paragraph = { wordSpacing: { min: 2, ideal: 1, max: 3 } }, /Word spacing/);
  rejects(doc => doc.stories[0]!.paragraphs[0]!.paragraph = { character: { size: Number.NaN } }, /must be number/);
  assert.throws(() => document('\ud800'), /valid Unicode/);
  assert.throws(() => document('a'.repeat(65537)), /supported length/);
});
test('font dependencies are content pinned and remain inside published roots', () => {
  const doc = document('Hello');
  doc.fonts.push({ id: 'font1', family: 'Example', sha256: 'a'.repeat(64), faceIndex: 0, source: { kind: 'bundled', path: '/fonts/Example.ttf' } });
  doc.stories[0]!.spans.push({ start: 0, end: 5, character: { font: 'font1' } });
  assert.deepEqual(parseTextDocument(doc), doc);
  doc.fonts[0]!.source = { kind: 'bundled', path: '/fonts/%2e%2e/private.ttf' };
  assert.throws(() => parseTextDocument(doc), /published asset root/);
});
test('bounds are linear over hostile repeated graphemes', () => {
  const source = 'a\u0301'.repeat(32768); const start = performance.now();
  assert.equal(textBoundaries(source).size, 32769);
  assert.ok(performance.now() - start < 1000);
});
