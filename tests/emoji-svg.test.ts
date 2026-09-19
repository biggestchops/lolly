// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { Resvg } from '@resvg/resvg-js';
import { prepareEmojiSvg, emojiSvgMarkup, emojiSvgChanges } from '../engine/src/emoji-svg.ts';
import { svgPath } from '../engine/src/emoji-svg-syntax.ts';
import { admit, digest, fixture, fixtureLocks } from './helpers/emoji-fixtures.ts';
import { parseEmojiXml } from './helpers/emoji-xml.ts';

const meaning = { kind: 'unicode', key: '1f600' } as const;
const wrap = (body: string, attrs = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" ${attrs}>${body}</svg>`;
async function prepare(source: string, parser = parseEmojiXml) {
  const { manifest } = await fixture();
  const bytes = new TextEncoder().encode(source);
  manifest.glyphs[0]!.asset.checksum = digest(bytes);
  const { pack } = await admit(manifest);
  return prepareEmojiSvg(pack, meaning, bytes, parser);
}

test('canonical SVG preserves decoded source pixels for three real families at multiple sizes', async () => {
  for (const lock of fixtureLocks) {
    const input = await fixture(lock.directory);
    const result = await prepareEmojiSvg(input.pack, meaning, input.artwork, parseEmojiXml);
    assert.equal(result.ok, true, result.ok ? '' : result.message);
    if (!result.ok) continue;
    const svg = emojiSvgMarkup(result.svg);
    assert.equal(digest(new TextEncoder().encode(svg)), result.svg.checksum);
    for (const width of [24, 72, 256]) {
      const options = { fitTo: { mode: 'width' as const, value: width }, font: { loadSystemFonts: false } };
      const original = new Resvg(input.artwork, options).render();
      const canonical = new Resvg(svg, options).render();
      assert.deepEqual(canonical.pixels, original.pixels, `${lock.directory} at ${width}px`);
    }
    assert.throws(() => emojiSvgMarkup({ ...result.svg }), /Invalid prepared/);
    assert.throws(() => emojiSvgMarkup(result.svg, 'bad"id'), /prefix/);
    const changes = emojiSvgChanges(result.svg);
    changes.push('caller mutation');
    assert.ok(!emojiSvgChanges(result.svg).includes('caller mutation'));
  }
});

test('inline style precedence and repeated local gradients survive canonicalization', async () => {
  const result = await prepare(wrap('<defs><linearGradient id="g"><stop offset="0" stop-color="#000"/><stop offset="100%" stop-color="#fff"/></linearGradient></defs><path fill="#000" style="fill:url(#g);" d="M0,0H36V36H0z"/>'));
  assert.ok(result.ok);
  const first = emojiSvgMarkup(result.svg, 'placement-0');
  const second = emojiSvgMarkup(result.svg, 'placement-1');
  assert.match(first, /fill="url\(#placement-0-g\)"/);
  assert.match(second, /id="placement-1-g"/);
  assert.doesNotMatch(second, /placement-0|style=/);
});

test('the widened static subset admits Illustrator idioms faithfully and records every omission', async () => {
  // A hidden group whose gradient is still referenced from outside, a clip path
  // through a use reference (the Noto idiom), a CSS colour keyword, paint-order
  // and clip-rule, plus the inert enable-background, overflow, class and color
  // declarations Illustrator scatters over child elements.
  const source = wrap(
    '<defs><path id="shape" d="M4 4H32V32H4z"/><clipPath id="clip"><use xlink:href="#shape" style="overflow:visible;"/></clipPath></defs>'
    + '<g style="display:none"><linearGradient id="grad"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient><path d="M0 0H36V36H0z" fill="#f00"/></g>'
    + '<g style="enable-background:new    ;" class="layer" color="#123456"><rect x="0" y="0" width="36" height="36" fill="navy" clip-path="url(#clip)" clip-rule="evenodd" paint-order="stroke fill" stroke="green" stroke-width="2"/></g>'
    + '<circle cx="18" cy="18" r="6" style="fill:url(#grad);display:inline"/>'
    + '<path xmlns="http://www.w3.org/2000/svg" d="M1 1H3V3H1z" fill="#111"/>',
    'xmlns:xlink="http://www.w3.org/1999/xlink"',
  );
  const result = await prepare(source);
  assert.ok(result.ok, result.ok ? '' : result.message);
  const markup = emojiSvgMarkup(result.svg, 'p');
  assert.match(markup, /<clipPath id="p-clip"><use href="#p-shape"><\/use><\/clipPath>/);
  assert.match(markup, /clip-path="url\(#p-clip\)"/);
  assert.match(markup, /fill="#000080"/);
  assert.match(markup, /stroke="#008000"/);
  assert.match(markup, /clip-rule="evenodd"/);
  assert.match(markup, /paint-order="stroke fill"/);
  assert.match(markup, /<defs><linearGradient id="p-grad">/, 'the hidden group keeps its gradient in a definitions container');
  assert.doesNotMatch(markup, /fill="#f00"|display|overflow|class=| color=|enable-background|xlink/);
  const changes = emojiSvgChanges(result.svg);
  for (const expected of ['Canonicalized xlink:href to href.', 'Omitted elements hidden by display none.', 'Omitted inert display values.', 'Omitted inert enable-background; filters are unsupported.', 'Omitted inert overflow; no element here establishes a viewport.', 'Omitted class names; stylesheets are unsupported.', 'Omitted inert color; currentColor paint is unsupported.', 'Omitted a redundant xmlns on a child element.']) {
    assert.ok(changes.includes(expected), expected);
  }
  for (const width of [36, 144]) {
    const options = { fitTo: { mode: 'width' as const, value: width }, font: { loadSystemFonts: false } };
    assert.deepEqual(new Resvg(markup, options).render().pixels, new Resvg(source, options).render().pixels, `${width}px`);
  }
});

test('a real Noto clip-path glyph matches its source pixels through the widened subset', async () => {
  const { manifest, pack } = await fixture('noto');
  const glyph = manifest.glyphs.find(entry => entry.meaning.kind === 'unicode' && entry.meaning.key === '1f32a-fe0f')!;
  const artwork = await (await import('node:fs/promises')).readFile(new URL('./fixtures/emoji/noto/1f32a.svg', import.meta.url));
  const result = await prepareEmojiSvg(pack, glyph.meaning, artwork, parseEmojiXml);
  assert.ok(result.ok, result.ok ? '' : result.message);
  const markup = emojiSvgMarkup(result.svg);
  assert.match(markup, /<clipPath id="emoji-SVGID_2_"><use href="#emoji-SVGID_1_">/);
  assert.ok(emojiSvgChanges(result.svg).includes('Omitted inert enable-background; filters are unsupported.'));
  for (const width of [24, 72, 256]) {
    const options = { fitTo: { mode: 'width' as const, value: width }, font: { loadSystemFonts: false } };
    assert.deepEqual(new Resvg(markup, options).render().pixels, new Resvg(artwork, options).render().pixels, `${width}px`);
  }
});

test('unsafe, ambiguous and unsupported SVGs fail without returning partial artwork', async () => {
  const bad = [
    '<script>alert(1)</script>', '<image href="https://example.com/a.png"/>', '<use href="#a"/>',
    '<foreignObject/>', '<text>Hello</text>', '<style>path{fill:red}</style>', '<animate/>', '<filter/>', '<mask/>',
    '<clipPath><g/></clipPath>', '<g id="a"><use href="#a"/></g>', '<clipPath id="c"><use href="#missing"/></clipPath>',
    '<clipPath id="c"><use href="https://example.com/a.svg#s"/></clipPath>', '<clipPath id="c"><use/></clipPath>',
    '<linearGradient id="g"><stop offset="0" stop-color="#000"/></linearGradient><clipPath id="c"><use href="#g"/></clipPath>',
    '<path clip-path="url(#missing)" d="M0 0"/>', '<path clip-path="inset(1px)" d="M0 0"/>',
    '<path paint-order="fill fill" d="M0 0"/>', '<path paint-order="normal fill" d="M0 0"/>',
    '<path enable-background="accumulate" d="M0 0"/>', '<path fill="notacolour" d="M0 0"/>',
    '<path onclick="alert(1)" d="M0 0"/>',
    '<path fill="currentColor" d="M0 0"/>', '<path fill="var(--paint)" d="M0 0"/>',
    '<path fill="url(https://example.com/paint.svg#g)" d="M0 0"/>',
    '<path fill="url(#missing)" d="M0 0"/>', '<path id="a" d="M0 0"/><path id="a" d="M1 1"/>',
    '<path id="a" fill="url(#a)" d="M0 0"/>', '<path style="filter:blur(1px)" d="M0 0"/>',
    '<path style="fill:#000 !important" d="M0 0"/>', '<path d="M0 0L1"/>', '<path d="M0 0 garbage"/>',
    '<path d="M0 0L1e309 1"/>', '<path d="M0 0A1 1 0 2 0 1 1"/>',
    '<circle r="-1"/>', '<g transform="matrix(1 0 0 1 0)"/>', '<svg viewBox="0 0 36 36"/>',
    '<path xmlns="http://example.com/evil" d="M0 0"/>', '<g>unexpected text</g>',
    '<g>'.repeat(33) + '</g>'.repeat(33), '<g/>'.repeat(4096),
  ];
  for (const body of bad) {
    const result = await prepare(wrap(body));
    assert.equal(result.ok, false, body.slice(0, 100));
    assert.ok(!('svg' in result));
  }
  for (const source of [wrap('', 'width="99"'), wrap('').replace('0 0 36 36', '0 0 72 72'), wrap('<g>'), wrap('<path d="M0,,0"/>'), wrap('', 'display="none"'), wrap('', 'style="display:none"')]) assert.equal((await prepare(source)).ok, false);
});

test('integrity and dangerous declarations are rejected before invoking an XML parser', async () => {
  let calls = 0;
  const parser = (source: string) => { calls++; return parseEmojiXml(source); };
  const input = await fixture();
  const corrupt = new Uint8Array(input.artwork); corrupt[0] = 0;
  assert.equal((await prepareEmojiSvg(input.pack, meaning, corrupt, parser)).ok, false);
  assert.equal(calls, 0);
  for (const source of ['<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + wrap('&x;'), '<?xml-stylesheet href="https://example.com/a.css"?>' + wrap('')]) assert.equal((await prepare(source, parser)).ok, false);
  assert.equal(calls, 0);
  assert.equal((await prepare('<?xml version="1.0" encoding="utf-8"?>' + wrap('<circle r="2"/>'), parser)).ok, true);
  assert.equal(calls, 1);
});

test('path grammar checks complete commands and normalizes without approximating curves', () => {
  assert.equal(svgPath('M0,0c.1-.2 3 4 5 6z'), 'M 0 0 c 0.1 -0.2 3 4 5 6 z');
  assert.equal(svgPath('M0 0A1 2 30 0 1 3 4'), 'M 0 0 A 1 2 30 0 1 3 4');
  for (const input of ['L0 0', 'M0 0z1', 'M0 0L', 'M,0 0', 'M0 0,', 'M0 0A1 2 30 011 3', 'M0 0LNaN 1']) assert.throws(() => svgPath(input), Error, input);
});

test('Affinity headers, explicit rgb paints and local shape instances preserve pixels', async () => {
  const source = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n'
    + '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n'
    + wrap('<defs><path id="p" d="M2 2h12v12H2z"/></defs><use href="#p" x="2px" fill="rgb(252,194,27)"/>', 'width="100%" height="100%" xmlns:serif="http://www.serif.com/"');
  const result = await prepare(source, body => {
    assert.ok(!body.includes('<!DOCTYPE'), 'the parser never receives the external declaration');
    return parseEmojiXml(body);
  });
  assert.ok(result.ok, result.ok ? '' : result.message);
  for (const size of [24, 64, 256]) {
    const options = { fitTo: { mode: 'width' as const, value: size } };
    assert.deepEqual(new Resvg(emojiSvgMarkup(result.svg), options).render().pixels, new Resvg(source, options).render().pixels);
  }
  assert.ok(emojiSvgChanges(result.svg).some(change => change.includes('doctype')));
  for (const bad of [source.replace('svg11.dtd', 'other.dtd'), source.replace('svg11.dtd">', 'svg11.dtd" [<!ENTITY a "x">]>'), wrap('<use id="a" href="#a"/>'), wrap('<path fill="rgb(256,0,0)" d="M0 0"/>')]) {
    assert.equal((await prepare(bad)).ok, false);
  }
});

test('a fixed viewport without a viewBox is explicit and retains its pixels', async () => {
  const source = wrap('<circle cx="18" cy="18" r="12" fill="#abcdef"/>', 'width="36px" height="36px"').replace('viewBox="0 0 36 36"', '');
  const result = await prepare(source);
  assert.ok(result.ok, result.ok ? '' : result.message);
  assert.deepEqual(new Resvg(emojiSvgMarkup(result.svg)).render().pixels, new Resvg(source).render().pixels);
  assert.equal((await prepare(source.replace('width="36px"', 'width="37px"'))).ok, false);
});
