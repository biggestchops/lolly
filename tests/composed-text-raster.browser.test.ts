// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { getBrowser, closeBrowser } from '../packages/node-shell/src/browsers.ts';

const origin = process.env.LOLLY_EXPORT_TEST_URL;

test('a publishing page rasterises without copying app CSS onto every glyph', {
  skip: origin ? false : 'set LOLLY_EXPORT_TEST_URL', timeout: 120000,
}, async () => {
  const chromium = await getBrowser();
  const context = await chromium.newContext({ viewport: { width: 1440, height: 1500 } });
  let snapshot = '';
  try {
    const page = await context.newPage();
    await page.goto(`${origin}/design?template=publishing-field-notes&width=960&height=1280&c2pa=0&imprint=0`);
    await page.waitForFunction(() => document.querySelectorAll('#tool-canvas path[data-text-start]').length > 1000);
    // Reuse the settled document in WebKit so its raster check does not depend
    // on the test browser's IndexedDB Blob support or an independent font load.
    snapshot = await page.evaluate(() => {
      const clone = document.documentElement.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('script').forEach(node => { node.remove(); });
      return `<!doctype html>${clone.outerHTML}`;
    });
    await checkRaster(page);
  } finally {
    await context.close();
    await closeBrowser();
  }
  if (process.env.LOLLY_WEBKIT_TEST === '1') {
    const { webkit } = await import('playwright');
    const browser = await webkit.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1500 } });
      await page.goto(`${origin}/info/`);
      await page.setContent(snapshot);
      await checkRaster(page);
    } finally {
      await browser.close();
    }
  }
});

async function checkRaster(page: import('playwright').Page): Promise<void> {
  const result = await page.evaluate(async () => {
    const modulePath = '/src/bridge/export-shared.ts';
    const { getDomToImage } = await import(modulePath);
    const root = document.querySelector('#tool-canvas')!;
    await document.fonts.ready;
    let svgBytes = 0;
    const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!;
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      ...descriptor,
      set(value: string) {
        if (value.startsWith('data:image/svg+xml')) svgBytes = Math.max(svgBytes, value.length);
        descriptor.set!.call(this, value);
      },
    });
    try {
      const canvas: HTMLCanvasElement = await (await getDomToImage()).toCanvas(root, {
        width: 960, height: 1280,
        style: { width: '960px', height: '1280px', transform: 'none', transformOrigin: 'top left' },
      });
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      const ink = (left: number, top: number, right: number, bottom: number): number => {
        let count = 0;
        for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
          const at = (y * canvas.width + x) * 4;
          if (pixels[at]! < 70 && pixels[at + 3]! > 200) count++;
        }
        return count;
      };
      return {
        width: canvas.width, height: canvas.height, svgBytes,
        paper: [...pixels.slice(0, 4)],
        heading: ink(60, 170, 900, 350),
        left: ink(70, 580, 470, 1100), right: ink(500, 580, 900, 1100),
      };
    } finally {
      Object.defineProperty(HTMLImageElement.prototype, 'src', descriptor);
    }
  });
  assert.deepEqual([result.width, result.height], [960, 1280]);
  assert.ok(result.svgBytes > 500000 && result.svgBytes < 8000000, `raster SVG stays bounded: ${result.svgBytes}`);
  assert.ok(result.paper[0]! > 230 && result.paper[3] === 255, 'paper is opaque and light');
  assert.ok(result.heading > 10000, 'headline keeps its outlined paint');
  assert.ok(result.left > 5000 && result.right > 5000, 'both columns contain visible text');
}
