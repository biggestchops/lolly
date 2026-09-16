// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { subsetWithSkera, type SkeraWasm } from '@lolly-tools/node-shell/font-subset-wasm';
import { createFontSubsetter } from './font-subset.ts';
import { parseSfnt } from './export-pdf-sfnt.ts';
import { canEmbedPdfSubset } from './pdf-font-policy.ts';

const font = new Uint8Array(readFileSync(new URL('../../public/fonts/Outfit[wght].ttf', import.meta.url)));
const wasmBytes = readFileSync(new URL(import.meta.resolve('@lolly-tools/node-shell/skera.wasm')));

test('shipped Skera subsets a real variable face, preserving glyph addresses and composite dependencies', async () => {
  const { instance } = await WebAssembly.instantiate(wasmBytes);
  const wasm = instance.exports as unknown as SkeraWasm;
  const original = parseSfnt(font)!;
  const ids = [...'AéÅHi'].map(char => original.gidFor(char.codePointAt(0)!));
  const bytes = subsetWithSkera(wasm, font, ids);
  const subset = parseSfnt(bytes)!;
  assert.ok(bytes.length < font.length / 2);
  for (const id of ids) assert.equal(subset.advance(id), original.advance(id));
  assert.equal(subset.gidFor(0xe9), original.gidFor(0xe9));
  assert.ok(subset.tables.has('gvar'), 'variable data survives the default-instance policy');
  assert.deepEqual(subsetWithSkera(wasm, font, [...ids].reverse()), bytes);
  assert.throws(() => subsetWithSkera(wasm, new Uint8Array([1, 2, 3]), [0]), /could not subset/);
  assert.deepEqual(subsetWithSkera(wasm, font, ids), bytes, 'invalid input does not poison subsequent work');
});

test('subset cache keys include font content and glyphs, and returned bytes cannot mutate it', async () => {
  let calls = 0;
  const service = createFontSubsetter(async () => new Uint8Array([++calls]));
  const first = await service.subset(font, [1, 2]);
  first[0] = 99;
  assert.deepEqual(await service.subset(font, [2, 1, 0]), new Uint8Array([1]));
  await service.subset(font, [3]);
  const changed = font.slice(); changed[changed.length - 1] = changed[changed.length - 1]! ^ 1;
  await service.subset(changed, [1, 2]);
  assert.equal(calls, 3);
  assert.equal(service.stats().pendingBytes, 0);
});

test('cancellation retains the worker slot until it settles; queued cancellation does no work', async () => {
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  const service = createFontSubsetter(async () => { calls++; started(); await gate; return new Uint8Array([1]); });
  const active = new AbortController(), queued = new AbortController();
  const first = service.subset(font, [1], active.signal);
  const firstRejected = assert.rejects(first, { name: 'AbortError' });
  await ready;
  const second = service.subset(font, [2], queued.signal);
  const secondRejected = assert.rejects(second, { name: 'AbortError' });
  active.abort(); queued.abort();
  assert.equal(service.stats().pending, 1);
  assert.equal(service.stats().active, true);
  release(); await Promise.all([firstRejected, secondRejected]);
  assert.equal(calls, 1);
  assert.equal(service.stats().pendingBytes, 0);
  assert.equal(service.stats().cacheEntries, 0);
});

test('admission bounds waiting fonts and failed subsets are retryable', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const service = createFontSubsetter(async () => { await gate; throw new Error('failed'); });
  const requests = Array.from({ length: 8 }, (_, id) => assert.rejects(service.subset(font, [id]), /failed/));
  await assert.rejects(service.subset(font, [9]), /queue is full/);
  release(); await Promise.all(requests);
  assert.equal(service.stats().pending, 0);
  await assert.rejects(service.subset(font, [0]), /failed/);
});

test('embedding restrictions, no-subsetting, bitmap-only and unknown permissions decline PDF subsetting', () => {
  assert.equal(canEmbedPdfSubset(font), true);
  const sfnt = parseSfnt(font)!;
  const table = sfnt.tables.get('OS/2')!;
  for (const flags of [2, 0x100, 0x200]) {
    const copy = font.slice();
    new DataView(copy.buffer).setUint16(table.off + 8, flags, false);
    assert.equal(canEmbedPdfSubset(copy), false);
  }
  assert.equal(canEmbedPdfSubset(new Uint8Array([1, 2, 3])), false);
});
