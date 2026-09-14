// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HostV1 } from '@lolly-tools/core/host-v1';
import type { Runtime } from '../../../../engine/src/runtime.ts';
import type { EmojiStyleV1 } from '@lolly-tools/core/emoji-v1';
import { seedEmojiRuntime, queryWithEmoji } from './emoji-runtime-style.ts';

const pin = { id: 'test/color', pin: { version: '1.0.0' }, checksum: `sha256:${'a'.repeat(64)}` };
test('embedded source seeding honors its link and preserves that set in the re-applied URL', async () => {
  let style: EmojiStyleV1 | null = null;
  const runtime = { setEmojiStyle: async (next: EmojiStyleV1) => { style = next; } } as unknown as Runtime;
  const host = {
    emoji: { sets: async () => [{ pin }] },
    profile: { get: async () => ({ emoji: { pin, mode: 'snap', strengthBps: 10000 } }) },
  } as unknown as HostV1;
  await seedEmojiRuntime(runtime, host, { emoji: 'test/color@1.0.0', emojifx: 'original' });
  const query = new URLSearchParams(queryWithEmoji('title=Hello%20world&rows=%5B%22x%22%5D', style));
  assert.equal(query.get('emoji'), 'test/color@1.0.0');
  assert.equal(query.get('emojifx'), 'original');
  assert.equal(query.get('title'), 'Hello world');
  assert.equal(query.get('rows'), '["x"]');
  assert.equal(queryWithEmoji('title=Hi&emoji=old&emojifx=mono', null), 'title=Hi');
});
