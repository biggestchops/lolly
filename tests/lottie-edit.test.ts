// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendLottieEdit, applyLottieEdits, lottieLayers, lottieTracks, lottieLayerFrame, lottieRootFrame, type LottieEdit } from '../engine/src/lottie-edit.ts';
import { propertyKeys, sampleLottieProperty } from '../engine/src/lottie-properties.ts';
import { retimeLottie } from '../engine/src/lottie-sequence.ts';
import { movingLottie, nestedLottie } from './helpers/lottie-fixtures.ts';
import type { LottieObject } from '../engine/src/lottie-model.ts';
const target = { asset: '', index: 0 };
function track(source: ReturnType<typeof movingLottie>, id: string): LottieObject { return lottieTracks(source.layers[0]!).find(t => t.id === id)!.property; }

test('export separates position axes without changing motion, and names nonportable scale/anchor curves', async () => {
  const source = movingLottie();
  const revision = await appendLottieEdit(source, '', { target, kind: 'ease', track: 'p', frame: 12, dimension: 0, ease: [0.2, 0, 0.8, 1] });
  const edited = await applyLottieEdits(source, revision), original = structuredClone(edited);
  const output = retimeLottie(edited, 60, 'test');
  assert.deepEqual(edited, original);
  for (let frame = 0; frame < 72; frame += 0.125) {
    const expected = sampleLottieProperty(track(edited, 'p'), frame);
    for (const [d, id] of ['p.x', 'p.y'].entries()) assert.ok(Math.abs(sampleLottieProperty(track(output, id), frame * 60 / 24)[0]! - expected[d]!) < 1e-9);
  }
  for (const [id, name] of [['s', 'scale'], ['a', 'anchor']] as const) {
    const unsupported = structuredClone(edited);
    (unsupported.layers[0]!.ks as LottieObject)[id] = structuredClone(track(edited, 'p'));
    assert.throws(() => retimeLottie(unsupported, 30, 'test'), new RegExp(`Dot: independent ${name} axis curves`));
  }
  const spatial = structuredClone(edited), keys = propertyKeys(track(spatial, 'p'));
  keys[0]!.to = [0, 10, 0]; keys[0]!.ti = [0, -10, 0];
  assert.deepEqual(track(retimeLottie(spatial, 24, 'test'), 'p'), track(spatial, 'p'));
});

