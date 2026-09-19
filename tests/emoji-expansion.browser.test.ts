// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { browserInstalled, getBrowser, closeBrowser } from '../packages/node-shell/src/browsers.ts';
import type { EmojiStyleV1, EmojiPackPinV1 } from '../packages/core/src/emoji-v1.ts';

type BrowserAPI = typeof import('../shells/web/src/bridge/emoji.ts') & typeof import('../engine/src/emoji-pack.ts') & typeof import('../engine/src/emoji-inline.ts');
type Entry = { id: string; formats: { url: string; size: number }[]; meta: { emoji: { version: string; checksum: string } } };

test('new emoji sets load through the web bridge and redraw from cached exact bytes offline', {
  skip: browserInstalled() ? false : 'No browser installed; set LOLLY_BROWSER_CHANNEL=chrome or install Chromium.', timeout: 60000,
}, async () => {
  const index = JSON.parse(await readFile(new URL('../community/emoji-packs/index.json', import.meta.url), 'utf8')) as { assets: Entry[] };
  const entries = index.assets.filter(entry => /\/fluent\/|\/noto\/|\/blobmoji\//.test(entry.id));
  assert.equal(entries.length, 4);
  const compiled = await build({ stdin: {
    contents: "export * from './shells/web/src/bridge/emoji.ts'; export * from './engine/src/emoji-pack.ts'; export * from './engine/src/emoji-inline.ts';",
    resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts',
  }, bundle: true, platform: 'browser', format: 'iife', globalName: 'EMOJI', write: false });
  const browser = await getBrowser();
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.route('https://emoji.test/**', async route => {
      const entry = entries.find(entry => route.request().url().endsWith(entry.formats[0]!.url));
      if (entry) {
        const name = entry.formats[0]!.url.split('/').at(-1)!;
        await route.fulfill({ contentType: 'application/json', body: await readFile(new URL(`../community/emoji-packs/${name}`, import.meta.url)) });
      } else await route.fulfill({ contentType: 'text/html', body: '<!doctype html><body style="font:40px sans-serif;background:white"></body>' });
    });
    await page.goto('https://emoji.test/');
    await page.addScriptTag({ content: compiled.outputFiles[0]!.text });
    const loaded = await page.evaluate(async entries => {
      const api = (globalThis as unknown as { EMOJI: BrowserAPI }).EMOJI;
      let fetches = 0;
      const refs = entries.map(entry => ({ source: 'library' as const, id: entry.id, type: 'data' as const, format: 'json', url: entry.formats[0]!.url, meta: { ...entry.meta, size: entry.formats[0]!.size } }));
      const host = api.createEmojiAPI({
        query: async () => refs,
        get: async id => refs.find(ref => ref.id === id)!,
        bytes: async ref => { fetches++; return new Uint8Array(await (await fetch(typeof ref === 'string' ? ref : ref.url)).arrayBuffer()); },
      });
      const rows: { draw: () => ReturnType<BrowserAPI['prepareEmojiText']>; checksums: string[] }[] = [];
      for (const entry of entries) {
        const pin: EmojiPackPinV1 = { id: entry.id, pin: { version: entry.meta.emoji.version }, checksum: entry.meta.emoji.checksum };
        const manifest = await host.manifest(pin);
        if (!manifest) throw new Error(`No manifest: ${pin.id}`);
        const pack = await api.readEmojiPack(manifest, pin);
        if (!pack.ok) throw new Error(pack.issue.message);
        const style: EmojiStyleV1 = { schemaVersion: 1, primary: pin, fallbacks: [], metricsPolicy: 'inline-em-v1', treatment: { mode: 'original', strengthBps: 0 } };
        const draw = async () => api.prepareEmojiText('\u{1f603}\u{1f60e}', style, [pack.pack], {
          parseXml: host.parseXml as (source: string) => Document,
          loadArtwork: async (pin, asset) => (await host.artwork(pin, asset))!,
        });
        const result = await draw();
        if (result.segments.some(segment => segment.kind !== 'emoji')) throw new Error(`Unresolved specimen: ${pin.id}`);
        const row = document.createElement('div');
        row.dataset.emojiPack = entry.id;
        row.textContent = `${entry.id}: `;
        for (const segment of result.segments) if (segment.kind === 'emoji') {
          const artwork = new DOMParser().parseFromString(segment.markup, 'image/svg+xml').documentElement;
          artwork.setAttribute('width', '64'); artwork.setAttribute('height', '64');
          row.append(document.importNode(artwork, true));
        }
        document.body.append(row);
        rows.push({ draw, checksums: result.census.map(source => source.canonicalChecksum) });
      }
      (globalThis as unknown as { replay: () => Promise<boolean> }).replay = async () => {
        const before = fetches;
        for (const row of rows) {
          const result = await row.draw();
          if (JSON.stringify(result.census.map(source => source.canonicalChecksum)) !== JSON.stringify(row.checksums)) return false;
        }
        return fetches === before;
      };
      return fetches;
    }, entries);
    assert.equal(loaded, 4, 'one lazy bundle fetch per selected set');
    await context.setOffline(true);
    assert.equal(await page.evaluate(() => (globalThis as unknown as { replay: () => Promise<boolean> }).replay()), true);
    assert.equal(await page.locator('body > div > svg').count(), 8);
    const foreground = page.locator('[data-emoji-pack="community/emoji/fluent/high-contrast"]');
    for (const colour of ['rgb(255, 255, 255)', 'rgb(48, 186, 120)']) {
      const paints = await foreground.evaluate((row, colour) => {
        row.style.color = colour;
        return [...row.querySelectorAll('[fill="currentColor"]')].map(path => getComputedStyle(path).fill);
      }, colour);
      assert.ok(paints.length > 0, 'Fluent foreground uses inherited ink');
      assert.deepEqual([...new Set(paints)], [colour], 'changing CSS colour updates the existing glyphs offline');
    }
  } finally { await context.close(); await closeBrowser(); }
});
