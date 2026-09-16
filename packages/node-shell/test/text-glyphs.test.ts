// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as hb from 'harfbuzzjs';
import { createGlyphCache } from '../src/text-glyphs.ts';
import { createNodeTextAPI } from '../src/text.ts';

const fontBytes = (name = 'SUSE') => new Uint8Array(readFileSync(new URL(`../../../shells/web/public/fonts/${name}[wght].ttf`, import.meta.url)));
function font(weight: number) {
  const blob = new hb.Blob(fontBytes() as unknown as ArrayBuffer);
  const face = new hb.Face(blob);
  const font = new hb.Font(face);
  font.setVariations([hb.Variation.fromString(`wght=${weight}`)!]);
  return { blob, face, font };
}

test('real glyph reuse keeps font variations separate and matches uncached outlines', () => {
  const cache = createGlyphCache();
  const regular = font(400), bold = font(700);
  const glyphId = regular.font.nominalGlyph('A'.codePointAt(0)!);
  assert.ok(glyphId);
  const a = cache.get(regular.font, glyphId);
  assert.equal(a.path, regular.font.glyphToPath(glyphId));
  assert.deepEqual(a.extents, regular.font.glyphExtents(glyphId));
  assert.equal(cache.get(regular.font, glyphId), a);
  const b = cache.get(bold.font, glyphId);
  assert.notEqual(a.path, b.path);
  assert.equal(b.path, bold.font.glyphToPath(glyphId));
  assert.equal(cache.stats().hits, 1);
});

test('glyph retention evicts by bytes and entries; oversized paths and failures do not poison reuse', () => {
  let reads = 0, fail = true;
  const source = { glyphToPath(id: number) { reads++; if (id === 9 && fail) throw new Error('retry'); return 'M0,0L10,10Z'.repeat(id); }, glyphExtents() { return null; } };
  const cache = createGlyphCache(400, 2);
  cache.get(source, 1); cache.get(source, 2); cache.get(source, 1); cache.get(source, 3);
  assert.ok(cache.stats().entries <= 2);
  assert.ok(cache.stats().bytes <= 400);
  const before = reads;
  cache.get(source, 100); cache.get(source, 100);
  assert.equal(reads, before + 2, 'oversized outlines must not stay cached');
  assert.throws(() => cache.get(source, 9), /retry/);
  fail = false;
  assert.ok(cache.get(source, 9).path);
  cache.clear();
  assert.equal(cache.stats().bytes, 0);
  assert.equal(cache.stats().entries, 0);
});

test('Node font cache scopes a relative URL to its content root', async () => {
  const first = mkdtempSync(join(tmpdir(), 'lolly-font-a-'));
  const second = mkdtempSync(join(tmpdir(), 'lolly-font-b-'));
  try {
    writeFileSync(join(first, 'font.ttf'), fontBytes());
    writeFileSync(join(second, 'font.ttf'), fontBytes('Outfit'));
    const opts = { text: 'office', fontUrl: 'font.ttf', fontSize: 32, variations: ['wght=400'] };
    const a = await createNodeTextAPI({ repoRoot: first }).toPath(opts);
    const b = await createNodeTextAPI({ repoRoot: second }).toPath(opts);
    assert.notEqual(a.d, b.d, 'different roots must not reuse the first font');
    assert.deepEqual(await createNodeTextAPI({ repoRoot: first }).toPath(opts), a);
  } finally { rmSync(first, { recursive: true }); rmSync(second, { recursive: true }); }
});
