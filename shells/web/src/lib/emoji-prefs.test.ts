// SPDX-License-Identifier: MPL-2.0
/**
 * The saved emoji preference - lib/emoji-prefs.ts.
 *
 * The seeding ORDER is the contract worth pinning: a link names a document, so
 * it must beat a device preference or a recipient would see different artwork
 * from the sender; a saved session names one too, which is why reopening old
 * work never silently redraws it in today's preference.
 *
 * Run directly:  node --test shells/web/src/lib/emoji-prefs.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { EmojiPreferenceV1, EmojiStyleV1 } from '@lolly-tools/core/emoji-v1';
import {
  currentEmojiPreference, emojiPreferenceFromStyle, emojiPreferenceParams, emojiSeedParams,
  readEmojiPreference, setEmojiPreference, writeEmojiParams, type EmojiPrefsHost,
} from './emoji-prefs.ts';
import { parseEmojiParams } from '../../../../engine/src/emoji-style.ts';

const PIN = { id: 'community/emoji/twemoji/color-starter', pin: { version: '17.0.3' }, checksum: `sha256:${'a'.repeat(64)}` };
const PREF: EmojiPreferenceV1 = { pin: PIN, mode: 'influence', strengthBps: 2500 };

/** A profile store that records what was written, like the real bridge does. */
function fakeHost(profile: Record<string, unknown> = {}): EmojiPrefsHost & { saved: Record<string, unknown>[] } {
  const saved: Record<string, unknown>[] = [];
  return {
    saved,
    profile: {
      get: async () => profile,
      set: async (next: object) => { saved.push(next as Record<string, unknown>); return next; },
    },
  };
}

test('readEmojiPreference is total over a profile written by another build', () => {
  assert.deepEqual(readEmojiPreference(PREF), PREF);
  assert.equal(readEmojiPreference(undefined), null);
  assert.equal(readEmojiPreference('twemoji'), null);
  assert.equal(readEmojiPreference({ pin: PIN }), null, 'a preference with no mode names no treatment');
  assert.equal(readEmojiPreference({ pin: { id: 'x' }, mode: 'snap' }), null, 'a pin with no version or checksum is not a pin');
  assert.equal(readEmojiPreference({ pin: PIN, mode: 'kaleidoscope', strengthBps: 1 }), null, 'an unsupported mode is refused, never coerced');
  assert.equal(readEmojiPreference({ pin: PIN, mode: 'snap', strengthBps: -4 })!.strengthBps, 10000, 'a nonsense strength falls back to full');
});

test('a preference round-trips through the profile', async () => {
  const host = fakeHost({ name: 'Andy' });
  await setEmojiPreference(host, PREF);
  assert.deepEqual(host.saved.at(-1), { name: 'Andy', emoji: PREF }, 'the rest of the profile is carried, not replaced');
  assert.deepEqual(await currentEmojiPreference(fakeHost({ emoji: PREF })), PREF);
  assert.equal(await currentEmojiPreference(fakeHost({})), null);
});

test('clearing the preference removes the key rather than storing a null', async () => {
  const host = fakeHost({ emoji: PREF, name: 'Andy' });
  await setEmojiPreference(host, null);
  assert.deepEqual(host.saved.at(-1), { name: 'Andy' });
});

test('a host that cannot save is never a reason to fail', async () => {
  const host: EmojiPrefsHost = { profile: { get: async () => { throw new Error('no profile'); } } };
  await setEmojiPreference(host, PREF);
  assert.equal(await currentEmojiPreference(host), null);
});

test('a style reduces to the preference it amounts to, with no colours', () => {
  const style: EmojiStyleV1 = {
    schemaVersion: 1,
    primary: PIN,
    fallbacks: [],
    metricsPolicy: 'inline-em-v1',
    treatment: { mode: 'mono', strengthBps: 10000, palette: [{ id: '{color.brand.accent}', hex: '#30ba78' }], recipe: 'emoji-treatment-v1' },
  };
  const pref = emojiPreferenceFromStyle(style)!;
  assert.deepEqual(Object.keys(pref).sort(), ['mode', 'pin', 'strengthBps']);
  assert.equal(pref.mode, 'mono');
  assert.equal(emojiPreferenceFromStyle(null), null);
});

test('a preference spells itself as the two reserved params, without its checksum', () => {
  assert.deepEqual(emojiPreferenceParams(PREF), { emoji: 'community/emoji/twemoji/color-starter@17.0.3', emojifx: 'influence:2500' });
  assert.deepEqual(emojiPreferenceParams({ pin: PIN, mode: 'snap', strengthBps: 10000 })!.emojifx, 'snap');
  assert.equal(emojiPreferenceParams(null), null);
});

test('the seed order is link, then session, then preference, then nothing', () => {
  const url = { emoji: 'openmoji/color@17.0.0', emojifx: 'mono' };
  const session = { emoji: 'twemoji/color-starter@17.0.3', emojifx: 'snap' };
  assert.deepEqual(emojiSeedParams({ url, session, preference: PREF }), url);
  assert.deepEqual(emojiSeedParams({ session, preference: PREF }), session);
  assert.deepEqual(emojiSeedParams({ preference: PREF }), emojiPreferenceParams(PREF));
  assert.equal(emojiSeedParams({}), null);
  assert.deepEqual(emojiSeedParams({ url: { emoji: '  ', emojifx: 'mono' }, session }), session, 'a blank set names nothing and does not shadow the session');
});

test('writing the params sets both, and clearing removes both', () => {
  const params = new URLSearchParams('title=hello');
  writeEmojiParams(params, { emoji: 'twemoji/color-starter@17.0.3', emojifx: 'mono' });
  assert.equal(params.get('emoji'), 'twemoji/color-starter@17.0.3');
  assert.equal(params.get('emojifx'), 'mono');
  writeEmojiParams(params, { emoji: 'twemoji/color-starter@17.0.3', emojifx: '' });
  assert.equal(params.get('emojifx'), null, 'no treatment writes no treatment param');
  writeEmojiParams(params, null);
  assert.equal(params.get('emoji'), null);
  assert.equal(params.get('emojifx'), null);
  assert.equal(params.get('title'), 'hello', 'nothing else in the query is touched');
});

test('every preference the reader admits serialises to a param the parser accepts', () => {
  // The round trip is the contract: whatever comes off a stored profile has to
  // survive being written as `emojifx` and read back by the engine's parser.
  const pin = { id: 'community/emoji/twemoji/color-starter', pin: { version: '17.0.3' }, checksum: `sha256:${'b'.repeat(64)}` };
  const palette = [{ id: '{color.brand.primary}', hex: '#0c322c' }, { id: '{color.neutral.paper}', hex: '#f2f2f2' }];
  const sets = [{ pin }];
  for (const mode of ['original', 'influence', 'snap', 'mono', 'duotone']) {
    for (const strengthBps of [0, 1, 2500, 6500, 9999, 10000]) {
      const pref = readEmojiPreference({ pin, mode, strengthBps });
      assert.ok(pref, `${mode} ${strengthBps} reads back`);
      const params = emojiPreferenceParams(pref);
      assert.ok(params);
      const parsed = parseEmojiParams(params, sets, palette);
      assert.ok(parsed.pin, `${mode} ${strengthBps} names its set`);
      assert.deepEqual(parsed.issues, [], `${mode} ${strengthBps} parses with no issue`);
      assert.equal(parsed.treatment?.mode, mode === 'influence' ? 'influence' : mode);
    }
  }
});
