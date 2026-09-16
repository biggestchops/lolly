// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTextAPI } from './text.ts';
import { createNodeTextAPI } from '@lolly-tools/node-shell/text';
import { fileURLToPath } from 'node:url';

test('concurrent text requests share font initialization, retry failures and preserve web/Node output', async () => {
  const bytes = readFileSync(new URL('../../public/fonts/SUSE[wght].ttf', import.meta.url));
  const original = globalThis.fetch;
  let reads = 0;
  globalThis.fetch = async () => {
    reads++;
    await new Promise(resolve => setTimeout(resolve, 5));
    return new Response(bytes);
  };
  try {
    const api = createTextAPI();
    const opts = { text: 'office office AV', fontUrl: '/font-singleflight.ttf', fontSize: 32, variations: ['wght=700'], features: ['liga=0'], letterSpacing: 1, clusters: true };
    const [a, b, c] = await Promise.all([api.toPath(opts), api.toPath(opts), api.toPath({ ...opts, variations: ['wght=400'] })]);
    assert.equal(reads, 1);
    assert.deepEqual(a, b);
    assert.notEqual(a.d, c.d);
    const node = createNodeTextAPI({ repoRoot: fileURLToPath(new URL('../../../../', import.meta.url)) });
    assert.deepEqual(await node.toPath({ ...opts, fontUrl: 'shells/web/public/fonts/SUSE[wght].ttf' }), a);
    globalThis.fetch = async () => new Response('', { status: 503 });
    await assert.rejects(api.preload!('/font-retry.ttf'), /503/);
    globalThis.fetch = async () => new Response(bytes);
    await api.preload!('/font-retry.ttf');
    assert.deepEqual(await api.toPath({ ...opts, fontUrl: '/font-retry.ttf' }), a);
  } finally { globalThis.fetch = original; }
});
