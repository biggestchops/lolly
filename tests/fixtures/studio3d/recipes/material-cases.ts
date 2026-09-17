// SPDX-License-Identifier: MPL-2.0
/**
 * Material assignment cases for the pushed 3D Studio 0.4 pin (plan 265, task A2).
 *
 * generate.ts records these cases into materials.json, and
 * tests/studio3d-material-compat.test.ts records them again with today's code and
 * compares. Both use this module, so the recording cannot drift between them.
 *
 * Each case builds fresh synthetic assets the way source.ts builds them (a map of
 * mesh to original material, plus info.slots) and runs applyStudioMaterials:
 *   svg  two fresh MeshPhysicalMaterial paint slots, standing in for SVG artwork,
 *        words and the sample shapes (the studio owns these materials);
 *   glb  one MeshStandardMaterial with emissive, alpha and five maps, and one
 *        MeshPhysicalMaterial with transmission 0.8, sheen and a map (authored materials).
 * For every finish, in source, pair and custom modes (custom with two overrides, and
 * custom-one with a single numeric override), for scene and object outputs.
 */
import * as THREE from 'three';
import { buildStudioScene, STUDIO_FINISHES } from '../../../../engine/src/studio3d.ts';
import type { StudioFinish } from '../../../../packages/core/src/studio3d-v1.ts';
import { applyStudioMaterials } from '../../../../shells/web/src/lib/studio3d/materials.ts';
import type { StudioAsset } from '../../../../shells/web/src/lib/studio3d/source.ts';

export const MATERIAL_MODES = ['source', 'pair', 'custom', 'custom-one'] as const;
export const MATERIAL_OUTPUTS = ['scene', 'object'] as const;
export const MATERIAL_ASSETS = ['svg', 'glb'] as const;

export interface MaterialCase {
  finish: StudioFinish;
  mode: (typeof MATERIAL_MODES)[number];
  output: (typeof MATERIAL_OUTPUTS)[number];
  asset: (typeof MATERIAL_ASSETS)[number];
}

/** One recorded value: a number, a boolean, a name or hex colour, or null when absent. */
export type MaterialCell = number | boolean | string | null;

const TEXTURE_FIELDS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'emissiveMap',
  'alphaMap',
  'aoMap',
] as const;
const NUMBER_FIELDS = [
  'roughness',
  'metalness',
  'clearcoat',
  'clearcoatRoughness',
  'transmission',
  'ior',
  'thickness',
  'sheen',
  'sheenRoughness',
  'iridescence',
  'iridescenceIOR',
  'emissiveIntensity',
  'opacity',
  'alphaTest',
] as const;
const COLOR_FIELDS = ['color', 'sheenColor', 'emissive'] as const;

/** Column names of every recorded material row, in order. */
export const MATERIAL_FIELDS: readonly string[] = [
  'slot',
  'kept',
  'type',
  ...COLOR_FIELDS,
  ...NUMBER_FIELDS,
  'transparent',
  ...TEXTURE_FIELDS,
];

export function materialCases(): MaterialCase[] {
  const cases: MaterialCase[] = [];
  for (const finish of STUDIO_FINISHES)
    for (const mode of MATERIAL_MODES)
      for (const output of MATERIAL_OUTPUTS)
        for (const asset of MATERIAL_ASSETS) cases.push({ finish, mode, output, asset });
  return cases;
}

export function materialCaseName(c: MaterialCase): string {
  return `${c.asset} ${c.mode} ${c.output} ${c.finish}`;
}

const HARNESS_COLOURS = {
  colorA: '#30ba78',
  colorB: '#0c322c',
  background: '#0c322c',
  background2: '#30ba78',
};

function texture(name: string): THREE.Texture {
  const t = new THREE.Texture();
  t.name = name;
  return t;
}

interface Built {
  asset: StudioAsset;
  meshes: THREE.Mesh[];
  slots: string[];
  release(): void;
}

