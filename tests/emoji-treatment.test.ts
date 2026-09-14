// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { Resvg } from '@resvg/resvg-js';
import { emojiSvgChanges, emojiSvgMarkup, prepareEmojiSvg } from '../engine/src/emoji-svg.ts';
import type { PreparedEmojiSvg } from '../engine/src/emoji-svg.ts';
import {
  EMOJI_TREATMENT_RECIPE, SRGB_TO_LINEAR, applyEmojiTreatment, emojiOklab, expandEmojiHex,
  isProtectedEmojiMeaning,
} from '../engine/src/emoji-treatment.ts';
import { hexToOklch, linearSrgbToOklab, srgbToLinear } from '../engine/src/brand-derive.ts';
import { admit, digest, fixture } from './helpers/emoji-fixtures.ts';
import { parseEmojiXml } from './helpers/emoji-xml.ts';
import type { EmojiMeaningV1, EmojiPaletteEntryV1, EmojiTreatmentV1 } from '../packages/core/src/emoji-v1.ts';

const meaning: EmojiMeaningV1 = { kind: 'unicode', key: '1f600' };
const palette: EmojiPaletteEntryV1[] = [
  { id: 'brand/green', hex: '#30ba78' },
  { id: 'brand/ink', hex: '#0c322c' },
  { id: 'brand/mist', hex: '#efefef' },
  { id: 'brand/violet', hex: '#5b3ea8' },
];
const recipe = EMOJI_TREATMENT_RECIPE;
const original: EmojiTreatmentV1 = { mode: 'original', strengthBps: 0 };
const influence = (strengthBps: number): EmojiTreatmentV1 => ({ mode: 'influence', strengthBps, palette, recipe });
const snap: EmojiTreatmentV1 = { mode: 'snap', strengthBps: 10000, palette, recipe };
const mono: EmojiTreatmentV1 = { mode: 'mono', strengthBps: 10000, palette: [palette[0]!], recipe };
const duotone: EmojiTreatmentV1 = { mode: 'duotone', strengthBps: 10000, palette: [palette[1]!, palette[2]!], recipe };

const paintsIn = (markup: string): string[] =>
  [...new Set([...markup.matchAll(/(?:fill|stroke|stop-color)="(#[0-9a-f]{3,6})"/g)].map(match => match[1]!))].sort();

async function admitted(name: string): Promise<PreparedEmojiSvg> {
  const input = await fixture(name);
  const result = await prepareEmojiSvg(input.pack, meaning, input.artwork, parseEmojiXml);
  if (!result.ok) throw new Error(`${name}: ${result.message}`);
  return result.svg;
}

/** Admit a synthetic source against the twemoji fixture's manifest, as emoji-svg.test.ts does. */
async function prepare(source: string): Promise<PreparedEmojiSvg> {
  const { manifest } = await fixture();
  const bytes = new TextEncoder().encode(source);
  manifest.glyphs[0]!.asset.checksum = digest(bytes);
  const { pack } = await admit(manifest);
  const result = await prepareEmojiSvg(pack, meaning, bytes, parseEmojiXml);
  if (!result.ok) throw new Error(result.message);
  return result.svg;
}

test('the pinned sRGB decode table is exactly what Math.pow produces', () => {
  assert.equal(SRGB_TO_LINEAR.length, 256);
  for (let index = 0; index < 256; index += 1) {
    const channel = index / 255;
    // The ** operator is the same pow the committed literals were generated with.
    const expected = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    assert.ok(Math.abs(SRGB_TO_LINEAR[index]! - expected) <= 1e-12, `entry ${index}`);
  }
  assert.equal(SRGB_TO_LINEAR[0], 0);
  assert.equal(SRGB_TO_LINEAR[255], 1);
  assert.ok(SRGB_TO_LINEAR.every((value, index) => index === 0 || value > SRGB_TO_LINEAR[index - 1]!));
});

