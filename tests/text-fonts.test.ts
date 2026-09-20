// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { TextFontResourceV1, TextShapeRunRequestV1 } from '@lolly-tools/core';
import { createPinnedTextShaper } from '../packages/node-shell/src/text-fonts.ts';
import { sfntToWoff } from '../engine/src/font-convert.ts';
const bytes = readFileSync('shells/web/public/fonts/SUSE[wght].ttf');
const resource = (data: Uint8Array = bytes): TextFontResourceV1 => ({ id: 'suse', family: 'SUSE', faceIndex: 0,
  sha256: createHash('sha256').update(data).digest('hex'), source: { kind: 'bundled', path: '/fonts/SUSE[wght].ttf' } });
const request = (font = resource()): TextShapeRunRequestV1 => ({ font, text: 'Office e\u0301', start: 7, direction: 'ltr', script: 'Latn', language: 'en', size: 32 });
test('pinned font reads deduplicate, metadata is isolated, and weight changes the actual outlines', async () => {
  let reads = 0;
  const shaper = createPinnedTextShaper(async () => { reads++; return bytes; });
  const [info, ordinary] = await Promise.all([shaper.fontInfo(resource()), shaper.shapeRun(request())]);
  assert.equal(reads, 1);
  assert.equal(info.axes.wght?.default, 100); assert.ok(info.features.includes('liga'));
  assert.ok(info.coverage.some(([a, b]) => a <= 65 && b >= 65));
  const bold = await shaper.shapeRun({ ...request(), axes: { wght: 700 } });
  assert.equal(bold.font.axes.wght, 700); assert.notDeepEqual(bold.clusters, ordinary.clusters);
  assert.deepEqual(await shaper.shapeRun(request()), ordinary);
  info.axes.wght!.default = 123; info.coverage.length = 0;
  assert.equal((await shaper.fontInfo(resource())).axes.wght?.default, 100);
  shaper.clear(); await shaper.fontInfo(resource()); assert.equal(reads, 2);
});
test('changed content, absent faces and unsupported settings fail before a usable layout is returned', async () => {
  const shaper = createPinnedTextShaper(async () => bytes);
  await assert.rejects(shaper.fontInfo({ ...resource(), sha256: '0'.repeat(64) }), { code: 'font-changed' });
  await assert.rejects(shaper.fontInfo({ ...resource(), faceIndex: 1 }), { code: 'font-face' });
  await assert.rejects(shaper.shapeRun({ ...request(), axes: { wght: 9999 } }), { code: 'font-axis' });
  await assert.rejects(shaper.shapeRun({ ...request(), axes: { XXXX: 1 } }), { code: 'font-axis' });
  await assert.rejects(shaper.shapeRun({ ...request(), features: { 'liga[0:2]': 1 } }), { code: 'shape-feature' });
});
test('compressed font identity pins the original bytes and retains sfnt shape geometry', async () => {
  const compressed = sfntToWoff(bytes);
  const plain = await createPinnedTextShaper(async () => bytes).shapeRun(request());
  const packed = await createPinnedTextShaper(async () => compressed).shapeRun(request(resource(compressed)));
  assert.equal(packed.font.sha256, resource(compressed).sha256);
  assert.deepEqual(packed.clusters, plain.clusters); assert.equal(packed.advance, plain.advance);
  const malicious = compressed.slice(); new DataView(malicious.buffer).setUint32(16, 0xffffffff);
  await assert.rejects(createPinnedTextShaper(async () => malicious).fontInfo(resource(malicious)), { code: 'font-size' });
});
test('clearing a pending font load prevents that old load from repopulating the cache', async () => {
  let release!: () => void, reads = 0;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const shaper = createPinnedTextShaper(async () => { reads++; await wait; return bytes; });
  const old = shaper.fontInfo(resource()); shaper.clear(); release(); await old;
  await shaper.fontInfo(resource()); assert.equal(reads, 2);
});

test('named instances are read from the same pinned face and shape their recorded coordinates',async()=>{
  const shaper=createPinnedTextShaper(async()=>bytes),info=await shaper.fontInfo(resource());assert.ok(info.instances?.length);
  const bold=info.instances.find(instance=>instance.axes.wght===700);assert.ok(bold);assert.match(bold.name,/bold/i);
  const output=await shaper.shapeRun({...request(),axes:bold.axes});assert.equal(output.font.axes.wght,700);
});
