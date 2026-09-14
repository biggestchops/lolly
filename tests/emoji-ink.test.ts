// SPDX-License-Identifier: MPL-2.0
/**
 * Single-ink sets follow the text colour (engine 1.197).
 *
 * A monochrome set is line art drawn in black. Placed as it is, a black glyph
 * stays black on a dark surface and beside white text, unlike a font glyph,
 * which takes the colour of the run it sits in. The engine therefore binds a
 * single-ink glyph's black paints to `currentColor`, and an inline `<svg>`
 * inherits CSS `color`, so the placement needs no style of its own.
 *
 * What is pinned here: the rule reads the artwork rather than the pack, it runs
 * only under the `original` treatment, it records one sentence that is NOT a
 * recolour, and artwork carrying any other colour is handed back untouched, with
 * the three pinned specimens byte-identical to what they were before the rewrite
 * existed.
 *
 * Run directly:  node --test tests/emoji-ink.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';
import {
  EMOJI_INK_SVG_VERSION, EMOJI_SINGLE_INK_CHANGE, emojiSvgChanges, emojiSvgMarkup,
  inkPreparedEmojiSvg, isSingleInkEmojiSvg, prepareEmojiSvg,
} from '../engine/src/emoji-svg.ts';
import type { PreparedEmojiSvg } from '../engine/src/emoji-svg.ts';
import { prepareEmojiText } from '../engine/src/emoji-inline.ts';
import type { EmojiTextIO } from '../engine/src/emoji-inline.ts';
import { emojiSourceIngredients, emojiWorksAndUses } from '../engine/src/emoji-rights.ts';
import type { EmojiPackManifestV1, EmojiStyleV1 } from '../packages/core/src/emoji-v1.ts';
import { admit, digest, fixture, fixtureRoot, style } from './helpers/emoji-fixtures.ts';
import { parseEmojiXml } from './helpers/emoji-xml.ts';

const meaning = { kind: 'unicode', key: '1f600' } as const;
const wrap = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36">${body}</svg>`;

/** One synthetic glyph through real admission, on the 36-unit fixture manifest. */
async function prepare(source: string): Promise<PreparedEmojiSvg> {
  const { manifest } = await fixture();
  const bytes = new TextEncoder().encode(source);
  manifest.glyphs[0]!.asset.checksum = digest(bytes);
  const { pack } = await admit(manifest);
  const result = await prepareEmojiSvg(pack, meaning, bytes, parseEmojiXml);
  if (!result.ok) throw new Error(result.message);
  return result.svg;
}

// The shared OpenMoji Black bundle, which a public clone has and a trimmed
// deployment may not. Three glyphs are read out of it: keycap number sign is
// plain stroked line art, the new moon carries a black FILL as well as a black
// stroke, and the NG button is the one glyph in all 4,316 that carries a white
// stroke, so it proves the rewrite leaves white alone.
const BUNDLE = new URL('../community/emoji-packs/openmoji-black.json', import.meta.url);
const BLACK_FILES = { '0023-fe0f-20e3': '0023-FE0F-20E3.svg', '1f196': '1F196.svg', '1f311': '1F311.svg' } as const;
const BLACK_LABELS = { '0023-fe0f-20e3': 'keycap number sign', '1f196': 'NG button', '1f311': 'new moon' } as const;
const SKIP_NO_BUNDLE = existsSync(BUNDLE)
  ? false
  : `The shared OpenMoji Black pack is not in this checkout (${BUNDLE.pathname}) - no monochrome artwork to read.`;

interface BlackPack { pack: Awaited<ReturnType<typeof admit>>['pack']; pin: EmojiStyleV1['primary']; artwork: Record<string, string> }
let blackPack: BlackPack | null = null;

/**
 * A three-glyph OpenMoji Black pack built from the real bundle artwork, on the
 * OpenMoji fixture manifest's own metrics (72 units per em, the viewBox every
 * OpenMoji file uses). Built once, because the bundle is 15 MB.
 */