test('the pinned colour core agrees with the engine float path to 1e-6', () => {
  const colors = [
    '#000000', '#ffffff', '#010101', '#7f7f7f', '#ffcc4d', '#664500', '#30ba78', '#0c322c',
    '#efefef', '#5b3ea8', '#ea5a47', '#fcea2b', '#ff0000', '#0000ff',
  ];
  for (const hex of colors) {
    const lab = emojiOklab(hex)!;
    const reference = linearSrgbToOklab(
      srgbToLinear(Number.parseInt(hex.slice(1, 3), 16) / 255),
      srgbToLinear(Number.parseInt(hex.slice(3, 5), 16) / 255),
      srgbToLinear(Number.parseInt(hex.slice(5, 7), 16) / 255),
    );
    for (let axis = 0; axis < 3; axis += 1) {
      assert.ok(Math.abs(lab[axis]! - reference[axis]!) < 1e-6, `${hex} axis ${axis}`);
    }
    const oklch = hexToOklch(hex)!;
    assert.ok(Math.abs(lab[0] - oklch.l) < 1e-6, `${hex} lightness`);
    assert.ok(Math.abs(Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]) - oklch.c) < 1e-6, `${hex} chroma`);
  }
  assert.equal(expandEmojiHex('#fff'), '#ffffff');
  assert.deepEqual(emojiOklab('#fff'), emojiOklab('#ffffff'));
  assert.equal(emojiOklab('none'), null);
  assert.equal(expandEmojiHex('url(#g)'), null);
});

test('every mode pins its hex output on the real Twemoji artwork', async () => {
  const svg = await admitted('twemoji');
  const cases: [EmojiTreatmentV1, string[], number][] = [
    [original, ['#000000', '#664500', '#ffcc4d', '#fff'], 0],
    [influence(2500), ['#1f1f1f', '#524116', '#d7c95d', '#fbfbfb'], 6],
    [influence(6500), ['#313a25', '#868686', '#8fc26e', '#f5f5f5'], 6],
    [snap, ['#0c322c', '#30ba78', '#efefef'], 6],
    [mono, ['#000000', '#165a39', '#72f1ac', '#ffffff'], 4],
    [duotone, ['#0c322c', '#667b77', '#cfd4d2', '#efefef'], 6],
  ];
  for (const [treatment, expected, changed] of cases) {
    const out = await applyEmojiTreatment(svg, treatment, meaning);
    assert.deepEqual(paintsIn(emojiSvgMarkup(out.svg)), expected, treatment.mode);
    assert.equal(out.diagnostics.paints, 6, treatment.mode);
    assert.equal(out.diagnostics.changed, changed, treatment.mode);
    assert.equal(out.diagnostics.protected, false);
    assert.equal(out.diagnostics.distinctBefore, 4);
    assert.equal(out.svg.normalizer, treatment.mode === 'original' ? 'static-svg-v1' : 'static-svg-v1+emoji-treatment-v1');
  }
  // The neutral gate keeps a grey off a saturated swatch: mono leaves black and
  // white where they were and only the two coloured paints move.
  assert.equal((await applyEmojiTreatment(svg, snap, meaning)).diagnostics.distinctAfter, 3);
});

test('every mode pins its hex output on the real OpenMoji artwork', async () => {
  const svg = await admitted('openmoji');
  const cases: [EmojiTreatmentV1, string[], number][] = [
    [original, ['#000000', '#ea5a47', '#fcea2b', '#ffffff'], 0],
    [influence(2500), ['#1f1f1f', '#cf7b54', '#d2df4e', '#fbfbfb'], 7],
    [influence(6500), ['#868686', '#8acc6a', '#96a067', '#f5f5f5'], 7],
    [snap, ['#30ba78', '#efefef'], 7],
    [mono, ['#000000', '#12ab6a', '#85ffbd', '#ffffff'], 2],
    [duotone, ['#0c322c', '#9ca8a5', '#dcdfde', '#efefef'], 7],
  ];
  for (const [treatment, expected, changed] of cases) {
    const out = await applyEmojiTreatment(svg, treatment, meaning);
    assert.deepEqual(paintsIn(emojiSvgMarkup(out.svg)), expected, treatment.mode);
    assert.equal(out.diagnostics.paints, 7, treatment.mode);
    assert.equal(out.diagnostics.changed, changed, treatment.mode);
  }
});

