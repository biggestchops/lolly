// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { fixture, style } from '../../../../tests/helpers/emoji-fixtures.ts';
import { emojiParams, parseEmojiParams } from '../../../../engine/src/emoji-style.ts';
import { createEmojiAPI } from './emoji.ts';
import type { EmojiStorage, EmojiAssetRecord } from './emoji-storage.ts';
import { buildLollyFile, ingestLollyFile } from '../lib/lolly-pack.ts';
import type { BeamPackHost } from '../lib/beam-pack.ts';
import type { AssetRef } from '@lolly-tools/core/host-v1';

function memory() {
  const records = new Map<string, EmojiAssetRecord>();
  const sessions = new Map<string, unknown>();
  const assets: EmojiStorage = {
    query: async () => [],
    get: async id => { const record = records.get(id); if (!record) throw new Error('No network in this host.');
      return { source: 'user', id, type: 'data', format: 'json', meta: record.meta } as AssetRef; },
    bytes: async ref => new Uint8Array(await records.get(typeof ref === 'string' ? ref : ref.id)!.blob!.arrayBuffer()),
    _exportUserAssets: async () => [...records.values()],
    _uploadUserAsset: async record => { records.set(record.id, record); },
    _getUserRecord: async id => records.get(id) ?? null,
  };
  const state = { list: async () => [...sessions.keys()].map(slot => ({ slot })), load: async (slot: string) => sessions.get(slot),
    save: async (slot: string, data: unknown) => { sessions.set(slot, data); }, delete: async (slot: string) => { sessions.delete(slot); } };
  return { assets, state, records, sessions };
}
const f = await fixture();
const bundle = { schemaVersion: 1, kind: 'emoji-pack-bundle', manifest: new TextDecoder().decode(f.bytes), artwork: { '1f600.svg': new TextDecoder().decode(f.artwork) } };
const bytes = () => new TextEncoder().encode(JSON.stringify(bundle));

test('imported emoji packs survive .lolly on a fresh offline host with exact style and artwork', async () => {
  const dom = new JSDOM('');
  const previous = globalThis.DOMParser;
  globalThis.DOMParser = dom.window.DOMParser;
  try {
    const sender = memory(); const source = createEmojiAPI(sender.assets);
    const info = await source.install!(bytes());
    const chosen = style(info.pin); chosen.treatment = { mode: 'mono', strengthBps: 10000, recipe: 'emoji-treatment-v1', palette: [{ id: 'brand', hex: '#123456' }] };
    const session = { __toolId: 'design', __emoji: emojiParams(chosen), __emojiAssets: await source.dependencies!([info.pin]), title: '\u{1f600}' };
    const saved = await buildLollyFile({ session, toolId: 'design', userAssets: [...sender.records.values()] });
    assert.equal(saved.manifest.counts.assets, 1);
    const receiver = memory();
    await ingestLollyFile(new Uint8Array(await saved.blob.arrayBuffer()), receiver as unknown as BeamPackHost);
    const api = createEmojiAPI(receiver.assets);
    const reopened = [...receiver.sessions.values()][0] as typeof session;
    assert.deepEqual(parseEmojiParams(reopened.__emoji, await api.sets(), []).style, chosen);
    assert.deepEqual(await api.manifest(info.pin), new Uint8Array(f.bytes));
    assert.deepEqual(await api.artwork(info.pin, f.manifest.glyphs[0]!.asset), new Uint8Array(f.artwork));
    assert.equal((await api.sets()).length, 1);
  } finally { globalThis.DOMParser = previous; dom.window.close(); }
});

test('custom pack admission rejects modified artwork before creating any record', async () => {
  const dom = new JSDOM(''); const previous = globalThis.DOMParser; globalThis.DOMParser = dom.window.DOMParser;
  try {
    const target = memory(); const api = createEmojiAPI(target.assets);
    const bad = { ...bundle, artwork: { '1f600.svg': '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' } };
    await assert.rejects(api.install!(new TextEncoder().encode(JSON.stringify(bad))), /checksum|digest|match/i);
    assert.equal(target.records.size, 0);
  } finally { globalThis.DOMParser = previous; dom.window.close(); }
});
