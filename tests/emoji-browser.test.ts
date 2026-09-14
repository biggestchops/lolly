// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import type { EmojiTreatmentV1 } from '@lolly-tools/core/emoji-v1';
import { resolveEmoji } from '../engine/src/emoji-resolve.ts';
import { fixture, fixtureLocks, style } from './helpers/emoji-fixtures.ts';

test('browser and Node resolve the same pinned specimens offline with verified artwork', {
  skip: existsSync(chromium.executablePath()) ? false : 'No Chromium installed; run pnpm exec playwright install chromium.',
  timeout: 30000,
}, async () => {
  const compiled = await build({
    stdin: { contents: "export * from './engine/src/emoji-pack.ts'; export * from './engine/src/emoji-resolve.ts';", resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts' },
    bundle: true, platform: 'browser', format: 'iife', globalName: 'emojiFoundation', write: false,
  });
  const fixtures = await Promise.all(fixtureLocks.map(lock => fixture(lock.directory)));
  const inputs = fixtures.map(entry => ({ pin: entry.lock.pin, manifest: Array.from(entry.bytes), artwork: Array.from(entry.artwork), style: style(entry.lock.pin) }));
  const expected = fixtures.map(entry => resolveEmoji({ kind: 'unicode', text: '\u{1f600}' }, style(entry.lock.pin), [entry.pack]));
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route('https://lolly-emoji.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Emoji contract fixture</title>' }));
    await page.goto('https://lolly-emoji.test/');
    await context.setOffline(true);
    await page.addScriptTag({ content: compiled.outputFiles[0]!.text });
    const actual = await page.evaluate(async (rows) => {
      const api = (globalThis as unknown as { emojiFoundation: typeof import('../engine/src/emoji-pack.ts') & typeof import('../engine/src/emoji-resolve.ts') }).emojiFoundation;
      const results = [];
      for (const row of rows) {
        const loaded = await api.readEmojiPack(new Uint8Array(row.manifest), row.pin);
        if (!loaded.ok) throw new Error(loaded.issue.message);
        const art = await api.verifyEmojiArtwork(loaded.pack, { kind: 'unicode', key: '1f600' }, new Uint8Array(row.artwork));
        if (!art.ok) throw new Error(art.issue.message);
        results.push(api.resolveEmoji({ kind: 'unicode', text: '\u{1f600}' }, row.style, [loaded.pack]));
      }
      return results;
    }, inputs);
    assert.deepEqual(actual, expected);
  } finally { await browser.close(); }
});

/**
 * The treatment core is the one piece of this slice that exists BECAUSE
 * JavaScript engines disagree: V8 and JavaScriptCore agree bit for bit on add,
 * subtract, multiply, divide and square root but not on pow, cbrt, exp or log,
 * so emoji-treatment.ts carries a pinned sRGB table, a binary search and a
 * Newton cube root and uses no transcendental at all. That claim was only ever
 * measured in Node. This runs the same recolour inside Chromium, over the real
 * pinned specimens, and compares the canonical checksums byte for byte.
 */
test('browser and Node recolour the pinned specimens to the same bytes', {
  skip: existsSync(chromium.executablePath()) ? false : 'No Chromium installed; run pnpm exec playwright install chromium.',
  timeout: 60000,
}, async () => {
  const { prepareEmojiSvg } = await import('../engine/src/emoji-svg.ts');
  const { applyEmojiTreatment } = await import('../engine/src/emoji-treatment.ts');
  const { parseEmojiXml } = await import('./helpers/emoji-xml.ts');

  const palette = [
    { id: '{color.brand.primary}', hex: '#0c322c' },
    { id: '{color.brand.accent}', hex: '#30ba78' },
    { id: '{color.neutral.paper}', hex: '#f2f2f2' },
  ];
  const recipe = 'emoji-treatment-v1' as const;
  // Annotated, not inferred: the union widens `strengthBps: 0` to `number`, and
  // the original mode's contract pins it at 0.
  const treatments: EmojiTreatmentV1[] = [
    { mode: 'original' as const, strengthBps: 0 },
    { mode: 'influence' as const, strengthBps: 6500, palette, recipe },
    { mode: 'snap' as const, strengthBps: 10000, palette, recipe },
    { mode: 'mono' as const, strengthBps: 10000, palette: [palette[1]!], recipe },
    { mode: 'duotone' as const, strengthBps: 10000, palette: [palette[0]!, palette[2]!], recipe },
  ];
  const meaning = { kind: 'unicode' as const, key: '1f600' };

  const compiled = await build({
    stdin: {
      contents: "export * from './engine/src/emoji-pack.ts'; export * from './engine/src/emoji-svg.ts'; export * from './engine/src/emoji-treatment.ts';",
      resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts',
    },
    bundle: true, platform: 'browser', format: 'iife', globalName: 'emojiTreatment', write: false,
  });

  const fixtures = await Promise.all(fixtureLocks.map(lock => fixture(lock.directory)));
  const rows = fixtures.map(entry => ({ pin: entry.lock.pin, manifest: Array.from(entry.bytes), artwork: Array.from(entry.artwork) }));

  const expected: { checksum: string; paints: number; changed: number }[] = [];
  for (const entry of fixtures) {
    const prepared = await prepareEmojiSvg(entry.pack, meaning, new Uint8Array(entry.artwork), parseEmojiXml);
    assert.ok(prepared.ok, prepared.ok ? '' : prepared.message);
    for (const treatment of treatments) {
      const out = await applyEmojiTreatment(prepared.svg, treatment, meaning);
      expected.push({ checksum: out.svg.checksum, paints: out.diagnostics.paints, changed: out.diagnostics.changed });
    }
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route('https://lolly-emoji.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Emoji treatment fixture</title>' }));
    await page.goto('https://lolly-emoji.test/');
    await context.setOffline(true);
    await page.addScriptTag({ content: compiled.outputFiles[0]!.text });
    const actual = await page.evaluate(async (input) => {
      const api = (globalThis as unknown as {
        emojiTreatment: typeof import('../engine/src/emoji-pack.ts')
          & typeof import('../engine/src/emoji-svg.ts')
          & typeof import('../engine/src/emoji-treatment.ts');
      }).emojiTreatment;
      const parseXml = (source: string): Document => new DOMParser().parseFromString(source, 'image/svg+xml');
      const out = [];
      for (const row of input.rows) {
        const loaded = await api.readEmojiPack(new Uint8Array(row.manifest), row.pin);
        if (!loaded.ok) throw new Error(loaded.issue.message);
        const prepared = await api.prepareEmojiSvg(loaded.pack, { kind: 'unicode', key: '1f600' }, new Uint8Array(row.artwork), parseXml);
        if (!prepared.ok) throw new Error(prepared.message);
        for (const treatment of input.treatments) {
          const result = await api.applyEmojiTreatment(prepared.svg, treatment, { kind: 'unicode', key: '1f600' });
          out.push({ checksum: result.svg.checksum, paints: result.diagnostics.paints, changed: result.diagnostics.changed });
        }
      }
      return out;
    }, { rows, treatments });
    assert.deepEqual(actual, expected, 'every mode of every specimen recolours to the same bytes in both engines');
  } finally { await browser.close(); }
});
