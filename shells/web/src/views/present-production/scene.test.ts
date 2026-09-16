// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraCrop, readScene, layoutBoxes } from './scene.ts';
import { collectAssetRefs } from '../../bridge/asset-dependencies.ts';

test('saved scene clamps geometry and whitelists portable data', () => {
  const scene = readScene({ version: 1, layout: 'side', deviceId: 'private-device', stream: {},
    camera: { box: { x: 5000, y: -1, w: 320, h: 240 }, zoom: Infinity, focalX: -9 }, lower: { title: 'a'.repeat(200) } });
  assert.deepEqual(scene.camera.box, { x: 960, y: 0, w: 320, h: 240 });
  assert.equal(scene.camera.zoom, 1); assert.equal(scene.camera.focalX, 0);
  assert.equal(scene.lower.title.length, 90);
  assert.ok(!JSON.stringify(scene).includes('device'));
  assert.deepEqual(readScene(JSON.parse(JSON.stringify(scene))), scene);
  assert.equal(readScene({ version: 999, layout: 'camera' }).layout, 'inset');
  assert.deepEqual(readScene({ version: 1, camera: { box: { w: 1280, h: 720 } } }).camera.box,
    { x: 0, y: 0, w: 1280, h: 720 }, 'missing positions still fit a larger restored camera');
});

test('saved logo keeps its asset version alive without persisting a runtime URL', () => {
  const scene = readScene({ version: 1, logo: { asset: { id: 'user/logo', source: 'user', format: 'svg', version: 'v1', url: 'blob:runtime' } } });
  const refs = new Set<string>(); collectAssetRefs({ __presentation: scene }, refs);
  assert.deepEqual([...refs], ['user/logo:svg:v1']);
  assert.deepEqual(scene.logo.asset?.pin, { version: 'v1', format: 'svg' });
  assert.ok(!JSON.stringify(scene).includes('blob:'));
});

test('a received logo pin wins over stale resolved metadata', () => {
  const scene = readScene({ version: 1, logo: { asset: { id: 'user/imported', source: 'user',
    version: 'sender', format: 'png', pin: { version: 'receiver', format: 'svg' }, url: 'blob:receiver' } } });
  assert.deepEqual(scene.logo.asset, { id: 'user/imported', source: 'user', version: 'receiver',
    format: 'svg', pin: { version: 'receiver', format: 'svg' } });
});

test('camera crop remains independent of placement and preset switches', () => {
  const scene = readScene(), before = cameraCrop(1920, 1080, scene.camera.box, scene.camera);
  scene.camera.box.x = 0; scene.camera.box.y = 0;
  assert.deepEqual(cameraCrop(1920, 1080, scene.camera.box, scene.camera), before);
  assert.equal(before.w / before.h, 4 / 3);
  scene.camera.zoom = 2;
  const zoomed = cameraCrop(1920, 1080, scene.camera.box, scene.camera);
  assert.equal(zoomed.w, before.w / 2);
  scene.layout = 'side'; assert.equal(layoutBoxes(scene).content.w, 880);
  scene.layout = 'camera'; assert.equal(layoutBoxes(scene).camera.w, 1280);
  scene.layout = 'inset'; assert.equal(layoutBoxes(scene).camera, scene.camera.box);
  scene.camera.fit = 'contain'; scene.camera.zoom = 1;
  const fit = cameraCrop(1920, 1080, scene.camera.box, scene.camera);
  assert.equal(fit.w, 1920); assert.ok(fit.y < 0, 'negative source coordinates leave letterbox space');
});

test('prepared scenes retain pinned assets and discard nested collections and device state', () => {
  const source = { ...readScene(), camera: { ...readScene().camera, deviceId: 'private-camera' },
    logo: { ...readScene().logo, asset: { id: 'logo-two', source: 'user', format: 'png', version: 'revision-two', url: 'blob:private' } },
    prepared: [{ id: 'recursive', name: 'No nesting', scene: {} }] };
  const scene = readScene({ ...readScene(), prepared: [
    { id: 'opening', name: 'Opening', scene: source }, { id: 'opening', name: 'Duplicate', scene: {} },
    ...Array.from({ length: 20 }, (_, i) => ({ id: `scene-${i}`, name: 'Scene', scene: source })),
  ] });
  assert.ok(scene.prepared.length <= 8);
  assert.equal(scene.prepared.filter(item => item.id === 'opening').length, 1);
  const json = JSON.stringify(scene);
  assert.ok(!json.includes('private-camera')); assert.ok(!json.includes('blob:')); assert.ok(!json.includes('recursive'));
  const refs = new Set<string>(); collectAssetRefs({ __presentation: scene }, refs);
  assert.ok(refs.has('logo-two:png:revision-two'));
  assert.deepEqual(readScene(JSON.parse(json)), scene);
});