async function black(): Promise<BlackPack> {
  if (blackPack) return blackPack;
  const bundle = JSON.parse(await readFile(BUNDLE, 'utf8')) as { artwork: Record<string, string> };
  const base = JSON.parse(await readFile(new URL('openmoji/manifest.json', fixtureRoot), 'utf8')) as EmojiPackManifestV1;
  const template = base.glyphs[0]!;
  const artwork: Record<string, string> = {};
  const manifest: EmojiPackManifestV1 = {
    ...base,
    id: 'community/emoji/openmoji/black',
    style: 'Black',
    glyphs: Object.entries(BLACK_FILES).map(([key, file]) => {
      const source = bundle.artwork[file]!;
      assert.ok(source, `${file} is in the bundle`);
      artwork[key] = source;
      const checksum = digest(new TextEncoder().encode(source));
      return {
        ...structuredClone(template),
        meaning: { kind: 'unicode' as const, key },
        label: BLACK_LABELS[key as keyof typeof BLACK_LABELS],
        asset: { ...structuredClone(template.asset), id: `community/emoji/openmoji/black/${key}`, url: file, checksum },
        sourceChecksum: checksum,
      };
    }),
  };
  const { pack, pin } = await admit(manifest);
  blackPack = { pack, pin, artwork };
  return blackPack;
}

/** Hands the pass the bundle artwork it already holds in memory. */
function blackIo(loaded: BlackPack): EmojiTextIO {
  return {
    loadArtwork: async (_pin, asset) => new TextEncoder().encode(loaded.artwork[asset.id.split('/').pop()!]!),
    parseXml: parseEmojiXml,
  };
}

test('single ink is read off the paints, not off the pack', async () => {
  const strokes = await prepare(wrap('<g fill="none" stroke="#000"><rect x="2" y="2" width="32" height="32"/></g>'));
  assert.equal(isSingleInkEmojiSvg(strokes), true, 'black strokes over no fill');

  const withWhite = await prepare(wrap('<rect x="2" y="2" width="32" height="32" fill="#000"/><circle cx="18" cy="18" r="6" fill="white"/>'));
  assert.equal(isSingleInkEmojiSvg(withWhite), true, 'white is allowed alongside black');

  // A CSS keyword is canonicalized to hex at admission, so `black` counts as black.
  const keyword = await prepare(wrap('<rect x="2" y="2" width="32" height="32" fill="black" stroke="none"/>'));
  assert.equal(isSingleInkEmojiSvg(keyword), true);

  const coloured = await prepare(wrap('<rect x="2" y="2" width="32" height="32" fill="#000"/><circle cx="18" cy="18" r="6" fill="#30ba78"/>'));
  assert.equal(isSingleInkEmojiSvg(coloured), false, 'one other colour is enough');

  // Black and white stops only, and still not single ink: a url() reference is a
  // paint server, and the rewrite has no way to know what it will draw.
  const gradient = await prepare(wrap('<defs><linearGradient id="g"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient></defs><rect x="2" y="2" width="32" height="32" fill="url(#g)"/>'));
  assert.equal(isSingleInkEmojiSvg(gradient), false);

  // Near-black is a colour someone chose, not ink.
  const nearly = await prepare(wrap('<rect x="2" y="2" width="32" height="32" fill="#010101"/>'));
  assert.equal(isSingleInkEmojiSvg(nearly), false);
});

test('real OpenMoji Black artwork binds its black paints to the text colour', { skip: SKIP_NO_BUNDLE }, async () => {
  const loaded = await black();
  for (const [key, file] of Object.entries(BLACK_FILES)) {
    const bytes = new TextEncoder().encode(loaded.artwork[key]!);
    const admitted = await prepareEmojiSvg(loaded.pack, { kind: 'unicode', key }, bytes, parseEmojiXml);
    assert.equal(admitted.ok, true, admitted.ok ? '' : `${file}: ${admitted.message}`);
    if (!admitted.ok) continue;
    assert.equal(isSingleInkEmojiSvg(admitted.svg), true, `${file} is single ink`);

    const inked = await inkPreparedEmojiSvg(admitted.svg);
    assert.notEqual(inked, admitted.svg, `${file} was rewritten`);
    assert.equal(inked.normalizer, EMOJI_INK_SVG_VERSION);
    assert.equal(inked.sourceChecksum, admitted.svg.sourceChecksum, `${file} keeps its source bytes`);
    assert.notEqual(inked.checksum, admitted.svg.checksum);

    const markup = emojiSvgMarkup(inked);
    assert.match(markup, /currentColor/, `${file} draws in the text colour`);
    assert.doesNotMatch(markup, /"#000"|"#000000"/, `${file} has no black paint left`);
    // Geometry, ids and every other attribute are untouched: only paints moved.
    assert.equal(markup.replaceAll('currentColor', '#000000'), emojiSvgMarkup(admitted.svg).replaceAll('"#000"', '"#000000"'));

    const changes = emojiSvgChanges(inked);
    assert.equal(changes.filter(change => change === EMOJI_SINGLE_INK_CHANGE).length, 1, 'one sentence, once');
    for (const kept of emojiSvgChanges(admitted.svg)) assert.ok(changes.includes(kept), kept);

    // Same bytes on a second run, and inking an inked tree is a no-op.
    assert.equal((await inkPreparedEmojiSvg(admitted.svg)).checksum, inked.checksum);
    assert.equal(await inkPreparedEmojiSvg(inked), inked);
  }

  // White is ink somebody chose, so it stays: the NG button keeps its white
  // stroke while the black strokes beside it follow the text.
  const ng = await prepareEmojiSvg(loaded.pack, { kind: 'unicode', key: '1f196' }, new TextEncoder().encode(loaded.artwork['1f196']!), parseEmojiXml);
  assert.ok(ng.ok);
  if (!ng.ok) return;
  assert.match(emojiSvgMarkup(await inkPreparedEmojiSvg(ng.svg)), /stroke="#fff"/);
});

