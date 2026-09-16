// SPDX-License-Identifier: MPL-2.0
import * as THREE from 'three';
import { studioTime } from '../../../../../engine/src/studio3d.ts';
import type { StudioSceneV1 } from '../../../../../packages/core/src/studio3d-v1.ts';
import { studioCamera } from './stage.ts';

export function placeStudioObject(
  object: THREE.Object3D,
  recipe: StudioSceneV1,
  time = 0,
  seconds?: number
): void {
  object.rotation.set(
    ...(recipe.transform.rotation.map(THREE.MathUtils.degToRad) as [number, number, number])
  );
  object.rotation.y += studioTime(recipe, time, seconds);
  object.scale.setScalar(recipe.transform.scale);
  object.position.set(0, 0, 0);
  const bounds = new THREE.Box3().setFromObject(object);
  object.position.set(
    recipe.transform.position[0],
    -bounds.min.y +
      recipe.transform.position[1] +
      (recipe.stage.pedestal && recipe.stage.output === 'scene' ? 0.3 : 0),
    recipe.transform.position[2]
  );
  object.updateMatrixWorld(true);
}

/** Fit the transformed subject with a ten-percent border at this output aspect ratio. */
export function fitStudioObject(
  object: THREE.Object3D,
  recipe: StudioSceneV1,
  aspect: number
): { zoom: number; target: THREE.Vector3 } {
  const box = new THREE.Box3().setFromObject(object),
    target = box.getCenter(new THREE.Vector3());
  const camera = studioCamera(recipe, aspect),
    inverse = camera.quaternion.clone().invert();
  const tangent = Math.tan(THREE.MathUtils.degToRad(recipe.camera.fov / 2));
  let distance = 0,
    zoom = 3;
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) {
        const p = new THREE.Vector3(x, y, z).sub(target).applyQuaternion(inverse);
        distance = Math.max(
          distance,
          p.z + Math.max(Math.abs(p.y), Math.abs(p.x) / aspect) / (tangent * 0.8)
        );
        zoom = Math.min(
          zoom,
          2.4 / Math.max(1e-6, Math.abs(p.y)),
          (2.4 * aspect) / Math.max(1e-6, Math.abs(p.x))
        );
      }
  if (recipe.camera.projection === 'perspective') zoom = 11.3 / distance;
  if (zoom < 0.05) throw new Error('Use a wider image or reduce the object scale to fit this view.');
  return { zoom: Math.max(0.05, Math.min(3, zoom)), target };
}

/** Focus is axial distance to the lens plane, not the longer off-axis ray distance. */
export function pickStudioFocus(
  object: THREE.Object3D,
  recipe: StudioSceneV1,
  aspect: number,
  x: number,
  y: number
): number | null {
  const camera = studioCamera(recipe, aspect);
  camera.updateMatrixWorld(true);
  object.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(x, y), camera);
  const hit = ray.intersectObject(object, true)[0];
  if (!hit) return null;
  const depth = hit.point.sub(camera.position).dot(camera.getWorldDirection(new THREE.Vector3()));
  return Math.max(0.01, Math.min(500, depth));
}
