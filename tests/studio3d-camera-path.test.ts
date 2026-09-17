// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { loadTool } from '../engine/src/loader.ts';
import { createRuntime } from '../engine/src/runtime.ts';
import {
  STUDIO_CAMERA_KEY_LIMIT,
  studioAddCameraKey,
  studioCameraFromKey,
  studioCameraKeyLabel,
  studioCameraPose,
  studioCameraTravels,
  studioRestPose,
} from '../engine/src/studio3d-camera-path.ts';
import { buildStudioScene, studioAnimated } from '../engine/src/studio3d.ts';
import { parseUrlState, serializeUrlState } from '../engine/src/url-mode.ts';
import { baseHost } from './helpers/host.ts';

const keys = [
  { at: 0, azimuth: 0, elevation: 10, fov: 30, zoom: 1, panX: 0, panY: 1.6, panZ: 0 },
  { at: 50, azimuth: 90, elevation: 30, fov: 40, zoom: 0.8, panX: 1, panY: 2, panZ: -1 },
  { at: 100, azimuth: 180, elevation: 10, fov: 30, zoom: 1.2, panX: 0, panY: 1.6, panZ: 0 },
];

test('a still camera or fewer than two keys holds the rest pose', () => {
  const scene = buildStudioScene({ version: 1, values: { camera: { azimuth: 33, zoom: 1.4 } } });
  assert.equal(studioCameraTravels(scene), false);
  assert.equal(studioAnimated(scene), false);
  assert.deepEqual(studioCameraPose(scene, 0.5), studioRestPose(scene));
  assert.equal(studioCameraPose(scene, 0.5).azimuth, 33);
  const one = buildStudioScene({
    version: 1,
    values: { cameraMotion: 'keys', cameraKeys: [keys[0]], camera: { azimuth: 33 } },
  });
  assert.equal(studioCameraTravels(one), false);
  assert.equal(studioCameraPose(one, 0.7).azimuth, 33, 'one key is not a move');
});

test('keys sample deterministically, ease per leg, flow through, and close the loop on request', () => {
  const scene = buildStudioScene({
    version: 1,
    values: { cameraMotion: 'keys', cameraKeys: keys, duration: 4 },
  });
  assert.equal(studioCameraTravels(scene), true);
  assert.equal(studioAnimated(scene), true);
  assert.equal(scene.motion.kind, 'still', 'a camera path does not spin the object');
  const at = (t: number, clip?: number) => studioCameraPose(scene, t, clip);
  assert.deepEqual(at(0), { ...at(0), azimuth: 0, elevation: 10, zoom: 1 });
  assert.equal(at(0.5).azimuth, 90);
  assert.deepEqual(at(0.25), at(0.25));
  assert.deepEqual(at(0.5, 8), at(1, 4), 'clip seconds map onto the loop the same way');
  assert.equal(at(0.25).azimuth, 45, 'smooth easing passes the midpoint of a leg at its middle');
  assert.ok(at(0.1).azimuth < 18 && at(0.1).azimuth > 0, 'smooth easing starts slowly');
  assert.equal(at(1).azimuth, 180);
  const linear = buildStudioScene({
    version: 1,
    values: { cameraMotion: 'keys', cameraKeys: keys, cameraEase: 'linear' },
  });
  assert.ok(Math.abs(studioCameraPose(linear, 0.1).azimuth - 18) < 1e-9);
  const flow = buildStudioScene({
    version: 1,
    values: { cameraMotion: 'keys', cameraKeys: keys, cameraEase: 'flow' },
  });
  assert.equal(studioCameraPose(flow, 0.5).azimuth, 90, 'flow passes through every key');
  assert.notEqual(studioCameraPose(flow, 0.25).elevation, studioCameraPose(linear, 0.25).elevation);
  const loop = buildStudioScene({
    version: 1,
    values: { cameraMotion: 'keys', cameraKeys: keys.slice(0, 2).map((k, i) => ({ ...k, at: i * 50 })), cameraLoop: true },
  });
  assert.equal(studioCameraPose(loop, 1).azimuth, 0, 'the loop returns to the first key');
  assert.equal(studioCameraPose(loop, 0.5).azimuth, 90);
  const partial = buildStudioScene({
    version: 1,
    values: {
      cameraMotion: 'keys',
      cameraKeys: [
        { ...keys[0], focusDistance: 4 },
        { ...keys[1], focusDistance: 0 },
      ],
    },
  });
  assert.equal(studioCameraPose(partial, 0.5).focus, 0, 'a leg touching automatic focus stays automatic');
  assert.throws(
    () =>
      buildStudioScene({
        version: 1,
        values: { cameraKeys: Array(STUDIO_CAMERA_KEY_LIMIT + 1).fill(keys[0]) },
      }),
    /up to 12 keys/
  );
});

