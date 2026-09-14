// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { emojiGraphemes, segmentEmojiText, requiresEmojiBidiLayout, EMOJI_TEXT_MAX_UNITS } from '../engine/src/emoji-segment.ts';

test('pinned UAX29 segmenter passes every Unicode 17 grapheme conformance row', async () => {
  const source = await readFile(new URL('../scripts/data/unicode/17.0/GraphemeBreakTest.txt', import.meta.url), 'utf8');
  let count = 0;
  for (const line of source.split('\n')) {
    const input = line.split('#')[0]!.trim();
    if (!input) continue;
    const expected: string[] = [];
    let cluster = '';
    for (const token of input.split(/\s+/)) {
      if (token === '÷') { if (cluster) expected.push(cluster); cluster = ''; }
      else if (token !== '×') cluster += String.fromCodePoint(Number.parseInt(token, 16));
    }
    const text = expected.join('');
    const actual = emojiGraphemes(text);
    assert.deepEqual(actual.map(span => span.text), expected, line);
    for (const span of actual) assert.equal(text.slice(span.start, span.end), span.text);
    count++;
  }
  assert.ok(count > 700, `Only ${count} conformance rows tested`);
});

test('each official emoji row remains one complete cluster inside text', async () => {
  const source = await readFile(new URL('../scripts/data/unicode/17.0/emoji-test.txt', import.meta.url), 'utf8');
  for (const line of source.split('\n')) {
    const hex = line.split('#')[0]!.split(';')[0]!.trim();
    if (!hex) continue;
    const value = String.fromCodePoint(...hex.split(/\s+/).map(point => Number.parseInt(point, 16)));
    assert.deepEqual(emojiGraphemes(value).map(span => span.text), [value], line);
    // Standalone skin-tone components extend the preceding grapheme under UAX29.
    if (line.includes('; component')) continue;
    assert.deepEqual(emojiGraphemes(`a ${value} b`).map(span => span.text), ['a', ' ', value, ' ', 'b'], line);
  }
});

test('mixed spans preserve selectors, source offsets and unsupported joined sequences', () => {
  const text = 'Hi 😀 © ♥︎ ♥️ 1️⃣ 😀\u200d😀 end';
  const spans = segmentEmojiText(text);
  assert.deepEqual(spans.map(({ kind, text }) => [kind, text]), [
    ['text', 'Hi '], ['emoji', '😀'], ['text', ' © ♥︎ '], ['emoji', '♥️'],
    ['text', ' '], ['emoji', '1️⃣'], ['text', ' '], ['unsupported', '😀\u200d😀'], ['text', ' end'],
  ]);
  for (const span of spans) assert.equal(text.slice(span.start, span.end), span.text);
  assert.deepEqual(segmentEmojiText('012#*').map(span => span.kind), ['text']);
  assert.equal(segmentEmojiText('😀\u0301')[0]?.kind, 'unsupported');
  assert.equal(segmentEmojiText('🇦')[0]?.kind, 'unsupported');
  assert.deepEqual(emojiGraphemes(''), []);
  assert.throws(() => emojiGraphemes('\ud800'), /surrogate/);
  assert.throws(() => emojiGraphemes('a'.repeat(EMOJI_TEXT_MAX_UNITS + 1)), /length/);
  for (const text of ['مرحبا', 'שלום', '\u2066a\u2069', 'a\nb', 'a\tb']) assert.equal(requiresEmojiBidiLayout(text), true);
  assert.equal(requiresEmojiBidiLayout('\u05ff'), true, 'Unassigned RTL code points retain UCD default bidi classes');
  assert.equal(requiresEmojiBidiLayout('\u0610'), false, 'An explicit NSM row overrides the surrounding AL default');
  assert.equal(requiresEmojiBidiLayout('A 😀 12.3'), false);
});

test('pinned text tables regenerate without network or source drift', () => {
  execFileSync(process.execPath, ['scripts/build-emoji-text-data.ts', '--check'], { cwd: new URL('../', import.meta.url) });
});
