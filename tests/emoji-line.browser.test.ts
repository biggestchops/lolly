// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { compileEmojiLine } from '../engine/src/emoji-line.ts';
import { fixtureLocks } from './helpers/emoji-fixtures.ts';
import { emojiLineFixture, emojiRenderResources, emojiRepo } from './helpers/emoji-render.ts';
import type { createTextAPI } from '../shells/web/src/bridge/text.ts';

type BrowserEmoji = typeof import('../engine/src/emoji-line.ts') & typeof import('../engine/src/emoji-pack.ts') & { text: ReturnType<typeof createTextAPI> };

test('Chromium and Node compile identical mixed-line masters using pinned fonts and artwork offline', {
  skip: existsSync(chromium.executablePath()) ? false : 'No Chromium installed; run pnpm exec playwright install chromium.', timeout: 30000,
}, async () => {
  const { wasm, font } = await emojiRenderResources();
  const bundle = await build({
    stdin: { contents: `import * as line from './engine/src/emoji-line.ts';
      import * as pack from './engine/src/emoji-pack.ts';
      import { createTextAPI } from './shells/web/src/bridge/text.ts';
      globalThis.emojiRender = { ...line, ...pack, text: createTextAPI() };`, resolveDir: fileURLToPath(emojiRepo), loader: 'ts' },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'esnext',
    plugins: [{ name: 'unused-node-module', setup(build) {
      build.onResolve({ filter: /^module$/ }, () => ({ path: 'module', namespace: 'unused-node-module' }));
      build.onLoad({ filter: /.*/, namespace: 'unused-node-module' }, () => ({ contents: 'export function createRequire(){ throw new Error("Node branch reached in browser"); }', loader: 'js' }));
    } }],
  });
  const fixtures = await Promise.all(fixtureLocks.map(lock => emojiLineFixture(lock.directory)));
  const expected = await Promise.all(fixtures.map(input => compileEmojiLine(input.options, [input.pack], input.host)));
  for (const result of expected) assert.ok(result.ok);
  const rows = fixtures.map(input => ({ options: { ...input.options, font: { ...input.options.font, bytes: Array.from(input.options.font.bytes) } }, manifest: Array.from(input.bytes), artwork: Array.from(input.artwork), pin: input.lock.pin }));
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const unexpected: string[] = [];
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === 'https://lolly-emoji.test') {
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Emoji line contract</title>' });
        if (url.pathname === '/fixture.js') return route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0]!.text });
        if (url.pathname === '/harfbuzz.wasm') return route.fulfill({ contentType: 'application/wasm', body: wasm });
      }
      unexpected.push(url.href); return route.abort();
    });
    await page.goto('https://lolly-emoji.test/');
    await page.addScriptTag({ url: 'https://lolly-emoji.test/fixture.js', type: 'module' });
    await page.waitForFunction(() => !!(globalThis as unknown as { emojiRender?: BrowserEmoji }).emojiRender);
    // Install the checked local shaper and font, then remove all network access for compilation.
    await page.evaluate(async fontUrl => {
      await (globalThis as unknown as { emojiRender: BrowserEmoji }).emojiRender.text.preload(fontUrl);
    }, `data:font/ttf;base64,${font.toString('base64')}`);
    await context.setOffline(true);
    await page.unroute('**/*');
    const actual = await page.evaluate(async rows => {
      const api = (globalThis as unknown as { emojiRender: BrowserEmoji }).emojiRender;
      const results = [];
      for (const row of rows) {
        const loaded = await api.readEmojiPack(new Uint8Array(row.manifest), row.pin);
        if (!loaded.ok) throw new Error(loaded.issue.message);
        results.push(await api.compileEmojiLine({ ...row.options, font: { ...row.options.font, bytes: new Uint8Array(row.options.font.bytes) } }, [loaded.pack], {
          text: api.text, parseXml: source => new DOMParser().parseFromString(source, 'image/svg+xml'), loadArtwork: async () => new Uint8Array(row.artwork),
        }));
      }
      return results;
    }, rows);
    assert.deepEqual(actual, expected);
    assert.deepEqual(unexpected, []);
  } finally { await browser.close(); }
});
