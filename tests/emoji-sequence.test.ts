// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { emojiSequenceKey, lookupEmojiSequence, usesTextPresentation, isCanonicalEmojiKey } from '../engine/src/emoji-sequence.ts';

test('generated lookup recognizes every official Emoji 17.0 row and preserves qualification', async () => {
  const source = await readFile(new URL('../scripts/data/unicode/17.0/emoji-test.txt', import.meta.url), 'utf8');
  let canonical = 0, aliases = 0;
  for (const row of source.split('\n')) {
    const match = /^([0-9A-F ]+)\s*;\s*([a-z-]+)\s*#\s*\S+\s+E[0-9.]+\s+(.+)$/.exec(row);
    if (!match) continue;
    const points = match[1]!.trim().split(/\s+/).map(point => Number.parseInt(point, 16));
    const text = String.fromCodePoint(...points);
    const entry = lookupEmojiSequence(text);
    assert.ok(entry, match[1]!);
    assert.equal(entry.label, match[3]);
    assert.equal(entry.key.split('-').filter(point => point !== 'fe0f').join('-'), points.filter(point => point !== 0xfe0f).map(point => point.toString(16).padStart(4, '0')).join('-'));
    assert.equal(entry.alias, !['fully-qualified', 'component'].includes(match[2]!));
    assert.ok(isCanonicalEmojiKey(entry.key));
    if (entry.alias) aliases++; else canonical++;
  }
  assert.deepEqual({ canonical, aliases }, { canonical: 3953, aliases: 1272 });
});

test('selectors and text-default symbols retain the requested presentation', () => {
  assert.equal(usesTextPresentation('\u2764'), true);
  assert.equal(usesTextPresentation('\u2764', 'emoji'), false);
  assert.equal(usesTextPresentation('\u2764\ufe0f'), false);
  assert.equal(usesTextPresentation('\u2764\ufe0e', 'emoji'), true);
  assert.equal(usesTextPresentation('\u00a9'), true);
  assert.equal(lookupEmojiSequence('\u2764')?.key, '2764-fe0f');
  assert.equal(lookupEmojiSequence('1\u20e3')?.key, '0031-fe0f-20e3');
  assert.equal(usesTextPresentation('1\u20e3'), false);
  assert.equal(usesTextPresentation('A\ufe0e'), false);
});

test('whole joined, modifier, regional and tag sequences never degrade to a prefix', () => {
  for (const points of [
    [0x1f469, 0x1f3fd, 0x200d, 0x1f4bb],
    [0x1f1ec, 0x1f1e7],
    [0x1f3f4, 0xe0067, 0xe0062, 0xe0065, 0xe006e, 0xe0067, 0xe007f],
  ]) {
    const text = String.fromCodePoint(...points);
    assert.ok(lookupEmojiSequence(text));
    assert.equal(lookupEmojiSequence(`${text}\u200d`), null);
  }
  for (const text of ['', '\ud800', '\udc00', '\ud800x', 'a'.repeat(65)]) assert.equal(emojiSequenceKey(text), null);
  assert.equal(emojiSequenceKey('\u0023\ufe0f\u20e3'), '0023-fe0f-20e3');
  assert.equal(lookupEmojiSequence('\u{1f600}\u{1f3fd}'), null);
  assert.equal(lookupEmojiSequence('\u{1f600}\u{1f600}'), null);
  assert.equal(isCanonicalEmojiKey('D800'), false);
  const detached = lookupEmojiSequence('\u{1f600}')!;
  detached.key = 'bad';
  assert.equal(lookupEmojiSequence('\u{1f600}')?.key, '1f600');
});

test('pinned data and notices regenerate byte for byte without networking', () => {
  execFileSync(process.execPath, ['scripts/build-emoji-data.ts', '--check'], { cwd: new URL('../', import.meta.url), stdio: 'pipe' });
});
