// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readLottie, selectLottie, writeDotLottie } from '../engine/src/dotlottie.ts';
import { compileLottieSequence, retimeLottie, type LottieSequence } from '../engine/src/lottie-sequence.ts';
import { storeZip, readZipMembers } from '../engine/src/zip.ts';
import { lottiePackage, movingLottie, nestedLottie } from './helpers/lottie-fixtures.ts';

test('v1 and v2 enumerate all choices and respect a non-first initial animation', () => {
  for (const version of ['1', '2'] as const) {
    const bytes = lottiePackage(version);
    const untouched = bytes.slice();
    const pkg = readLottie(bytes);
    assert.equal(pkg.version, version);
    assert.equal(pkg.animations.length, 2);
    assert.equal(selectLottie(pkg).id, 'animation-1');
    assert.equal(selectLottie(pkg, 'animation-0').durationMs, 2000);
    assert.deepEqual(bytes, untouched);
    assert.throws(() => selectLottie(pkg, 'missing'), /not in this source/);
  }
});
test('retiming changes frame times and ids, retaining time-remap seconds and original bytes', () => {
  const source = nestedLottie();
  const pristine = structuredClone(source);
  const retimed = retimeLottie(source, 60, 'test');
  assert.equal(retimed.ip, 24);
  assert.equal(retimed.op, 144);
  assert.equal(retimed.layers[0]!.refId, 'test-asset-0');
  assert.deepEqual(retimed.layers[0]!.tm, { a: 1, k: [{ t: 24, s: [0.4], e: [2.4], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } }, { t: 144, s: [2.4] }] });
  assert.deepEqual(source, pristine);
});
test('composition writes edited timing and namespaces colliding source assets into a v2 package', () => {
  const snapshot: LottieSequence = { width: 128, height: 64, fps: 30, durationMs: 2000, layers: [0, 1].map(i => ({
    name: `Clip ${i}`, x: i * 64, y: 0, w: 64, h: 64, rotation: 0, opacity: 1, startMs: i * 500, durationMs: 1000,
    content: { kind: 'animation', animation: nestedLottie(), clipInMs: 200, speed: 1.5, fit: 'contain' },
  })) };
  const animation = compileLottieSequence(snapshot);
  const bytes = writeDotLottie(animation);
  assert.deepEqual(bytes, writeDotLottie(animation));
  assert.equal(readLottie(bytes).animations[0]!.animation.layers.length, 2);
  assert.deepEqual(animation.layers.map(layer => [layer.ip, layer.op]), [[15, 45], [0, 30]]);
  assert.equal(new Set(animation.assets!.map(asset => asset.id)).size, animation.assets!.length);
  assert.ok(readZipMembers(bytes).every(entry => entry.method === 8));
});
test('bad manifests, external images, missing/cyclic references, expressions and themes fail specifically', () => {
  const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  assert.throws(() => readLottie(encode({ hello: 'world' })), /width/);
  assert.throws(() => readLottie(lottiePackage('2', undefined, { version: '3' })), /unsupported manifest version/);
  assert.throws(() => readLottie(storeZip([{ name: 'manifest.json', bytes: encode({ version: '2', animations: [{ id: 'missing' }] }) }])), /missing declared animation/);
  assert.throws(() => readLottie(lottiePackage('2', undefined, { animations: [{ id: 'animation-0', initialTheme: 'dark' }] })), /themed/);
  assert.throws(() => readLottie(lottiePackage('2', undefined, { initial: { animation: 'missing' } })), /initial animation is missing/);
  const source = movingLottie();
  source.layers[0]!.ks = { p: { a: 0, k: [0, 0], x: 'alert(1)' } };
  assert.throws(() => readLottie(encode(source)), /expressions/);
  const nested = nestedLottie();
  nested.assets![0]!.layers = nested.layers;
  assert.throws(() => readLottie(encode(nested)), /cyclic/);
  const image = movingLottie();
  image.assets = [{ id: 'image', w: 2, h: 2, p: 'https://example.test/image.png' }];
  assert.throws(() => readLottie(encode(image)), /unsafe/);
  const invalidRate = movingLottie(); invalidRate.fr = 0;
  assert.throws(() => readLottie(encode(invalidRate)), /frame rate/);
  const oversized = movingLottie(); oversized.w = 16385;
  assert.throws(() => readLottie(encode(oversized)), /width/);
  const nestedRates = nestedLottie(); nestedRates.assets![0]!.fr = 30;
  assert.throws(() => readLottie(encode(nestedRates)), /independently rated/);
  const tooDeep = movingLottie(); let object = tooDeep as Record<string, unknown>;
  for (let i = 0; i < 65; i++) { object.child = {}; object = object.child as Record<string, unknown>; }
  assert.throws(() => readLottie(encode(tooDeep)), /complexity/);
});