function build(kind: MaterialCase['asset']): Built {
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  if (kind === 'svg') {
    for (const color of [HARNESS_COLOURS.colorA, HARNESS_COLOURS.colorB]) {
      const material = new THREE.MeshPhysicalMaterial({ color, roughness: 0.4 });
      material.name = `paint:${color}`;
      materials.push(material);
    }
  } else {
    const maps = ['map', 'normal', 'roughness', 'metalness', 'emissive', 'alpha', 'ao'].map(
      texture
    );
    textures.push(...maps);
    const paint = new THREE.MeshStandardMaterial({
      color: '#c8a064',
      roughness: 0.6,
      metalness: 0.3,
      emissive: '#331100',
      emissiveIntensity: 2,
      transparent: true,
      opacity: 0.5,
      alphaTest: 0.1,
      map: maps[0]!,
      normalMap: maps[1]!,
      roughnessMap: maps[2]!,
      metalnessMap: maps[3]!,
      emissiveMap: maps[4]!,
      alphaMap: maps[5]!,
      aoMap: maps[6]!,
    });
    paint.name = 'Paint';
    const coatMap = texture('coat-map');
    textures.push(coatMap);
    const coat = new THREE.MeshPhysicalMaterial({
      color: '#88ccff',
      roughness: 0.1,
      metalness: 0,
      transmission: 0.8,
      thickness: 0.5,
      ior: 1.4,
      sheen: 0.6,
      sheenRoughness: 0.4,
      sheenColor: '#ffeecc',
      map: coatMap,
    });
    coat.name = 'Coat';
    materials.push(paint, coat);
  }
  const geometry = new THREE.BoxGeometry();
  const object = new THREE.Group();
  const meshes = materials.map((material) => {
    const mesh = new THREE.Mesh(geometry, material);
    object.add(mesh);
    return mesh;
  });
  const slots = materials.map((material) => material.name);
  const asset: StudioAsset = {
    object,
    originals: new Map<THREE.Mesh, THREE.Material | THREE.Material[]>(
      meshes.map((mesh, i) => [mesh, materials[i]!])
    ),
    info: {
      triangles: 12 * meshes.length,
      warnings: [],
      slots: materials.map((material, i) => ({
        id: material.name,
        label: `${i + 1}: ${material.name}`,
        color:
          material instanceof THREE.MeshStandardMaterial
            ? `#${material.color.getHexString()}`
            : '#ffffff',
      })),
    },
    dispose() {},
  };
  return {
    asset,
    meshes,
    slots,
    release() {
      geometry.dispose();
      for (const material of materials) material.dispose();
      for (const t of textures) t.dispose();
    },
  };
}

function sceneFor(c: MaterialCase, slots: string[]) {
  const next = STUDIO_FINISHES[(STUDIO_FINISHES.indexOf(c.finish) + 1) % STUDIO_FINISHES.length]!;
  const numeric = { slot: '1', color: '#ff5a36', roughness: 0.3, metalness: 0.6, clearcoat: 0.9 };
  const named = { slot: slots[1]!, color: '#2453ff', finish: c.finish };
  return buildStudioScene({
    version: 1,
    values: {
      ...HARNESS_COLOURS,
      ...(c.asset === 'svg'
        ? { source: 'artwork', artwork: { id: 'art', url: 'blob:art.svg', name: 'art.svg' } }
        : {
            source: 'model',
            modelAsset: { id: 'model', url: 'blob:model.glb', name: 'model.glb' },
          }),
      finishA: c.finish,
      finishB: next,
      materialMode: c.mode === 'custom-one' ? 'custom' : c.mode,
      materials: c.mode === 'custom' ? [numeric, named] : c.mode === 'custom-one' ? [numeric] : [],
      outputMode: c.output,
    },
  });
}

function hex(value: unknown): MaterialCell {
  return value instanceof THREE.Color ? value.getHexString() : null;
}

function cell(value: unknown): MaterialCell {
  return typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string'
    ? value
    : null;
}

function readField(material: THREE.Material, field: string): unknown {
  const value: unknown = Reflect.get(material, field);
  return value;
}

function row(slot: string, kept: boolean, material: THREE.Material): MaterialCell[] {
  return [
    slot,
    kept,
    material.type,
    ...COLOR_FIELDS.map((field) => hex(readField(material, field))),
    ...NUMBER_FIELDS.map((field) => cell(readField(material, field))),
    material.transparent,
    ...TEXTURE_FIELDS.map((field) => {
      const value = readField(material, field);
      return value instanceof THREE.Texture ? value.name : null;
    }),
  ];
}

/** Applies one case to fresh assets and returns one row per slot, in slot order. */
export function recordMaterialCase(c: MaterialCase): MaterialCell[][] {
  const built = build(c.asset);
  try {
    const scene = sceneFor(c, built.slots);
    const reset = applyStudioMaterials(built.asset, scene);
    const rows = built.meshes.map((mesh, i) => {
      const original = built.asset.originals.get(mesh);
      const material = mesh.material;
      if (Array.isArray(material)) throw new Error('A stand-in mesh holds one material.');
      return row(built.slots[i]!, material === original, material);
    });
    reset();
    for (const mesh of built.meshes)
      if (mesh.material !== built.asset.originals.get(mesh))
        throw new Error(`${materialCaseName(c)}: reset did not restore the original material.`);
    return rows;
  } finally {
    built.release();
  }
}
