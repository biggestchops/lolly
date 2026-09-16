// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildStudioScene } from '../engine/src/studio3d.ts';
import {
  radianceFormat,
  tryStoreRadianceUpload,
} from '../shells/web/src/lib/model-upload.ts';

test('the recipe carries generated and imported environments with background and blur bounds', () => {
  const room = buildStudioScene({ version: 1, values: { source: 'primitive' } });
  assert.deepEqual(room.environment, {
    intensity: 0.4,
    rotation: 0,
    kind: 'room',
    url: '',
    id: '',
    background: false,
    blur: 0.3,
  });
  for (const kind of ['softbox', 'window'])
    assert.equal(
      buildStudioScene({ version: 1, values: { environment: kind } }).environment.kind,
      kind
    );
  assert.equal(
    buildStudioScene({ version: 1, values: { environment: 'nope' } }).environment.kind,
    'room'
  );
  const imported = buildStudioScene({
    version: 1,
    values: {
      environment: 'image',
      environmentImage: { id: 'user/upload/studio.hdr', url: '/assets/studio.hdr' },
      environmentBackground: 'true',
      environmentBlur: 4,
      environmentIntensity: 9,
      environmentRotation: 90,
    },
  });
  assert.deepEqual(imported.environment, {
    intensity: 3,
    rotation: 90,
    kind: 'image',
    url: '/assets/studio.hdr',
    id: 'user/upload/studio.hdr',
    background: true,
    blur: 1,
  });
  // A generated studio never keeps a stale file reference; any kind may show behind the scene.
  const generated = buildStudioScene({
    version: 1,
    values: {
      environment: 'softbox',
      environmentImage: { id: 'x', url: '/x.hdr' },
      environmentBackground: true,
    },
  });
  assert.equal(generated.environment.url, '');
  assert.equal(generated.environment.background, true);
  assert.throws(
    () => buildStudioScene({ version: 1, values: { environment: 'image' } }),
    /Radiance \.hdr or OpenEXR \.exr/
  );
});

test('radiance uploads are admitted by content, never by a display image extension', async () => {
  const exr = new Uint8Array([0x76, 0x2f, 0x31, 0x01, 2, 0, 0, 0]);
  const hdr = new TextEncoder().encode('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 1\n');
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(radianceFormat(exr), 'exr');
  assert.equal(radianceFormat(hdr), 'hdr');
  assert.equal(radianceFormat(png), null);
  assert.equal(radianceFormat(new Uint8Array(1)), null);
  const stored: Record<string, unknown>[] = [];
  const host = {
    assets: {
      get: async (id: string) => ({ source: 'user' as const, id, url: `/u/${id}`, type: 'data' as const, format: 'hdr' }),
      _uploadUserAsset: async (record: Record<string, unknown>) => {
        stored.push(record);
      },
    },
  };
  assert.equal(await tryStoreRadianceUpload(host, new File([png], 'photo.png')), null);
  await assert.rejects(
    tryStoreRadianceUpload(host, new File([png], 'photo.hdr')),
    /display image and cannot light a scene/
  );
  await assert.rejects(
    tryStoreRadianceUpload(host, new File([], 'empty.exr')),
    /between 1 byte and 64 MB/
  );
  const ref = await tryStoreRadianceUpload(host, new File([hdr], 'Studio Sky.hdr'));
  assert.match(ref!.id, /^user\/upload\/.+-Studio_Sky\.hdr$/);
  assert.equal(stored.length, 1);
  assert.equal(stored[0]!.type, 'data');
  assert.equal(stored[0]!.format, 'hdr');
  assert.deepEqual((stored[0]!.meta as Record<string, unknown>).projection, 'equirectangular');
  const exrRef = await tryStoreRadianceUpload(host, new File([exr], 'light.exr', { type: 'image/x-exr' }));
  assert.equal(stored[1]!.format, 'exr');
  assert.ok(exrRef);
});

test('generated environments are named, brand-tinted ones rebuild with the palette, and any kind can show behind the scene', () => {
  for (const kind of ['studio', 'gallery', 'warehouse', 'stage', 'desert', 'synthwave'])
    assert.equal(buildStudioScene({ version: 1, values: { environment: kind } }).environment.kind, kind);
  const shown = buildStudioScene({ version: 1, values: { environment: 'synthwave', environmentBackground: true, environmentBlur: 0 } });
  assert.equal(shown.environment.background, true);
  assert.equal(shown.environment.blur, 0);
});
