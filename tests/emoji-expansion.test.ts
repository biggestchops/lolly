// SPDX-License-Identifier: MPL-2.0
/** Exercise the registered bundles through host loading, vector placement and credits. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Resvg } from '@resvg/resvg-js';
import { createNodeEmojiAPI } from '../packages/node-shell/src/emoji.ts';
import { readEmojiPack, findEmojiGlyph } from '../engine/src/emoji-pack.ts';
import { prepareEmojiText } from '../engine/src/emoji-inline.ts';
import { prepareEmojiSvg, emojiSvgMarkup } from '../engine/src/emoji-svg.ts';
import { emojiWorksAndUses } from '../engine/src/emoji-rights.ts';
import { evaluateCreativeUses } from '../engine/src/rights-evaluate.ts';
import { attributionCredits } from '../engine/src/rights-attribution.ts';
import type { EmojiStyleV1 } from '../packages/core/src/emoji-v1.ts';

const additions = ['fluent/flat', 'fluent/high-contrast', 'noto/color', 'blobmoji/color'];

for (const name of additions) test(`${name}: registered artwork, notices and brand treatment reach the render path`, async () => {
  const host = await createNodeEmojiAPI();
  const set = (await host.sets()).find(set => set.pin.id === `community/emoji/${name}`);
  assert.ok(set, 'the community set is listed');
  assert.equal(set.coverageComplete, false, 'incomplete repertoires are identified');
  const bytes = await host.manifest(set.pin);
  assert.ok(bytes, 'the real bundle fits the host budget, including Noto above 32 MiB');
  const admitted = await readEmojiPack(bytes, set.pin);
  assert.ok(admitted.ok, admitted.ok ? '' : admitted.issue.message);
  const style: EmojiStyleV1 = {
    schemaVersion: 1, primary: set.pin, fallbacks: [], metricsPolicy: 'inline-em-v1',
    treatment: { mode: 'original', strengthBps: 0 },
  };
  const io = {
    loadArtwork: async (pin: typeof set.pin, asset: Parameters<typeof host.artwork>[1]) => {
      const bytes = await host.artwork(pin, asset);
      assert.ok(bytes);
      return bytes;
    },
    parseXml: host.parseXml as (source: string) => Document,
  };
  const line = await prepareEmojiText('\u{1f603}\u{1f60e}\u{1f603}', style, [admitted.pack], io);
  assert.ok(line.segments.every(segment => segment.kind === 'emoji'));
  const sources = line.segments.flatMap(segment => segment.kind === 'emoji' ? [segment.source] : []);
  assert.ok(sources.every(source => source.notices?.some(notice => /MIT License|Apache License/.test(notice.text))));
  const census = emojiWorksAndUses(sources);
  const result = evaluateCreativeUses({ ...census, context: {
    operation: 'render', audience: 'public', commercial: true,
    delivery: { format: 'svg', route: 'file-with-c2pa', canCarryCredential: true, canCarryReadableCredit: true },
  } });
  assert.equal(result.status, 'ready', JSON.stringify(result.issues));
  const credits = attributionCredits(result.plan);
  assert.match(credits, name.startsWith('fluent') ? /Permission is hereby granted/ : /Apache License/);
  if (name.startsWith('fluent')) assert.equal(credits.split('Permission is hereby granted').length - 1, 1, 'one notice despite several glyphs');
  const meaning = { kind: 'unicode' as const, key: '1f603' };
  const glyph = findEmojiGlyph(admitted.pack, meaning);
  assert.ok(glyph);
  const artwork = await io.loadArtwork(set.pin, glyph.glyph.asset);
  const prepared = await prepareEmojiSvg(admitted.pack, meaning, artwork, io.parseXml);
  assert.ok(prepared.ok, prepared.ok ? '' : prepared.message);
  for (const width of [24, 64, 256]) {
    const options = { fitTo: { mode: 'width' as const, value: width }, font: { loadSystemFonts: false } };
    assert.deepEqual(new Resvg(emojiSvgMarkup(prepared.svg), options).render().pixels, new Resvg(Buffer.from(artwork), options).render().pixels);
  }
  const recoloured = await prepareEmojiText('\u{1f603}', { ...style, treatment: {
    mode: 'snap', strengthBps: 10000, recipe: 'emoji-treatment-v1', palette: [{ id: '{brand.primary}', hex: '#30ba78' }, { id: '{brand.dark}', hex: '#0c322c' }, { id: '{brand.light}', hex: '#f2f2f2' }],
  } }, [admitted.pack], io);
  const first = recoloured.segments[0];
  assert.equal(first?.kind, 'emoji');
  if (first?.kind === 'emoji') assert.match(first.markup, /#(?:30ba78|0c322c|f2f2f2)/);
});
