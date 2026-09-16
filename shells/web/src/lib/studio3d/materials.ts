// SPDX-License-Identifier: MPL-2.0
import * as THREE from 'three';
import { studioFinish } from '../../../../../engine/src/studio3d.ts';
import type { StudioSceneV1 } from '../../../../../packages/core/src/studio3d-v1.ts';
import type { StudioAsset } from './source.ts';

export function applyStudioMaterials(asset: StudioAsset, scene: StudioSceneV1): () => void {
  const changed = new Set<THREE.Material>();
  const slots = asset.info.slots;
  const overrides = scene.materials.overrides;
  const selected = new Set<number>();
  const bindings = scene.materials.bindings;
  const explicit = scene.materials.mode === 'pair' && !!(bindings?.a || bindings?.b);
  const roles = new Map<number, 'a' | 'b'>();
  if (explicit)
    for (const role of ['a', 'b'] as const) {
      const name = bindings?.[role];
      if (!name) continue;
      const index = slots.findIndex((slot, i) => slot.id === name || String(i + 1) === name);
      if (index < 0)
        throw new Error(`Material role ${role.toUpperCase()} names missing slot ${name}.`);
      if (roles.has(index)) throw new Error('Material roles A and B must name different slots.');
      roles.set(index, role);
    }
  if (scene.materials.mode === 'custom')
    for (const override of overrides) {
      const index = slots.findIndex(
        (slot, i) => slot.id === override.slot || String(i + 1) === override.slot
      );
      if (index < 0)
        throw new Error(`Material slot ${override.slot} does not exist in this object.`);
      if (selected.has(index))
        throw new Error(`Material slot ${override.slot} has more than one override.`);
      selected.add(index);
    }
  const cache = new Map<string, THREE.Material>();
  const alter = (original: THREE.Material, surface?: 'face' | 'bevel' | 'side'): THREE.Material => {
    const key = `${original.uuid}:${surface || ''}`;
    if (cache.has(key)) return cache.get(key)!;
    const index = Math.max(
      0,
      slots.findIndex((slot) => slot.id === original.name)
    );
    const override =
      scene.materials.mode === 'custom'
        ? overrides.find((o) => o.slot === original.name || o.slot === String(index + 1))
        : undefined;
    if (explicit && !roles.has(index)) return original;
    if (
      scene.source.kind === 'glb' &&
      (scene.materials.mode === 'source' || (scene.materials.mode === 'custom' && !override))
    )
      return original;
    const physical =
      original instanceof THREE.MeshPhysicalMaterial
        ? original.clone()
        : new THREE.MeshPhysicalMaterial();
    if (
      original instanceof THREE.MeshStandardMaterial &&
      !(original instanceof THREE.MeshPhysicalMaterial)
    ) {
      physical.color.copy(original.color);
      physical.map = original.map;
      physical.normalMap = original.normalMap;
      physical.roughnessMap = original.roughnessMap;
      physical.metalnessMap = original.metalnessMap;
      physical.aoMap = original.aoMap;
      physical.emissive.copy(original.emissive);
      physical.emissiveMap = original.emissiveMap;
      physical.roughness = original.roughness;
      physical.metalness = original.metalness;
      physical.side = original.side;
      physical.transparent = original.transparent;
      physical.opacity = original.opacity;
      physical.alphaMap = original.alphaMap;
      physical.alphaTest = original.alphaTest;
      physical.normalScale.copy(original.normalScale);
    }
    physical.name = original.name;
    const useB = explicit ? roles.get(index) === 'b' : index % 2 !== 0;
    const finish = studioFinish(useB ? scene.materials.finishB : scene.materials.finishA);
    physical.roughness = finish.roughness;
    physical.metalness = finish.metalness;
    physical.clearcoat = finish.clearcoat;
    if (scene.materials.mode === 'pair') {
      physical.color.set(useB ? scene.materials.colorB : scene.materials.colorA);
      physical.map = null;
      physical.roughnessMap = null;
      physical.metalnessMap = null;
    }
    if (override) {
      physical.color.set(override.color);
      physical.roughness = override.roughness;
      physical.metalness = override.metalness;
      physical.clearcoat = override.clearcoat;
      physical.map = null;
      physical.roughnessMap = null;
      physical.metalnessMap = null;
    }
    const surfaceFinish = surface && scene.materials.surfaces?.[useB ? 'b' : 'a'][surface];
    if (surfaceFinish && surfaceFinish !== 'inherit')
      Object.assign(physical, studioFinish(surfaceFinish));
    cache.set(key, physical);
    changed.add(physical);
    return physical;
  };
  for (const [mesh, original] of asset.originals)
    mesh.material = Array.isArray(original)
      ? original.map((material, i) =>
          alter(
            material,
            mesh.userData.studioSurfaces ? (['face', 'bevel', 'side'] as const)[i] : undefined
          )
        )
      : alter(original);
  return () => {
    for (const [mesh, original] of asset.originals) mesh.material = original;
    for (const material of changed) material.dispose();
  };
}
