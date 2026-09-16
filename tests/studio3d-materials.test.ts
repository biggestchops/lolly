// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { buildStudioScene, STUDIO_FINISHES, studioFinish } from '../engine/src/studio3d.ts';
import { applyStudioMaterials } from '../shells/web/src/lib/studio3d/materials.ts';
import type { StudioAsset } from '../shells/web/src/lib/studio3d/source.ts';

test('studio overrides preserve untouched GLB materials, texture ownership and physical features', () => {
  const paint = new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    clearcoat: 0.7,
    transmission: 0.2,
  });
  paint.name = 'paint';
  const glass = new THREE.MeshPhysicalMaterial({ transmission: 1, roughness: 0.05 });
  glass.name = 'glass';
  const texture = new THREE.Texture();
  paint.map = texture;
  const geometry = new THREE.BoxGeometry();
  const a = new THREE.Mesh(geometry, paint),
    b = new THREE.Mesh(geometry, glass);
  const object = new THREE.Group();
  object.add(a, b);
  const asset: StudioAsset = {
    object,
    originals: new Map([
      [a, paint],
      [b, glass],
    ]),
    info: {
      triangles: 24,
      warnings: [],
      slots: [
        { id: 'paint', label: 'Paint', color: '#ffffff' },
        { id: 'glass', label: 'Glass', color: '#ffffff' },
      ],
    },
    dispose() {},
  };
  const scene = (extra: Record<string, unknown>) =>
    buildStudioScene({
      version: 1,
      values: { source: 'model', modelAsset: { url: 'blob:model.glb' }, ...extra },
    });
  try {
    const reset = applyStudioMaterials(
      asset,
      scene({
        materialMode: 'custom',
        materials: [{ slot: 'paint', color: '#ff0000', metalness: 0.4 }],
      })
    );
    assert.equal(b.material, glass);
    assert.notEqual(a.material, paint);
    assert.equal(a.material.transmission, 0.2);
    assert.equal(a.material.map, null);
    assert.equal(paint.map, texture);
    assert.equal(a.material.color.getHexString(), 'ff0000');
    reset();
    assert.equal(a.material, paint);
    const bound = applyStudioMaterials(
      asset,
      scene({ materialMode: 'pair', materialSlotB: 'paint', colorB: '#0000ff', finishB: 'metal' })
    );
    assert.equal(a.material.color.getHexString(), '0000ff');
    assert.equal(a.material.metalness, 1);
    assert.equal(b.material, glass);
    bound();
    assert.throws(
      () =>
        applyStudioMaterials(
          asset,
          scene({ materialMode: 'pair', materialSlotA: 'paint', materialSlotB: '1' })
        ),
      /different slots/
    );
    assert.throws(
      () => applyStudioMaterials(asset, scene({ materialMode: 'pair', materialSlotA: 'missing' })),
      /missing slot/
    );
    assert.equal(b.material, glass);
    const unchanged = applyStudioMaterials(asset, scene({ materialMode: 'custom', materials: [] }));
    assert.equal(a.material, paint);
    assert.equal(b.material, glass);
    unchanged();
    assert.throws(
      () =>
        applyStudioMaterials(
          asset,
          scene({ materialMode: 'custom', materials: [{ slot: 'paint' }, { slot: '1' }] })
        ),
      /more than one/
    );
    assert.equal(a.material, paint);
  } finally {
    geometry.dispose();
    paint.dispose();
    glass.dispose();
    texture.dispose();
  }
});

test('face, bevel and side finishes retain both source colours and restore original materials', () => {
  const originals = ['#30ba78', '#0c322c'].map((color, i) => {
    const m = new THREE.MeshPhysicalMaterial({ color });
    m.name = `paint-${i}`;
    return m;
  });
  const meshes = originals.map((m) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), [m, m, m]);
    mesh.userData.studioSurfaces = true;
    return mesh;
  });
  const asset: StudioAsset = {
    object: new THREE.Group(),
    originals: new Map(meshes.map((m) => [m, m.material])),
    info: {
      slots: originals.map((m) => ({
        id: m.name,
        label: m.name,
        color: '#' + m.color.getHexString(),
      })),
      triangles: 24,
      warnings: [],
    },
    dispose() {},
  };
  const recipe = buildStudioScene({
    version: 1,
    values: {
      surfaceFinishes: true,
      faceFinishA: 'matte',
      bevelFinishA: 'enamel',
      sideFinishA: 'metal',
      faceFinishB: 'metal',
      bevelFinishB: 'matte',
      sideFinishB: 'satin',
    },
  });
  const restore = applyStudioMaterials(asset, recipe);
  for (const [i, mesh] of meshes.entries())
    for (const m of mesh.material)
      assert.equal(m.color.getHexString(), originals[i]!.color.getHexString());
  assert.equal(meshes[0]!.material[0]!.roughness, 0.8);
  assert.equal(meshes[0]!.material[1]!.clearcoat, 0.6);
  assert.equal(meshes[0]!.material[2]!.metalness, 1);
  assert.equal(meshes[1]!.material[0]!.metalness, 1);
  assert.equal(meshes[1]!.material[1]!.roughness, 0.8);
  restore();
  for (const [i, mesh] of meshes.entries()) {
    assert.equal(mesh.material[0], originals[i]);
    mesh.geometry.dispose();
  }
  for (const material of originals) material.dispose();
});

test('every finish resolves to a physical description and the new ones set what they promise', () => {
  for (const finish of STUDIO_FINISHES) {
    const spec = studioFinish(finish);
    assert.ok(spec.roughness >= 0 && spec.roughness <= 1 && spec.metalness >= 0 && spec.metalness <= 1, finish);
  }
  assert.ok(studioFinish('glow').emissive! > 0 && studioFinish('neon').emissive! > studioFinish('glow').emissive!);
  assert.equal(studioFinish('velvet').sheen, 1);
  assert.equal(studioFinish('glass').transmission, 1);
  assert.ok(studioFinish('frosted').roughness > studioFinish('glass').roughness);
  assert.equal(studioFinish('chrome').metalness, 1);
  assert.ok(studioFinish('iridescent').iridescence === 1 && studioFinish('pearl').clearcoat === 1);
  assert.equal(studioFinish('matte').emissive, undefined);
  const scene = buildStudioScene({
    version: 1,
    values: { materialMode: 'custom', materials: [{ slot: '1', color: '#ff0000', finish: 'glow' }, { slot: '2', color: '#00ff00', finish: 'satin' }, { slot: '3', finish: 'nope' }] },
  });
  assert.deepEqual(scene.materials.overrides.map((o) => o.finish), ['glow', undefined, undefined]);
  assert.equal(buildStudioScene({ version: 1, values: { finishA: 'velvet', finishB: 'glass' } }).materials.finishA, 'velvet');
});
