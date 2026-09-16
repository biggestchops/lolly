// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { deploymentLive } from '../scripts/check-deployment-live.ts';

test('preview health requires the configured bypass and refuses authentication redirects', async () => {
  let redirected = false;
  const server = createServer((req, res) => {
    if (req.url === '/signin') redirected = true;
    if (req.url === '/redirect') { res.writeHead(302, { location: '/signin' }); res.end(); return; }
    res.statusCode = req.headers['x-vercel-protection-bypass'] === 'test-preview-key' ? 200 : 401;
    res.end();
  });
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const url = `http://127.0.0.1:${address.port}`;
    assert.equal(await deploymentLive(url), false);
    assert.equal(await deploymentLive(url, 'test-preview-key'), true);
    assert.equal(await deploymentLive(`${url}/redirect`, 'test-preview-key'), false);
    assert.equal(redirected, false);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
