// SPDX-License-Identifier: MPL-2.0
import * as THREE from 'three';
import {
  type StudioObjectBox,
  studioArrangementPivot,
} from '../../../../../engine/src/studio3d-arrangement.ts';
import { studioTime } from '../../../../../engine/src/studio3d.ts';
import type {
  StudioObjectV1,
  StudioSceneV1,
} from '../../../../../packages/core/src/studio3d-v1.ts';
import { studioCamera } from './stage.ts';

function lift(recipe: StudioSceneV1): number {
  return recipe.stage.pedestal && recipe.stage.output === 'scene' ? 0.3 : 0;
}

/** Pose one subject: authored rotation and scale, then ground contact or a free pivot. */
function placeObject(
  object: THREE.Object3D,
  spec: StudioObjectV1,
  recipe: StudioSceneV1,
  spin: number
): void {
  object.visible = spec.visible;
  object.rotation.set(
    ...(spec.transform.rotation.map(THREE.MathUtils.degToRad) as [number, number, number])
  );
  object.rotation.y += spin;
  object.scale.setScalar(spec.transform.scale);
  object.position.set(0, 0, 0);
  const bounds = new THREE.Box3().setFromObject(object);
  object.position.set(
    spec.transform.position[0],
    (spec.grounded ? -bounds.min.y + lift(recipe) : 0) + spec.transform.position[1],
    spec.transform.position[2]
  );
}

export function placeStudioObject(
  object: THREE.Object3D,
  recipe: StudioSceneV1,
  time = 0,
  seconds?: number
): void {
  placeObject(
    object,
    {
      id: 'object',
      name: 'Object',
      source: recipe.source,
      transform: recipe.transform,
      grounded: true,
      visible: true,
      bindings: { a: '', b: '' },
    },
    recipe,
    studioTime(recipe, time, seconds)
  );
  object.updateMatrixWorld(true);
}

/**
 * Place every subject under one root. A single object spins about its own axis, as before;
 * an arrangement turns as a group about the centre of its footprint at time zero.
 */
export function placeStudioScene(
  root: THREE.Object3D,
  placed: { object: THREE.Object3D; spec: StudioObjectV1 }[],
  recipe: StudioSceneV1,
  time = 0,
  seconds?: number
): StudioObjectBox[] {
  const spin = studioTime(recipe, time, seconds);
  const grouped = !!recipe.objects;
  root.rotation.set(0, 0, 0);
  root.position.set(0, 0, 0);
  for (const { object, spec } of placed) placeObject(object, spec, recipe, grouped ? 0 : spin);
  root.updateMatrixWorld(true);
  const boxes: StudioObjectBox[] = placed
    .filter(({ spec }) => spec.visible)
    .map(({ object, spec }) => {
      const bounds = new THREE.Box3().setFromObject(object);
      return {
        id: spec.id,
        name: spec.name,
        min: [bounds.min.x, bounds.min.y, bounds.min.z],
        max: [bounds.max.x, bounds.max.y, bounds.max.z],
      };
    });
  if (grouped && spin) {
    const [px, , pz] = studioArrangementPivot(boxes);
    for (const { object } of placed) object.position.sub(new THREE.Vector3(px, 0, pz));
    root.position.set(px, 0, pz);
    root.rotation.y = spin;
    root.updateMatrixWorld(true);
  }
  return boxes;
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