test('a real rasteriser draws the inked glyph in the colour it inherits', { skip: SKIP_NO_BUNDLE }, async () => {
  // Pixels, not attributes. The pinned reference rasteriser is handed the same
  // glyph twice: once under a parent carrying `color`, once with the colour
  // written into the paints, and the two must decode identically. That is the
  // whole mechanism, and it is what the web SVG export walker reproduces when it
  // stamps the live computed `color` onto each inline svg it clones.
  const loaded = await black();
  const admitted = await prepareEmojiSvg(loaded.pack, { kind: 'unicode', key: '1f311' }, new TextEncoder().encode(loaded.artwork['1f311']!), parseEmojiXml);
  assert.ok(admitted.ok);
  if (!admitted.ok) return;
  const glyph = emojiSvgMarkup(await inkPreparedEmojiSvg(admitted.svg), 'p');
  const page = (attributes: string, markup: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72"${attributes}>${markup}</svg>`;
  const options = { fitTo: { mode: 'width' as const, value: 72 }, font: { loadSystemFonts: false } };
  const inherited = new Resvg(page(' color="#30ba78"', glyph), options).render();
  const written = new Resvg(page('', glyph.replaceAll('currentColor', '#30ba78')), options).render();
  const inkedBlack = new Resvg(page(' color="#000000"', glyph), options).render();
  assert.deepEqual(inherited.pixels, written.pixels, 'the inherited colour is the colour that draws');
  assert.notDeepEqual(inherited.pixels, inkedBlack.pixels, 'and it is not stuck on black');
  const centre = (raster: { pixels: Uint8Array; width: number }, x = 36, y = 36) => Array.from(raster.pixels.slice((y * raster.width + x) * 4, (y * raster.width + x) * 4 + 4));
  assert.deepEqual(centre(inherited), [48, 186, 120, 255], 'the new moon is filled in the text colour');
  assert.deepEqual(centre(inkedBlack), [0, 0, 0, 255]);
});

test('artwork that carries a colour is handed back untouched', async () => {
  // The three pinned specimens are colour artwork, so none of them is single ink
  // and none of them gets a new handle, a new checksum or a new change sentence.
  for (const name of ['twemoji', 'openmoji', 'noto']) {
    const input = await fixture(name);
    const admitted = await prepareEmojiSvg(input.pack, meaning, input.artwork, parseEmojiXml);
    assert.ok(admitted.ok, name);
    if (!admitted.ok) continue;
    assert.equal(isSingleInkEmojiSvg(admitted.svg), false, name);
    assert.equal(await inkPreparedEmojiSvg(admitted.svg), admitted.svg, `${name} keeps its handle`);
    assert.ok(!emojiSvgChanges(admitted.svg).includes(EMOJI_SINGLE_INK_CHANGE), name);
  }
});

test('the three pinned specimens prepare to the bytes they prepared before this rule existed', async () => {
  // Recorded on 2026-09-14 from the pass as it stood before inkPreparedEmojiSvg
  // was written. A specimen is colour artwork, so the rule must not reach it.
  const before: Record<string, string> = {
    twemoji: 'sha256:4477b8c1f86bc0e08452464c3f57debdfb74b9bff13f2faad2497957687d93a6',
    openmoji: 'sha256:c5cf482d19fa729920bd4bb828ada33dc0b934e37e83c14546dfdda844aaf2a9',
    noto: 'sha256:53fb1f4f6aae9900047eca95aae64c3de647d9308fc522eaf99faff062d6715e',
  };
  for (const [name, checksum] of Object.entries(before)) {
    const input = await fixture(name);
    const io: EmojiTextIO = {
      loadArtwork: async (_pin, asset) => new Uint8Array(await readFile(new URL(`${name}/${asset.url}`, fixtureRoot))),
      parseXml: parseEmojiXml,
    };
    const prepared = await prepareEmojiText('😀', style(input.lock.pin), [input.pack], io);
    const entry = prepared.census[0]!;
    assert.equal(entry.canonicalChecksum, checksum, name);
    assert.equal(entry.normalizer, 'static-svg-v1', name);
  }
});

test('the pass draws a single-ink glyph in the text colour and records one sentence', { skip: SKIP_NO_BUNDLE }, async () => {
  const loaded = await black();
  const prepared = await prepareEmojiText('a 🌑', style(loaded.pin), [loaded.pack], blackIo(loaded));
  const segment = prepared.segments[1]!;
  assert.equal(segment.kind, 'emoji');
  if (segment.kind !== 'emoji') return;
  assert.match(segment.markup, /currentColor/);
  assert.doesNotMatch(segment.markup, /"#000"|"#000000"/);

  const entry = prepared.census[0]!;
  assert.equal(entry.normalizer, EMOJI_INK_SVG_VERSION);
  assert.equal(entry.changes.filter(change => change === EMOJI_SINGLE_INK_CHANGE).length, 1);
  assert.equal(entry.sourceChecksum, entry.artworkChecksum, 'the source bytes are the bytes that were pinned');
});

test('a palette treatment still takes black through the recipe', { skip: SKIP_NO_BUNDLE }, async () => {
  const loaded = await black();
  const chosen = style(loaded.pin);
  const treated: EmojiStyleV1 = {
    ...chosen,
    treatment: {
      mode: 'snap', strengthBps: 10000, recipe: 'emoji-treatment-v1',
      palette: [{ id: 'brand.primary', hex: '#0c322c' }, { id: 'brand.accent', hex: '#30ba78' }],
    },
  };
  const prepared = await prepareEmojiText('🌑', treated, [loaded.pack], blackIo(loaded));
  const segment = prepared.segments[0]!;
  assert.equal(segment.kind, 'emoji');
  if (segment.kind !== 'emoji') return;
  assert.doesNotMatch(segment.markup, /currentColor/, 'a treatment decides the colour, not the text');
  assert.match(segment.markup, /#0c322c/);

  const entry = prepared.census[0]!;
  assert.equal(entry.normalizer, 'static-svg-v1+emoji-treatment-v1');
  assert.ok(!entry.changes.includes(EMOJI_SINGLE_INK_CHANGE));
  assert.ok(entry.changes.some(change => change.startsWith('Recoloured every paint')));
});

test('a single-ink glyph is placed, never recoloured, in the rights census', { skip: SKIP_NO_BUNDLE }, async () => {
  const loaded = await black();
  const prepared = await prepareEmojiText('🌑 and 🌑', style(loaded.pin), [loaded.pack], blackIo(loaded));
  const census = emojiWorksAndUses(prepared.census);
  assert.equal(census.uses.length, 1);
  assert.deepEqual(census.uses[0]!.operations, ['placed']);
  assert.equal(census.uses[0]!.scope?.count, 2);
  const id = census.uses[0]!.work;
  assert.ok(census.details[id]!.modifications?.includes(EMOJI_SINGLE_INK_CHANGE), 'the change is still declared');
  // OpenMoji is ShareAlike, and this use asks for no adaptation decision.
  assert.equal(census.works[0]!.rights[0]!.declaration, 'CC-BY-SA-4.0');

  const ingredients = emojiSourceIngredients(prepared.census);
  assert.equal(ingredients.length, 1);
  assert.equal(ingredients[0]!.relationship, 'componentOf');
  assert.match(ingredients[0]!.description!, /Single-ink paints follow the surrounding text colour\./);
  assert.equal(ingredients[0]!.rights!.usedHash, prepared.census[0]!.canonicalChecksum);
});
