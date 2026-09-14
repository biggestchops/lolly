// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { Resvg } from '@resvg/resvg-js';
import goldens from './fixtures/emoji/line.golden.json' with { type: 'json' };
import { compileEmojiLine } from '../engine/src/emoji-line.ts';
import { createTextAPI } from '../shells/web/src/bridge/text.ts';
import { emojiLineFixture, nodeEmojiText, emojiRenderResources, renderLock } from './helpers/emoji-render.ts';
import { fixtureLocks, digest } from './helpers/emoji-fixtures.ts';

test('real outlined text and emoji produce a repeatable master with a source census', async () => {
  for (const lock of fixtureLocks) {
    const input = await emojiLineFixture(lock.directory);
    let loads = 0;
    const host = { ...input.host, loadArtwork: async () => { loads++; return input.artwork; } };
    const first = await compileEmojiLine(input.options, [input.pack], host);
    assert.ok(first.ok, first.ok ? '' : first.message);
    const second = await compileEmojiLine(input.options, [input.pack], input.host);
    assert.deepEqual(second, first);
    const { master } = first;
    assert.equal(loads, 1, 'Repeated glyph artwork is admitted once per line');
    assert.equal(master.sources.length, 1);
    assert.equal(master.sources[0]!.occurrences.length, 2);
    assert.deepEqual(master.sources[0]!.source, input.manifest.glyphs[0]!.source);
    assert.equal(master.sources[0]!.artworkChecksum, digest(input.artwork));
    assert.equal(master.recipe.font.checksum, renderLock.font.checksum);
    assert.equal(master.checksum, digest(new TextEncoder().encode(master.svg)));
    const raster = new Resvg(master.svg, { font: { loadSystemFonts: false } }).render();
    assert.deepEqual({ svg: master.checksum, rgba: digest(raster.pixels), width: raster.width, height: raster.height }, goldens[lock.directory as keyof typeof goldens]);
    assert.doesNotMatch(master.svg, /<text(?:\s|>)|<image(?:\s|>)|font-family|href=/);
    assert.match(master.svg, /&amp; &lt;3<\/title>/);
    assert.equal(master.runs.length, 5);
    assert.ok(master.runs[2]!.advance > 0, 'The isolated space between emoji must advance');
    for (const run of master.runs) {
      if (run.kind === 'emoji') assert.equal(input.options.text.slice(run.start, run.end), '😀');
    }
    if (lock.directory === 'noto') {
      assert.match(master.svg, /id="emoji-1-face_1_"/);
      assert.match(master.svg, /id="emoji-3-face_1_"/);
    }
  }
});

test('both text adapters opt in to real whitespace advances without changing legacy results', async () => {
  const { font } = await emojiRenderResources();
  const fontUrl = `data:font/ttf;base64,${font.toString('base64')}`;
  const actual = [];
  for (const api of [nodeEmojiText, createTextAPI()]) {
    const options = { text: '  ', fontUrl, fontSize: 48, clusters: true };
    assert.deepEqual(await api.toPath(options), { d: '', advanceWidth: 0, bbox: null, notdef: 0, clusters: [] });
    const result = await api.toPath({ ...options, preserveWhitespaceAdvance: true });
    assert.equal(result.d, ''); assert.equal(result.bbox, null); assert.equal(result.notdef, 0);
    assert.ok(result.advanceWidth > 0);
    assert.equal(result.clusters?.length, 2);
    assert.deepEqual(result.clusters?.map(cluster => [cluster.start, cluster.end]), [[0, 1], [1, 2]]);
    actual.push(result);
  }
  assert.deepEqual(actual[0], actual[1]);
});

test('unsupported clusters, missing saved pins, bidi and multi-line inputs fail before host IO', async () => {
  const input = await emojiLineFixture();
  const host = { ...input.host, loadArtwork: async () => { throw new Error('Unexpected artwork IO'); }, text: { toPath: async () => { throw new Error('Unexpected text IO'); } } };
  for (const [text, code] of [['😀\u200d😀', 'unsupported-sequence'], ['🙂', 'glyph-unavailable'], ['A\nB', 'unsupported-layout'], ['مرحبا 😀', 'unsupported-layout'], ['a\u2067b', 'unsupported-layout']]) {
    const result = await compileEmojiLine({ ...input.options, text: text! }, [input.pack], host);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, code);
    assert.ok(!('master' in result));
  }
  const missing = await compileEmojiLine(input.options, [], host);
  assert.ok(!missing.ok); assert.equal(missing.code, 'pack-unavailable');
});

test('corrupt fonts, unsupported artwork and uncovered text never emit a partial master', async () => {
  const input = await emojiLineFixture();
  const font = new Uint8Array(input.options.font.bytes); font[100] = font[100]! ^ 1;
  const corrupt = await compileEmojiLine({ ...input.options, font: { ...input.options.font, bytes: font } }, [input.pack], input.host);
  assert.ok(!corrupt.ok); assert.equal(corrupt.code, 'integrity-mismatch');
  const badArt = await compileEmojiLine(input.options, [input.pack], { ...input.host, loadArtwork: async () => new TextEncoder().encode('<svg/>') });
  assert.ok(!badArt.ok); assert.equal(badArt.code, 'unsupported-artwork');
  const uncovered = await compileEmojiLine({ ...input.options, text: '漢 😀' }, [input.pack], input.host);
  assert.ok(!uncovered.ok); assert.equal(uncovered.code, 'text-glyph-unavailable');
  const legacy = await compileEmojiLine({ ...input.options, text: '😀 😀' }, [input.pack], { ...input.host, text: { toPath: async () => ({ d: '', advanceWidth: 0, bbox: null, notdef: 0 }) } });
  assert.ok(!legacy.ok); assert.equal(legacy.code, 'invalid-text-metrics');
});

test('font bytes, selection and pack collection are snapshotted before asynchronous work', async () => {
  const input = await emojiLineFixture();
  const expected = await compileEmojiLine(input.options, [input.pack], input.host);
  const options = structuredClone(input.options);
  const packs = [input.pack];
  const pending = compileEmojiLine(options, packs, input.host);
  options.font.bytes.fill(0); options.style.primary.pin.version = 'unavailable'; packs.length = 0;
  assert.deepEqual(await pending, expected);
});
