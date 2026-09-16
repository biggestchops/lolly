// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { extrudeStudioShape } from '../shells/web/src/lib/studio3d/geometry.ts';
import {
  fitStudioObject,
  pickStudioFocus,
  placeStudioObject,
} from '../shells/web/src/lib/studio3d/camera.ts';
import { studioCamera } from '../shells/web/src/lib/studio3d/stage.ts';
import { buildStudioScene } from '../engine/src/studio3d.ts';

function rectangle(width: number, height: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(width, 0);
  s.lineTo(width, height);
  s.lineTo(0, height);
  s.closePath();
  return s;
}
test('bevel safeguards prevent single and double folds while preserving holes and separate surface groups', () => {
  for (const shape of [rectangle(0.02, 2), rectangle(0.02, 0.02)]) {
    const result = extrudeStudioShape(shape, 1, 0.15, 24);
    assert.ok(result.bevel > 0 && result.bevel < 0.01, String(result.bevel));
    assert.deepEqual(
      result.geometry.groups.map((g) => g.materialIndex),
      [0, 1, 2]
    );
    result.geometry.dispose();
  }
  const ring = rectangle(3, 3),
    hole = new THREE.Path();
  hole.moveTo(0.1, 0.1);
  hole.lineTo(0.1, 2.9);
  hole.lineTo(2.9, 2.9);
  hole.lineTo(2.9, 0.1);
  hole.closePath();
  ring.holes.push(hole);
  const result = extrudeStudioShape(ring, 1, 0.15, 24);
  assert.ok(result.bevel > 0 && result.bevel < 0.05);
  const mesh = new THREE.Mesh(
    result.geometry,
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  );
  mesh.updateMatrixWorld(true);
  assert.equal(
    new THREE.Raycaster(
      new THREE.Vector3(1.5, 1.5, 5),
      new THREE.Vector3(0, 0, -1)
    ).intersectObject(mesh).length,
    0
  );
  assert.ok(
    new THREE.Raycaster(
      new THREE.Vector3(0.05, 1.5, 5),
      new THREE.Vector3(0, 0, -1)
    ).intersectObject(mesh).length > 0
  );
  result.geometry.dispose();
  mesh.material.dispose();
});

test('fit accounts for transformed bounds and aspect; focus uses axial depth and misses stay unchanged', () => {
  const object = new THREE.Mesh(new THREE.BoxGeometry(3.25, 2, 1), new THREE.MeshBasicMaterial());
  for (const projection of ['perspective', 'orthographic'])
    for (const aspect of [0.3, 1, 2.8]) {
      const recipe = buildStudioScene({
        version: 1,
        values: { projection, position: { x: 5, y: 2, z: -2 }, transform: { scale: 4 } },
      });
      placeStudioObject(object, recipe);
      const fit = fitStudioObject(object, recipe, aspect);
      recipe.camera.target = fit.target.toArray();
      recipe.camera.zoom = fit.zoom;
      const camera = studioCamera(recipe, aspect);
      camera.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(object);
      for (const x of [bounds.min.x, bounds.max.x])
        for (const y of [bounds.min.y, bounds.max.y])
          for (const z of [bounds.min.z, bounds.max.z]) {
            const p = new THREE.Vector3(x, y, z).project(camera);
            assert.ok(
              Math.abs(p.x) <= 0.801 && Math.abs(p.y) <= 0.801,
              JSON.stringify({ projection, aspect, p })
            );
          }
      const depth = pickStudioFocus(object, recipe, aspect, 0, 0);
      assert.ok(depth !== null && depth > 0);
      assert.equal(pickStudioFocus(object, recipe, aspect, 5, 5), null);
    }
  object.geometry.dispose();
  object.material.dispose();
});
