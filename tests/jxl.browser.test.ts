// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { getBrowser, closeBrowser } from '../packages/node-shell/src/browsers.ts';
import type * as Jxl from '../shells/web/src/bridge/jxl.ts';
const origin = process.env.LOLLY_EXPORT_TEST_URL;
test('browser worker performs real lossless coding, verified JPEG restoration and cancellation', {
  skip: origin ? false : 'set LOLLY_EXPORT_TEST_URL to a local web shell', timeout: 90000,
}, async () => {
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin!).hostname));
  const browser = await getBrowser(), context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.route('**/jxl-codec-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
    await page.goto(`${origin}/jxl-codec-test`);
    const pixels = Uint8Array.from({ length: 64 * 48 * 4 }, (_, i) => i % 251);
    const jpeg = await sharp(pixels, { raw: { width: 64, height: 48, channels: 4 } }).jpeg({ progressive: true }).withMetadata({ orientation: 6 }).toBuffer();
    const result = await page.evaluate(async ({ pixels, jpeg }) => {
      const path = '/src/bridge/jxl.ts'; const jxl = await import(path) as typeof Jxl;
      const source = new Uint8Array(pixels), original = new Uint8Array(jpeg);
      const encoded = await jxl.runJxl({ operation: 'encode', bytes: source, width: 64, height: 48, options: { lossless: true } });
      const decoded = await jxl.runJxl({ operation: 'decode', bytes: encoded.bytes });
      const recompressed = await jxl.runJxl({ operation: 'recompress', bytes: original });
      const restored = await jxl.runJxl({ operation: 'restore', bytes: recompressed.bytes });
      const controller = new AbortController();
      const cancelled = jxl.runJxl({ operation: 'encode', bytes: new Uint8Array(2048 * 2048 * 4), width: 2048, height: 2048 }, controller.signal);
      setTimeout(() => controller.abort(), 20);
      let aborted = false; try { await cancelled; } catch { aborted = true; }
      return { equal: decoded.bytes.every((b, i) => b === source[i]), restored: restored.bytes.length === original.length && restored.bytes.every((b, i) => b === original[i]), aborted, size: encoded.bytes.length, heapBytes: encoded.heapBytes };
    }, { pixels: Array.from(pixels), jpeg: Array.from(jpeg) });
    assert.equal(result.equal, true); assert.equal(result.restored, true); assert.equal(result.aborted, true);
  } finally { await context.close(); await closeBrowser(); }
});
