// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLazyScanAPI } from './scan-lazy.ts';

test('scanner stays cold until used and concurrent first frames keep their own pixels', async () => {
  let loads = 0;
  const api = createLazyScanAPI(async () => {
    loads++;
    return { formats: () => ['qr_code'], async detect(frame, opts) { return [{ rawValue: String(frame.data[0]), format: opts?.formats?.[0] ?? 'qr_code' }]; } };
  });
  assert.equal(loads, 0);
  const frame = { data: new Uint8ClampedArray([1, 0, 0, 255]), width: 1, height: 1 };
  const options = { formats: ['qr_code'] };
  const a = api.detect(frame, options);
  frame.data[0] = 2;
  const b = api.detect(frame);
  frame.data[0] = 3; options.formats[0] = 'changed';
  assert.deepEqual(await a, [{ rawValue: '1', format: 'qr_code' }]);
  assert.deepEqual(await b, [{ rawValue: '2', format: 'qr_code' }]);
  assert.equal(loads, 1);
  assert.deepEqual(api.formats(), ['qr_code']);
});

test('format discovery tolerates an import failure and the next use retries', async () => {
  let calls = 0;
  const api = createLazyScanAPI(async () => {
    if (++calls === 1) throw new Error('offline chunk');
    return { formats: () => ['qr_code'], async detect() { return []; } };
  });
  assert.ok(Array.isArray(api.formats()));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(await api.detect({ data: new Uint8ClampedArray(4), width: 1, height: 1 }), []);
  assert.equal(calls, 2);
});