test('the same inputs give the same checksum twice, and the recipe is recorded as a change', async () => {
  const svg = await admitted('twemoji');
  for (const treatment of [influence(2500), snap, mono, duotone]) {
    const first = await applyEmojiTreatment(svg, treatment, meaning);
    const second = await applyEmojiTreatment(svg, treatment, meaning);
    assert.notEqual(first.svg, second.svg, 'a fresh handle each time');
    assert.equal(first.svg.checksum, second.svg.checksum, treatment.mode);
    assert.equal(first.svg.sourceChecksum, svg.sourceChecksum);
    assert.equal(digest(new TextEncoder().encode(emojiSvgMarkup(first.svg))), first.svg.checksum);
    const changes = emojiSvgChanges(first.svg);
    assert.ok(changes.includes(`Recoloured every paint with ${recipe} in ${treatment.mode} mode.`));
    assert.ok(changes.includes('Canonicalized SVG syntax and inline presentation styles.'), 'admission changes survive');
    assert.deepEqual(emojiSvgChanges(svg).length, changes.length - 1, 'the admitted handle is untouched');
  }
  // Each mode is its own result, so a census never confuses two treatments.
  const checksums = new Set<string>();
  for (const treatment of [original, influence(2500), influence(6500), snap, mono, duotone]) {
    checksums.add((await applyEmojiTreatment(svg, treatment, meaning)).svg.checksum);
  }
  assert.equal(checksums.size, 6);
});

test('protected meanings come back as the artwork that was admitted', async () => {
  const svg = await admitted('twemoji');
  const protectedMeanings: EmojiMeaningV1[] = [
    { kind: 'unicode', key: '1f44d-1f3fb' },
    { kind: 'unicode', key: '1f9d1-1f3ff-200d-1f4bb' },
    { kind: 'unicode', key: '1f1e6-1f1e9' },
    { kind: 'unicode', key: '1f3f4-e0067-e0062-e0073-e0063-e0074-e007f' },
    { kind: 'custom', id: 'acme/mark' },
  ];
  const treatments: EmojiTreatmentV1[] = [influence(6500), snap, mono, duotone];
  for (const guarded of protectedMeanings) {
    assert.equal(isProtectedEmojiMeaning(guarded), true, JSON.stringify(guarded));
    for (const treatment of treatments) {
      const out = await applyEmojiTreatment(svg, treatment, guarded);
      assert.equal(out.svg, svg, `${treatment.mode} on ${JSON.stringify(guarded)}`);
      assert.equal(out.svg.checksum, svg.checksum);
      assert.equal(out.diagnostics.protected, true);
      assert.equal(out.diagnostics.changed, 0);
      assert.equal(out.diagnostics.paints, 6);
    }
  }
  // A single regional indicator is a letter, not a flag, and a keycap is neither.
  assert.equal(isProtectedEmojiMeaning({ kind: 'unicode', key: '1f1e6' }), false);
  assert.equal(isProtectedEmojiMeaning({ kind: 'unicode', key: '0031-fe0f-20e3' }), false);
  assert.equal(isProtectedEmojiMeaning(meaning), false);
  // Turning a flag off treats that family and leaves the others alone.
  const unprotected = { ...snap, protect: { skinTones: false, flags: true, custom: true } } as EmojiTreatmentV1;
  const skin = await applyEmojiTreatment(svg, unprotected, protectedMeanings[0]!);
  assert.equal(skin.diagnostics.protected, false);
  assert.notEqual(skin.svg.checksum, svg.checksum);
  const flag = await applyEmojiTreatment(svg, unprotected, protectedMeanings[2]!);
  assert.equal(flag.diagnostics.protected, true);
  assert.equal(flag.svg, svg);
  // Mode original never recolours, protected or not.
  const plain = await applyEmojiTreatment(svg, original, meaning);
  assert.equal(plain.svg, svg);
  assert.equal(plain.diagnostics.protected, false);
});

