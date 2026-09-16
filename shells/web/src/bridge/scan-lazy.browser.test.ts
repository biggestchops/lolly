// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { loadTool } from '../../../../engine/src/loader.ts';
import { createRuntime } from '../../../../engine/src/runtime.ts';
import { baseHost } from '../../../../tests/helpers/host.ts';
import sharp from 'sharp';

test('the lazy web scanner decodes a real QR on cold and warm use', {
  skip: existsSync(chromium.executablePath()) ? false : 'Chromium not installed',
}, async () => {
  const tool = await loadTool('qr-code', async path => readFileSync(new URL(`../../../../community/${path}`, import.meta.url), 'utf8'));
  const runtime = await createRuntime(tool, baseHost(), { url: 'https://lolly.tools', color: '#111111', background: '#ffffff' });
  const svg = runtime.getHydratedString('{{{svgContent}}}').replace('width="100%" height="100%"', 'width="400" height="400"');
  const { data, info } = await sharp(Buffer.from(svg)).flatten({ background: '#ffffff' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('./scan-lazy.ts', import.meta.url))],
    bundle: true, write: false, format: 'iife', globalName: 'scannerProbe', platform: 'browser',
    plugins: [{ name: 'local-wasm', setup(builder) {
      builder.onResolve({ filter: /\.wasm\?url$/ }, () => ({ path: 'wasm', namespace: 'local-wasm' }));
      builder.onLoad({ filter: /.*/, namespace: 'local-wasm' }, () => ({
        contents: `export default ${JSON.stringify('data:application/wasm;base64,' + readFileSync(new URL(import.meta.resolve('zxing-wasm/reader/zxing_reader.wasm'))).toString('base64'))}`,
      }));
    } }],
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const result = await page.evaluate(async ({ pixels, width, height }) => {
      Reflect.deleteProperty(globalThis, 'BarcodeDetector');
      const { createLazyScanAPI } = (globalThis as unknown as { scannerProbe: typeof import('./scan-lazy.ts') }).scannerProbe;
      const scan = createLazyScanAPI();
      const read = async () => {
        const frame = { data: new Uint8ClampedArray(pixels), width, height };
        const pending = scan.detect(frame);
        frame.data.fill(0);
        return pending;
      };
      return { cold: await read(), warm: await read(), formats: scan.formats() };
    }, { pixels: [...data], width: info.width, height: info.height });
    assert.equal(result.cold[0]?.rawValue, 'https://lolly.tools');
    assert.equal(result.warm[0]?.rawValue, 'https://lolly.tools');
    assert.ok(result.formats.includes('qr_code'));
  } finally { await browser.close(); }
});