test('instance revisions preserve originals, references, independently eased dimensions and reset', async () => {
  const source = nestedLottie(), original = structuredClone(source), target = { asset: 'shared-id', index: 0 };
  const edits: LottieEdit[] = [
    { target, kind: 'layer', patch: { nm: 'Edited dot', hd: true, ip: 15, op: 55 } },
    { target, kind: 'key', track: 'p', frame: 10, value: [20, 32, 0] },
    { target, kind: 'ease', track: 'p', frame: 10, dimension: 0, ease: [0.2, 0, 0.7, 0.8] },
    { target, kind: 'value', track: 'shapes/1/c', value: [0, 0.5, 1, 1] },
  ];
  let encoded = '';
  for (const edit of edits) encoded = await appendLottieEdit(source, encoded, edit);
  const edited = await applyLottieEdits(source, encoded), untouched = await applyLottieEdits(source, '');
  assert.deepEqual(source, original); assert.deepEqual(untouched, original);
  assert.deepEqual(edited.layers, source.layers, 'precomp reference and time mapping remain intact');
  const child = (edited.assets![0]!.layers as LottieObject[])[0]!;
  assert.equal(child.nm, 'Edited dot'); assert.equal(child.hd, true);
  const keys = propertyKeys(lottieTracks(child).find(t => t.id === 'p')!.property);
  assert.deepEqual((keys[0]!.o as LottieObject).x, [0.2, 0.33, 0.33]);
  assert.equal(lottieLayers(edited)[1]!.depth, 1);
  const independent = await appendLottieEdit(source, encoded, { target, kind: 'layer', patch: { nm: 'Copy only' } });
  assert.equal(lottieLayers(await applyLottieEdits(source, independent))[1]!.name, 'Copy only');
  assert.equal(lottieLayers(await applyLottieEdits(source, encoded))[1]!.name, 'Edited dot');
});
test('key insertion subdivides each temporal curve without changing existing motion', async () => {
  const source = movingLottie(), property = track(source, 'p'), at = 31.75;
  const revision = await appendLottieEdit(source, '', { target, kind: 'key', track: 'p', frame: at, value: sampleLottieProperty(property, at) });
  const result = track(await applyLottieEdits(source, revision), 'p');
  assert.equal(propertyKeys(result).length, 3);
  for (let frame = 12; frame <= 60; frame += 0.125) {
    assert.ok(Math.abs(sampleLottieProperty(result, frame)[0]! - sampleLottieProperty(property, frame)[0]!) < 0.0001, `frame ${frame}`);
  }
  const deleted = await appendLottieEdit(source, revision, { target, kind: 'delete', track: 'p', frame: at });
  assert.equal(propertyKeys(track(await applyLottieEdits(source, deleted), 'p')).length, 2);
});
test('static tracks gain keys; scalar tracks, holds, separated position and terminal e values survive', async () => {
  const source = movingLottie();
  const transform = source.layers[0]!.ks as LottieObject;
  transform.p = { s: true, x: { a: 0, k: 12 }, y: { a: 0, k: 32 } };
  let revision = await appendLottieEdit(source, '', { target, kind: 'key', track: 'p.x', frame: 30, value: [40] });
  revision = await appendLottieEdit(source, revision, { target, kind: 'ease', track: 'p.x', frame: 12, dimension: 0, ease: 'hold' });
  let edited = await applyLottieEdits(source, revision);
  assert.deepEqual(sampleLottieProperty(track(edited, 'p.x'), 25), [12]);
  assert.deepEqual(sampleLottieProperty(track(edited, 'p.x'), 30), [40]);
  for (const frame of [12, 60]) revision = await appendLottieEdit(source, revision, { target, kind: 'delete', track: 'p.x', frame });
  edited = await applyLottieEdits(source, revision);
  assert.equal(track(edited, 'p.x').a, 0); assert.equal(track(edited, 'p.x').k, 40);
  const legacy = movingLottie(), keys = propertyKeys(track(legacy, 'p')); delete keys[1]!.s;
  const updated = await appendLottieEdit(legacy, '', { target, kind: 'key', track: 'p', frame: 24, value: [20, 32, 0] });
  assert.deepEqual(sampleLottieProperty(track(await applyLottieEdits(legacy, updated), 'p'), 60), [54, 32, 0]);
});
test('nested frame mapping uses offsets/stretch and remap seconds independently of parenting', () => {
  const source = nestedLottie(), child = lottieLayers(source)[1]!;
  assert.ok(Math.abs(lottieLayerFrame(source, child.ancestors, 35) - 35) < 1e-6);
  assert.equal(lottieRootFrame(source, child.ancestors, 35), null);
  delete source.layers[0]!.tm; source.layers[0]!.st = 5; source.layers[0]!.sr = 2;
  assert.equal(lottieLayerFrame(source, child.ancestors, 35), 15);
  assert.equal(lottieRootFrame(source, child.ancestors, 15), 35);
});
test('revisions refuse stale sources, arbitrary writes, malformed values and oversized input', async () => {
  const source = movingLottie(), revision = await appendLottieEdit(source, '', { target, kind: 'layer', patch: { nm: 'Renamed' } });
  await assert.rejects(applyLottieEdits(movingLottie(25), revision), /different source/);
  const payload = JSON.parse(revision);
  for (const edit of [
    { target, kind: 'layer', patch: { parent: 999 } },
    { target, kind: 'value', track: '__proto__', value: [0] },
    { target, kind: 'key', track: 'p', frame: null, value: [0, 0, 0] },
    { target, kind: 'key', track: 'p', frame: 20, value: [0] },
    { target, kind: 'layer', patch: { ip: 100 } },
    { target, kind: 'ease', track: 'p', frame: 12, dimension: 0, ease: [2, 0, 1, 1] },
  ]) await assert.rejects(applyLottieEdits(source, JSON.stringify({ ...payload, edits: [edit] })));
  await assert.rejects(applyLottieEdits(source, ' '.repeat(262145)), /256 KiB/);
  await assert.rejects(applyLottieEdits(source, JSON.stringify({ ...payload, edits: Array(513).fill(payload.edits[0]) })), /Invalid animation revision/);
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
});
test('spatial tangents survive key value/easing edits; unsupported subdivision is explicit', async () => {
  const source = movingLottie(), property = track(source, 'p'), key = propertyKeys(property)[0]!;
  key.to = [10, -30, 0]; key.ti = [-10, -30, 0];
  let revision = await appendLottieEdit(source, '', { target, kind: 'key', track: 'p', frame: 12, value: [12, 32, 0] });
  revision = await appendLottieEdit(source, revision, { target, kind: 'ease', track: 'p', frame: 12, dimension: 0, ease: [0, 0, 1, 1] });
  const edited = propertyKeys(track(await applyLottieEdits(source, revision), 'p'))[0]!;
  assert.deepEqual(edited.to, key.to); assert.deepEqual(edited.ti, key.ti);
  await assert.rejects(appendLottieEdit(source, revision, { target, kind: 'key', track: 'p', frame: 30, value: [30, 10, 0] }), /Spatial path subdivision/);
});
