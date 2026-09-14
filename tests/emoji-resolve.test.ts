// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveEmoji } from '../engine/src/emoji-resolve.ts';
import { readEmojiStyle, withEmojiStyle } from '../engine/src/emoji-style.ts';
import { fixture, admit, style } from './helpers/emoji-fixtures.ts';

const grinning = { kind: 'unicode', text: '\u{1f600}' } as const;

test('new emoji needs an explicit choice; installed sets never seed it', async () => {
  const { pack, lock } = await fixture();
  const unselected = resolveEmoji(grinning, undefined, [pack]);
  assert.equal(unselected.status, 'unresolved');
  if (unselected.status === 'unresolved') assert.equal(unselected.issue.code, 'selection-required');
  const selected = resolveEmoji(grinning, style(lock.pin), [pack]);
  assert.equal(selected.status, 'resolved');
  if (selected.status === 'resolved') {
    assert.equal(selected.value.glyph.source.license, 'CC-BY-4.0');
    assert.equal(selected.value.usedFallback, false);
    assert.deepEqual(selected.value.pack, lock.pin);
  }
});

test('saved styles replay independently of registry order or newer installed releases', async () => {
  const { pack, lock, manifest } = await fixture();
  const other = await fixture('openmoji');
  const newer = structuredClone(manifest); newer.version = '99.0';
  const installed = await admit(newer);
  const saved = style(lock.pin);
  const expected = resolveEmoji(grinning, saved, [pack]);
  assert.deepEqual(resolveEmoji(grinning, saved, [other.pack, installed.pack, pack]), expected);
  assert.deepEqual(resolveEmoji(grinning, JSON.parse(JSON.stringify(saved)), [pack, installed.pack, other.pack]), expected);
  const missing = resolveEmoji(grinning, saved, [installed.pack, other.pack]);
  assert.equal(missing.status, 'unresolved');
  if (missing.status === 'unresolved') assert.equal(missing.issue.code, 'pack-unavailable');
});

test('only a proven coverage gap can use an explicitly ordered fallback', async () => {
  const primary = await fixture('openmoji'), fallback = await fixture();
  const custom = structuredClone(primary.manifest);
  custom.glyphs[0]!.meaning = { kind: 'custom', id: 'user/ds/example/emoji/mascot' };
  const admitted = await admit(custom);
  const selected = style(admitted.pin, [fallback.lock.pin]);
  const chosen = resolveEmoji(grinning, selected, [admitted.pack, fallback.pack]);
  assert.equal(chosen.status, 'resolved');
  if (chosen.status === 'resolved') {
    assert.equal(chosen.value.usedFallback, true);
    assert.equal(chosen.value.pack.id, fallback.lock.pin.id);
  }
  const missing = resolveEmoji(grinning, selected, [fallback.pack]);
  assert.equal(missing.status, 'unresolved');
  if (missing.status === 'unresolved') assert.equal(missing.issue.code, 'pack-unavailable');
  const unselectedFallback = resolveEmoji(grinning, style(admitted.pin), [admitted.pack, fallback.pack]);
  assert.equal(unselectedFallback.status, 'unresolved');
  if (unselectedFallback.status === 'unresolved') assert.equal(unselectedFallback.issue.code, 'glyph-unavailable');
  const mascot = resolveEmoji({ kind: 'custom', id: 'user/ds/example/emoji/mascot', label: 'Example mascot' }, selected, [admitted.pack]);
  assert.equal(mascot.status, 'resolved');
  if (mascot.status === 'resolved') assert.equal(mascot.value.meaning.kind, 'custom');
});

test('unsupported sequences retain all their modifiers and joiners instead of resolving parts', async () => {
  const { pack, lock } = await fixture();
  for (const text of ['\u{1f600}\u200d', '\u{1f600}\u{1f3fd}', '\u{1f600}\u{1f600}']) {
    const result = resolveEmoji({ kind: 'unicode', text }, style(lock.pin), [pack]);
    assert.equal(result.status, 'unresolved');
    if (result.status === 'unresolved') assert.equal(result.issue.code, 'unsupported-sequence');
  }
  // A supported but absent person/skin-tone sequence is a coverage gap, not a simpler face.
  const absent = resolveEmoji({ kind: 'unicode', text: '\u{1f469}\u{1f3fd}\u200d\u{1f4bb}' }, style(lock.pin), [pack]);
  assert.equal(absent.status, 'unresolved');
  if (absent.status === 'unresolved') assert.equal(absent.issue.code, 'glyph-unavailable');
});

test('explicit text presentation does not need an emoji family', () => {
  for (const text of ['\u00a9', '\u2764', '\u2764\ufe0e']) assert.deepEqual(resolveEmoji({ kind: 'unicode', text }, null, []), { status: 'text', text });
  assert.equal(resolveEmoji({ kind: 'unicode', text: '\u2764', presentation: 'emoji' }, null, []).status, 'unresolved');
  assert.equal(resolveEmoji({ kind: 'unicode', text: '\ud800' }, null, []).status, 'unresolved');
  assert.equal(resolveEmoji({ kind: 'custom', id: 'user/ds/example/emoji/mascot', label: '' }, null, []).status, 'unresolved');
});

test('DTCG emoji typography round-trips while preserving other fonts and extensions', async () => {
  const { lock } = await fixture();
  const doc = { type: { primary: { $type: 'fontFamily', $value: 'Example' } }, $extensions: { elsewhere: { keep: true }, 'com.suse.lolly': { future: { v: 9 } } } };
  const before = structuredClone(doc);
  const selected = style(lock.pin);
  const authored = withEmojiStyle(doc, selected);
  assert.deepEqual(doc, before);
  assert.deepEqual(readEmojiStyle(JSON.parse(JSON.stringify(authored))), { status: 'selected', style: selected });
  assert.deepEqual(withEmojiStyle(authored, null), before);
  assert.deepEqual(withEmojiStyle(withEmojiStyle({}, selected), null), {});
  assert.deepEqual(readEmojiStyle(doc), { status: 'unselected' });
  const invalid = structuredClone(authored);
  Object.assign((invalid.$extensions as Record<string, unknown>)['com.suse.lolly'] as object, { emoji: { ...selected, treatment: { mode: 'snap' } } });
  assert.equal(readEmojiStyle(invalid).status, 'invalid');
  assert.equal(readEmojiStyle({ $extensions: { 'com.suse.lolly': [] } }).status, 'invalid');
});

test('unknown recipes, duplicate fallbacks and floating pins cannot silently become original artwork', async () => {
  const { pack, lock } = await fixture();
  for (const selection of [
    { ...style(lock.pin), treatment: { mode: 'snap' } },
    style(lock.pin, [lock.pin]),
    style({ ...lock.pin, pin: { version: 'latest' } }),
    { ...style(lock.pin), metricsPolicy: 'from-os' },
  ]) {
    const result = resolveEmoji(grinning, selection as ReturnType<typeof style>, [pack]);
    assert.equal(result.status, 'unresolved');
    if (result.status === 'unresolved') assert.equal(result.issue.code, 'invalid-style');
  }
});
