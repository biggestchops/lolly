// SPDX-License-Identifier: MPL-2.0
/** Fluent High Contrast inherits text ink without reinterpreting other grey artwork. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';
import type { EmojiPackManifestV1 } from '../packages/core/src/emoji-v1.ts';
import { readEmojiPack } from '../engine/src/emoji-pack.ts';
import { prepareEmojiText } from '../engine/src/emoji-inline.ts';
import {
  EMOJI_SINGLE_INK_CHANGE, emojiSvgChanges, emojiSvgMarkup,
  inkPreparedEmojiSvg, isSingleInkEmojiSvg, prepareEmojiSvg,
} from '../engine/src/emoji-svg.ts';
import { admit, digest, style } from './helpers/emoji-fixtures.ts';
import { parseEmojiXml } from './helpers/emoji-xml.ts';

const bundle = JSON.parse(await readFile(new URL('../community/emoji-packs/fluent-high-contrast.json', import.meta.url), 'utf8')) as {
  manifest: string; artwork: Record<string, string>;
};
const manifest = JSON.parse(bundle.manifest) as EmojiPackManifestV1;
// Keep the exact published manifest bytes: a reserialized manifest has a different pin.
const manifestBytes = new TextEncoder().encode(bundle.manifest);
const pin = { id: manifest.id, pin: { version: manifest.version }, checksum: digest(manifestBytes) };
const read = await readEmojiPack(manifestBytes, pin);
assert.ok(read.ok, read.ok ? '' : read.issue.message);
const pack = read.pack;
const io = {
  parseXml: parseEmojiXml,
  loadArtwork: async (_pin: unknown, asset: { url: string }) => new TextEncoder().encode(bundle.artwork[asset.url]!),
};

test('all Fluent High Contrast glyphs bind foreground ink while preserving white details and geometry', async () => {
  assert.equal(manifest.glyphs.length, 1586, 'review the full ink inventory when the pack changes');
  let whiteGlyphs = 0;
  let alternateGreyGlyphs = 0;
  for (const glyph of manifest.glyphs) {
    const prepared = await prepareEmojiSvg(pack, glyph.meaning, await io.loadArtwork(pin, glyph.asset), parseEmojiXml);
    assert.ok(prepared.ok, prepared.ok ? '' : `${glyph.label}: ${prepared.message}`);
    const original = emojiSvgMarkup(prepared.svg);
    assert.equal(isSingleInkEmojiSvg(prepared.svg), true, glyph.label);
    const inked = await inkPreparedEmojiSvg(prepared.svg);
    const markup = emojiSvgMarkup(inked);
    assert.equal(markup, original.replace(/(fill|stroke|stop-color)="#(?:000|000000|212121|1c1c1c)"/g, '$1="currentColor"'), glyph.label);
    assert.match(markup, /currentColor/, glyph.label);
    assert.equal(inked.sourceChecksum, glyph.asset.checksum);
    assert.equal(emojiSvgChanges(inked).filter(change => change === EMOJI_SINGLE_INK_CHANGE).length, 1);
    assert.equal(await inkPreparedEmojiSvg(inked), inked, 'a second pass is a no-op');
    if (/="#(?:fff|ffffff)"/.test(original)) whiteGlyphs++;
    if (/="#1c1c1c"/.test(original)) alternateGreyGlyphs++;
  }
  assert.equal(whiteGlyphs, 72, 'white remains white, as in OpenMoji Black');
  assert.equal(alternateGreyGlyphs, 1, 'the facepalming glyph uses a second foreground grey');
});

test('the Fluent ink exception cannot be claimed by a differently pinned pack', async () => {
  const other = structuredClone(manifest);
  other.family = 'Custom grey artwork';
  const changed = await admit(other);
  const glyph = other.glyphs.find(glyph => glyph.meaning.kind === 'unicode' && glyph.meaning.key === '1f600')!;
  const prepared = await prepareEmojiSvg(changed.pack, glyph.meaning, await io.loadArtwork(changed.pin, glyph.asset), parseEmojiXml);
  assert.ok(prepared.ok);
  assert.equal(isSingleInkEmojiSvg(prepared.svg), false);
  assert.equal(await inkPreparedEmojiSvg(prepared.svg), prepared.svg);
  assert.match(emojiSvgMarkup(prepared.svg), /#212121/);
});

test('Fluent text ink reaches rendered pixels and the source census; palette treatments retain control', async () => {
  const text = '\u{1f600}\u{1f39f}\u{fe0f}\u{1f926}\u{200d}\u{2640}\u{fe0f}';
  const result = await prepareEmojiText(text, style(pin), [pack], io);
  assert.equal(result.segments.length, 3);
  for (const segment of result.segments) {
    assert.equal(segment.kind, 'emoji');
    if (segment.kind !== 'emoji') continue;
    assert.ok(segment.source.changes.includes(EMOJI_SINGLE_INK_CHANGE));
    for (const colour of ['#ffffff', '#30ba78']) {
      const svg = (markup: string, color = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" color="${color || '#000000'}">${markup}</svg>`;
      const options = { font: { loadSystemFonts: false } };
      const inherited: Uint8Array = new Resvg(svg(segment.markup, colour), options).render().pixels;
      const explicit: Uint8Array = new Resvg(svg(segment.markup.replaceAll('currentColor', colour)), options).render().pixels;
      const black: Uint8Array = new Resvg(svg(segment.markup), options).render().pixels;
      assert.deepEqual(inherited, explicit, 'inherited colour reaches raster exports');
      assert.notDeepEqual(inherited, black, 'foreground is not stuck on black');
    }
  }
  const chosen = style(pin);
  chosen.treatment = {
    mode: 'snap', strengthBps: 10000, recipe: 'emoji-treatment-v1',
    palette: [{ id: 'primary', hex: '#0c322c' }, { id: 'accent', hex: '#30ba78' }],
  };
  const treated = await prepareEmojiText('\u{1f600}', chosen, [pack], io);
  const first = treated.segments[0];
  assert.equal(first?.kind, 'emoji');
  if (first?.kind === 'emoji') {
    assert.doesNotMatch(first.markup, /currentColor/);
    assert.match(first.markup, /#(?:0c322c|30ba78)/);
    assert.ok(!first.source.changes.includes(EMOJI_SINGLE_INK_CHANGE));
  }
});