test('the live view becomes a key, keys are spaced evenly, and a key restores the view', () => {
  const values = {
    camera: { azimuth: 40, elevation: 20, fov: 35, zoom: 0.9, panX: 0.5, panY: -0.2, panZ: 0 },
    target: { x: 0, y: 1.6, z: 0 },
    focusDistance: 3,
    cameraKeys: [{ at: 0, azimuth: 0, elevation: 10, fov: 30, zoom: 1, panX: 0, panY: 1.6, panZ: 0 }],
  };
  const added = studioAddCameraKey(values);
  assert.equal(added.id, 'cameraKeys');
  const rows = added.value as Record<string, number>[];
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0]!.at, rows[1]!.at], [0, 100]);
  assert.deepEqual(
    [rows[1]!.azimuth, rows[1]!.zoom, rows[1]!.panX, rows[1]!.panY, rows[1]!.focusDistance],
    [40, 0.9, 0.5, 1.4, 3]
  );
  const three = studioAddCameraKey({ ...values, cameraKeys: rows }).value as Record<string, number>[];
  assert.deepEqual(three.map((r) => r.at), [0, 50, 100]);
  const back = studioCameraFromKey({ ...values, cameraKeys: rows }, 1);
  assert.deepEqual(back[0], {
    id: 'camera',
    value: { azimuth: 40, elevation: 20, fov: 35, zoom: 0.9, panX: 0.5, panY: -0.2, panZ: 0 },
  });
  assert.deepEqual(back[1], { id: 'focusDistance', value: 3 });
  assert.throws(() => studioCameraFromKey(values, 5), /does not exist/);
  assert.throws(
    () => studioAddCameraKey({ cameraKeys: Array(STUDIO_CAMERA_KEY_LIMIT).fill({}) }),
    /up to 12 keys/
  );
});

test('a key name is the reader\'s own label, and a named key can be recalled by that name', () => {
  const scene = buildStudioScene({
    version: 1,
    values: {
      cameraMotion: 'keys',
      cameraKeys: [
        { ...keys[0], name: '  Hero  ' },
        { ...keys[1], name: 'W'.repeat(60) },
        keys[2],
      ],
    },
  });
  const path = scene.cameraMotion!.keys;
  assert.equal(path[0]!.name, 'Hero', 'a name is trimmed');
  assert.equal(path[1]!.name!.length, 40, 'a name is capped at 40 characters');
  assert.equal('name' in path[2]!, false, 'an unnamed key carries no name at all');
  // A path saved before naming existed evaluates to exactly the fields it always had.
  const plain = buildStudioScene({ version: 1, values: { cameraMotion: 'keys', cameraKeys: keys } });
  assert.deepEqual(Object.keys(plain.cameraMotion!.keys[0]!).sort(), [
    'at',
    'azimuth',
    'elevation',
    'focus',
    'fov',
    'target',
    'zoom',
  ]);
  assert.deepEqual(studioCameraPose(scene, 0.25), studioCameraPose(plain, 0.25), 'names do not move the camera');

  const values = {
    camera: { azimuth: 40, elevation: 20, fov: 35, zoom: 0.9, panX: 0, panY: 0, panZ: 0 },
    target: { x: 0, y: 1.6, z: 0 },
    cameraKeys: [{ ...keys[0], name: 'Hero' }, keys[1]],
  };
  assert.deepEqual(studioCameraFromKey(values, 'hero'), studioCameraFromKey(values, 0), 'letter case does not matter');
  assert.throws(() => studioCameraFromKey(values, 'Nowhere'), /does not exist/);
  assert.throws(() => studioCameraFromKey(values, '   '), /does not exist/, 'an empty name matches no key');
  assert.equal(studioCameraKeyLabel(values, 0), 'Key 1 of 2: Hero');
  assert.equal(studioCameraKeyLabel(values, 1), 'Key 2 of 2');
});