test('palette order does not change the result', async () => {
  const svg = await admitted('twemoji');
  const orders = [
    [...palette].reverse(),
    [palette[2]!, palette[0]!, palette[3]!, palette[1]!],
    [palette[3]!, palette[1]!, palette[2]!, palette[0]!],
  ];
  for (const mode of ['snap', 'influence'] as const) {
    const base: EmojiTreatmentV1 = mode === 'snap' ? snap : influence(4000);
    const expected: string = (await applyEmojiTreatment(svg, base, meaning)).svg.checksum;
    for (const shuffled of orders) {
      const out = await applyEmojiTreatment(svg, { ...base, palette: shuffled } as EmojiTreatmentV1, meaning);
      assert.equal(out.svg.checksum, expected, mode);
    }
  }
  const twoTone = (await applyEmojiTreatment(svg, duotone, meaning)).svg.checksum;
  const swapped = await applyEmojiTreatment(svg, { ...duotone, palette: [palette[2]!, palette[1]!] } as EmojiTreatmentV1, meaning);
  assert.equal(swapped.svg.checksum, twoTone, 'duotone orders its pair by lightness, not by argument');
  // An unusable palette is a no-op rather than a guess.
  const empty = await applyEmojiTreatment(svg, { ...snap, palette: [] } as EmojiTreatmentV1, meaning);
  assert.equal(empty.svg, svg);
  assert.equal(empty.diagnostics.changed, 0);
});

test('paint none and local url references pass through untouched', async () => {
  const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36">'
    + '<defs><linearGradient id="g"><stop offset="0" stop-color="#ffcc4d"/><stop offset="1" stop-color="#664500"/></linearGradient></defs>'
    + '<path fill="url(#g)" stroke="none" d="M0,0H36V36H0z"/>'
    + '<rect x="0" y="0" width="36" height="36" fill="none" stroke="#ea5a47" stroke-width="2"/></svg>';
  const svg = await prepare(source);
  const out = await applyEmojiTreatment(svg, snap, meaning);
  const markup = emojiSvgMarkup(out.svg, 'placement-0');
  assert.match(markup, /<path d="[^"]+" fill="url\(#placement-0-g\)" stroke="none">/);
  assert.match(markup, /<rect fill="none" /);
  assert.deepEqual(paintsIn(markup), ['#0c322c', '#30ba78', '#efefef']);
  // Two stops and one stroke carry colour, plus the root's own default fill.
  assert.equal(out.diagnostics.paints, 4);
  assert.equal(out.diagnostics.changed, 4);
});

test('treated markup is admitted again as artwork and renders in resvg', async () => {
  for (const name of ['twemoji', 'openmoji']) {
    const svg = await admitted(name);
    const source = await fixture(name);
    const treated = await applyEmojiTreatment(svg, snap, meaning);
    const markup = emojiSvgMarkup(treated.svg);
    const bytes = new TextEncoder().encode(markup);
    // Feeding the treated bytes back through admission proves the recolour
    // stayed inside the static subset the engine accepts.
    source.manifest.glyphs[0]!.asset.checksum = digest(bytes);
    const { pack } = await admit(source.manifest);
    const again = await prepareEmojiSvg(pack, meaning, bytes, parseEmojiXml);
    assert.equal(again.ok, true, again.ok ? '' : again.message);
    if (!again.ok) continue;
    assert.deepEqual(paintsIn(emojiSvgMarkup(again.svg)), paintsIn(markup), `${name} keeps its treated paints`);
    // Byte-identical only where the artwork declares no local ids: a second
    // admission prefixes the ids the first one already prefixed. Twemoji's
    // grinning face has none, OpenMoji's carries id="emoji" on the root.
    if (name === 'twemoji') assert.equal(again.svg.checksum, treated.svg.checksum);
    const options = { fitTo: { mode: 'width' as const, value: 72 }, font: { loadSystemFonts: false } };
    const rendered = new Resvg(markup, options).render();
    assert.equal(rendered.width, 72);
    assert.ok(rendered.asPng().length > 0);
    const before = new Resvg(emojiSvgMarkup(svg), options).render();
    assert.notDeepEqual(rendered.pixels, before.pixels, `${name} recolour reaches the pixels`);
  }
});
