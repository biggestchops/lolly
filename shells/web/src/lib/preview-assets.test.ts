// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import type { HostV1 } from '@lolly-tools/core/host-v1';
import { withThumbAssets } from './preview-assets.ts';

test('preview assets prefer a thumbnail and preserve a pinned version on fallback', async () => {
  const calls: unknown[] = [];
  const ref = { id: 'brand/logo', format: 'svg', url: 'blob:logo' };
  const host = { assets: { async get(id: string, opts: { format?: string; version?: string }) {
    calls.push([id, opts]);
    if (opts.format === 'thumb') throw new Error('Asset format unavailable');
    return ref;
  } } } as unknown as HostV1;
  assert.equal(await withThumbAssets(host).assets.get('brand/logo', { version: '2.0.0' }), ref);
  assert.deepEqual(calls, [['brand/logo', { version: '2.0.0', format: 'thumb' }], ['brand/logo', { version: '2.0.0' }]]);
});

test('explicit formats are exact and an unavailable original still fails', async () => {
  const calls: unknown[] = [];
  const host = { assets: { async get(id: string, opts: { format?: string }) {
    calls.push(opts);
    throw new Error(`Missing ${id}`);
  } } } as unknown as HostV1;
  await assert.rejects(withThumbAssets(host).assets.get('brand/logo', { format: 'svg' }), /Missing/);
  assert.deepEqual(calls, [{ format: 'svg' }]);
  await assert.rejects(withThumbAssets(host).assets.get('brand/logo'), /Missing/);
});

test('an available thumbnail avoids the full-size asset', async () => {
  let reads = 0;
  const ref = { id: 'brand/photo', format: 'thumb', url: 'blob:thumb' };
  const host = { assets: { async get() { reads++; return ref; } } } as unknown as HostV1;
  assert.equal(await withThumbAssets(host).assets.get('brand/photo'), ref);
  assert.equal(reads, 1);
});