/**
 * Go to key, the preview's own control, on the real hydrated template: each press asks
 * the shell for the next key's view and says which key that is. The renderer is a stub,
 * because the button only reads values and writes inputs (plan 265 milestone 3, F2).
 */
test('Go to key steps through the saved views and names the one it reached', async () => {
  const tool = await loadTool('3d-studio', (p) => readFile(join('community', p), 'utf8'));
  const runtime = await createRuntime(tool, baseHost(), {
    cameraMotion: 'keys',
    cameraKeys: [{ ...keys[0]!, name: 'Hero' }, keys[1]!],
  });
  const { window } = new JSDOM(`<body>${runtime.getHydrated()}</body>`);
  const previous = globalThis.document;
  globalThis.document = window.document;
  try {
    const { syncStudioControls } = await import('../shells/web/src/lib/studio3d/controls.ts');
    const marker = window.document.querySelector('[data-lolly-studio]')!;
    const values = {
      cameraMotion: 'keys',
      cameraKeys: [{ ...keys[0], name: 'Hero' }, keys[1]],
      camera: {},
      target: { x: 0, y: 1.6, z: 0 },
    };
    const edits: { id: string; value: unknown }[] = [];
    const entry = {
      canvas: window.document.createElement('canvas'),
      marker,
      handle: { highlight() {}, showLightHandles() {}, fit: () => null },
      ready: true,
      recipe: buildStudioScene({ version: 1, values }),
      inputValues: values,
      inputCamera: {},
      options: { setInput: (id: string, value: unknown) => edits.push({ id, value }) },
      render() {},
    };
    syncStudioControls(entry as never);
    const go = marker.querySelector('[data-studio-go-key]') as HTMLButtonElement;
    const note = () => marker.querySelector('[data-studio-camera-note]')?.textContent;
    assert.ok(go, 'the camera path group offers Go to key');
    assert.equal(go.disabled, false);
    go.click();
    assert.deepEqual(edits, studioCameraFromKey(values, 0));
    assert.equal(note(), 'Key 1 of 2: Hero. Turn Play path off to hold this view.');
    edits.length = 0;
    go.click();
    assert.deepEqual(edits, studioCameraFromKey(values, 1));
    assert.equal(note(), 'Key 2 of 2. Turn Play path off to hold this view.');
    edits.length = 0;
    go.click();
    assert.deepEqual(edits, studioCameraFromKey(values, 0), 'the last key wraps round to the first');
  } finally {
    globalThis.document = previous;
    runtime.destroy();
  }
});

test('the real tool carries a camera path through URL mode and reports the clip length', async () => {
  const tool = await loadTool('3d-studio', (p) => readFile(join('community', p), 'utf8'));
  const host = baseHost();
  const runtime = await createRuntime(tool, host, {
    cameraMotion: 'keys',
    cameraKeys: keys.map((key, i) => (i === 1 ? { ...key, name: 'Hero shot' } : key)),
    duration: 6,
  });
  assert.match(runtime.getHydrated(), /data-clip-ms="6000"/);
  assert.match(runtime.getHydrated(), /data-studio-play aria-pressed="true"/);
  assert.match(runtime.getHydrated(), /data-studio-go-key/);
  const parsed = parseUrlState(serializeUrlState(runtime.getModel()), tool.manifest);
  const reopened = await createRuntime(tool, host, parsed.values);
  const values = Object.fromEntries(reopened.getModel().map((i) => [i.id, i.value]));
  const scene = buildStudioScene({ version: 1, values });
  assert.equal(scene.cameraMotion?.keys.length, 3);
  assert.equal(scene.cameraMotion?.keys[1]?.name, 'Hero shot', 'a key name travels in the link');
  assert.equal(studioCameraPose(scene, 0.5).azimuth, 90);
  await reopened.setInput('cameraMotion', 'still');
  assert.match(reopened.getHydrated(), /data-clip-ms="0"/);
  assert.match(reopened.getHydrated(), /data-studio-play aria-pressed="false"/);
  runtime.destroy();
  reopened.destroy();
});
