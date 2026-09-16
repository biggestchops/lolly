// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { loadTool } from '../engine/src/loader.ts';
import { createRuntime } from '../engine/src/runtime.ts';
import { buildStudioScene, studioAnimated, studioLightMotion } from '../engine/src/studio3d.ts';
import {
  studioActiveValues,
  studioCameraEdit,
  studioFocusEdit,
  studioCollectionRows,
  studioCollectionSize,
} from '../engine/src/studio3d-collection.ts';
import { parseUrlState, serializeUrlState } from '../engine/src/url-mode.ts';
import { baseHost } from './helpers/host.ts';

const collection = {
  source: 'collection',
  activeSubject: 2,
  studio: 'warm',
  camera: { azimuth: 20, elevation: 14, fov: 29, zoom: 1.1 },
  subjects: [
    { name: '../Same name', kind: 'artwork', asset: 'user/a.svg', roleA: 'body', roleB: 'accent' },
    {
      name: '../Same name',
      kind: 'model',
      asset: 'user/b.glb',
      ownFraming: true,
      azimuth: 60,
      zoom: 0.9,
    },
  ],
};
test('collection edits inherit shared values and preserve explicit framing and role bindings', () => {
  const focus = studioFocusEdit(collection, 8);
  const focused = studioCollectionRows({ ...collection, subjects: focus.value });
  assert.equal(focused[1]!.values.focusDistance, 8);
  assert.equal(focused[0]!.values.focusDistance, undefined);
  const saved = structuredClone(collection);
  const rows = studioCollectionRows(collection);
  assert.deepEqual(
    rows.map((r) => r.filename),
    ['01-same-name.png', '02-same-name.png']
  );
  assert.equal(rows[0]!.values.artwork, 'user/a.svg');
  assert.equal(rows[1]!.values.modelAsset, 'user/b.glb');
  assert.equal(rows[0]!.values.materialSlotA, 'body');
  assert.deepEqual(studioActiveValues(collection), rows[1]!.values);
  const changed = studioCollectionRows({
    ...collection,
    studio: 'electric',
    camera: { ...collection.camera, azimuth: 10 },
  });
  assert.equal((changed[0]!.values.camera as any).azimuth, 10);
  assert.equal((changed[1]!.values.camera as any).azimuth, 60);
  assert.equal(changed[1]!.values.studio, 'electric');
  const edit = studioCameraEdit(collection, { azimuth: 45, elevation: 20, zoom: 1, fov: 30 });
  assert.equal(edit.id, 'subjects');
  assert.equal((edit.value as any[])[0], collection.subjects[0]);
  assert.equal((edit.value as any[])[1].azimuth, 45);
  assert.deepEqual(collection, saved);
  assert.throws(() => studioCollectionRows({ subjects: [] }), /at least one/);
  assert.throws(() => studioCollectionRows({ subjects: Array(25).fill({}) }), /24/);
  assert.throws(
    () => studioCollectionSize({ collectionSize: { width: 4096, height: 4096 } }),
    /12 million/
  );
});

test('the real tool resolves nested assets and preserves a collection through URL mode', async () => {
  const tool = await loadTool('3d-studio', (p) => readFile(join('community', p), 'utf8'));
  const host = baseHost({
    assets: { get: async (id: string) => ({ id, url: `/assets/${id}`, name: id }) },
  });
  const runtime = await createRuntime(tool, host, collection);
  const parsed = parseUrlState(
    serializeUrlState(runtime.getModel(), { keepUserIds: true }),
    tool.manifest
  );
  const reopened = await createRuntime(tool, host, parsed.values);
  const values = (rt: typeof runtime) =>
    Object.fromEntries(rt.getModel().map((i) => [i.id, i.value]));
  const before = studioCollectionRows(values(runtime));
  const after = studioCollectionRows(values(reopened));
  assert.equal((values(reopened).subjects as any[])[1].ownFraming, true);
  assert.deepEqual(
    after.map((row) => row.filename),
    before.map((row) => row.filename)
  );
  assert.deepEqual(
    after.map((row) => buildStudioScene({ version: 1, values: row.values })),
    before.map((row) => buildStudioScene({ version: 1, values: row.values }))
  );
  assert.equal(buildStudioScene({ version: 1, values: values(reopened) }).source.kind, 'glb');
  assert.match(reopened.getHydrated(), /Review collection/);
  await reopened.setInput('lightMotion', 'orbit');
  await reopened.setInput('duration', 6);
  assert.match(reopened.getHydrated(), /data-clip-ms="6000"/);
  runtime.destroy();
  reopened.destroy();
});

test('animated lights use saved clip timing and close their loop without moving the object', () => {
  for (const kind of ['orbit', 'breathe']) {
    const scene = buildStudioScene({
      version: 1,
      values: { motion: 'still', lightMotion: kind, lightMotionAmount: 0.6, duration: 8 },
    });
    assert.equal(studioAnimated(scene), true);
    assert.deepEqual(studioLightMotion(scene, 0), { angle: 0, strength: 1 });
    assert.deepEqual(studioLightMotion(scene, 1), studioLightMotion(scene, 0));
    assert.deepEqual(studioLightMotion(scene, 0.5, 4), studioLightMotion(scene, 0.25, 8));
    assert.notDeepEqual(studioLightMotion(scene, 0.25), studioLightMotion(scene, 0));
    assert.equal(scene.motion.kind, 'still');
  }
});
