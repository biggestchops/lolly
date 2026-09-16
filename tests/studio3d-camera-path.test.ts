// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadTool } from '../engine/src/loader.ts';
import { createRuntime } from '../engine/src/runtime.ts';
import {
  STUDIO_CAMERA_KEY_LIMIT,
  studioAddCameraKey,
  studioCameraFromKey,
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

test('the real tool carries a camera path through URL mode and reports the clip length', async () => {
  const tool = await loadTool('3d-studio', (p) => readFile(join('community', p), 'utf8'));
  const host = baseHost();
  const runtime = await createRuntime(tool, host, {
    cameraMotion: 'keys',
    cameraKeys: keys,
    duration: 6,
  });
  assert.match(runtime.getHydrated(), /data-clip-ms="6000"/);
  assert.match(runtime.getHydrated(), /data-studio-play aria-pressed="true"/);
  const parsed = parseUrlState(serializeUrlState(runtime.getModel()), tool.manifest);
  const reopened = await createRuntime(tool, host, parsed.values);
  const values = Object.fromEntries(reopened.getModel().map((i) => [i.id, i.value]));
  const scene = buildStudioScene({ version: 1, values });
  assert.equal(scene.cameraMotion?.keys.length, 3);
  assert.equal(studioCameraPose(scene, 0.5).azimuth, 90);
  await reopened.setInput('cameraMotion', 'still');
  assert.match(reopened.getHydrated(), /data-clip-ms="0"/);
  assert.match(reopened.getHydrated(), /data-studio-play aria-pressed="false"/);
  runtime.destroy();
  reopened.destroy();
});
