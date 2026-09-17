// SPDX-License-Identifier: MPL-2.0
/**
 * Writes the pinned 3D Studio recipe and material fixtures (plan 265, tasks A1 and A2).
 *
 *   node tests/fixtures/studio3d/recipes/generate.ts             # recipes and materials
 *   node tests/fixtures/studio3d/recipes/generate.ts --recipes   # only the recipe files
 *   node tests/fixtures/studio3d/recipes/generate.ts --materials # only materials.json
 *
 * The fixtures record what the pushed 3D Studio 0.4.0 (commit 05faef7a4) evaluates.
 * This script imports today's code, so it first checks that the code it pins is still
 * the pushed code, and refuses to write otherwise:
 *   recipes    git diff --quiet 05faef7a4 -- engine/src packages/core/src
 *   materials  git diff --quiet 05faef7a4 -- shells/web/src/lib/studio3d/materials.ts engine/src/studio3d.ts
 * Once the studio code moves past that commit the script stops by design: the files
 * are a record of the pushed output, not something to regenerate after a change.
 *
 * Each recipe file is { source, era, values, scene }. `values` is the whole value set a
 * saved session carries: the manifest defaults of its era (0.3.0 from d7b4593dd, 0.4.0
 * from 05faef7a4), with brand colour tokens replaced by the browser harness colours,
 * then the set's own values. Asset URLs name the harness routes (/fixture.svg,
 * /duck.glb, /binary.stl, /light.hdr), so tests/studio3d-compat.browser.test.ts can
 * render the same values. `scene` is buildStudioScene(values) at the pushed commit.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildInputModel,
  type InputManifest,
  modelToValues,
} from '../../../../engine/src/inputs.ts';
import { buildStudioScene } from '../../../../engine/src/studio3d.ts';
import { MATERIAL_FIELDS, materialCases, recordMaterialCase } from './material-cases.ts';

export const PINNED_COMMIT = '05faef7a4';
export const MANIFEST_03_COMMIT = 'd7b4593dd';

const here = import.meta.dirname;
const root = resolve(here, '..', '..', '..', '..');

type Values = Record<string, unknown>;
type Era = '0.3' | '0.4';

/** The browser harness colours (tests/helpers/studio3d-browser.ts). */
const HARNESS = {
  colorA: '#30ba78',
  colorB: '#0c322c',
  background: '#0c322c',
  background2: '#30ba78',
};
/** Both manifests default colour A to the secondary token and colour B to the primary. */
const TOKENS: Record<string, string> = {
  '{color.semantic.primary}': HARNESS.colorB,
  '{color.semantic.secondary}': HARNESS.colorA,
};

const ART = { id: 'fixture', url: '/fixture.svg', name: 'fixture.svg' };
const DUCK = { id: 'duck', url: '/duck.glb', name: 'duck.glb' };
const STL = { id: 'binary', url: '/binary.stl', name: 'binary.stl' };
const HDR = { id: 'light', url: '/light.hdr', name: 'light.hdr' };

interface ManifestInput {
  id: string;
  fields?: { id: string; default?: unknown }[];
}

function git(args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  });
}

function manifest(commit: string): InputManifest {
  const parsed: InputManifest = JSON.parse(
    git(['show', `${commit}:community/3d-studio/tool.json`])
  );
  return parsed;
}

function inputsOf(m: InputManifest): ManifestInput[] {
  return (m.inputs ?? []).map((input) => ({
    id: input.id,
    fields: input.fields?.map((field) => ({ id: field.id, default: field.default })),
  }));
}

function resolveTokens(value: unknown): unknown {
  if (typeof value === 'string' && value.startsWith('{')) {
    const colour = TOKENS[value];
    if (!colour) throw new Error(`No harness colour for the token ${value}.`);
    return colour;
  }
  if (Array.isArray(value)) return value.map(resolveTokens);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveTokens(v)]));
  return value;
}

/** The values the runtime hands the hooks for a fresh document, restricted to declared inputs. */
function defaults(m: InputManifest): Values {
  const declared = new Set((m.inputs ?? []).map((input) => input.id));
  const all = modelToValues(buildInputModel(m));
  const out: Values = {};
  for (const [id, value] of Object.entries(all)) if (declared.has(id)) out[id] = value;
  return { ...(resolveTokens(out) as Values), ...HARNESS };
}

/** A block row with every declared field, defaults first. */
function rowOf(m: InputManifest, inputId: string, values: Values): Values {
  const input = inputsOf(m).find((i) => i.id === inputId);
  if (!input?.fields) throw new Error(`The manifest has no block input ${inputId}.`);
  const row: Values = {};
  for (const field of input.fields) row[field.id] = field.default ?? null;
  for (const key of Object.keys(values))
    if (!input.fields.some((field) => field.id === key))
      throw new Error(`${inputId} has no field ${key}.`);
  return { ...row, ...values };
}

interface ValueSet {
  id: string;
  era: Era;
  values: Values;
}

function sets03(m: InputManifest): ValueSet[] {
  const base = defaults(m);
  const finishes = ['matte', 'satin', 'enamel', 'metal'];
  const set = (id: string, values: Values): ValueSet => ({
    id: `03-${id}`,
    era: '0.3',
    values: { ...base, ...values },
  });
  const light = (values: Values) => rowOf(m, 'lights', values);
  const override = (values: Values) => rowOf(m, 'materials', values);
  return [
    set('defaults', {}),
    set('artwork', { source: 'artwork', artwork: ART }),
    set('model-glb', { source: 'model', modelAsset: DUCK }),
    set('model-stl', { source: 'model', modelAsset: STL }),
    set('custom-rig', {
      studio: 'custom',
      lights: [
        light({ kind: 'directional', x: -3, y: 6, z: 4, intensity: 2.2 }),
        light({
          kind: 'spot',
          color: '#ffd2a8',
          x: 4,
          y: 5,
          z: 3,
          intensity: 14,
          size: 0.6,
          shadows: true,
        }),
        light({
          kind: 'area',
          color: '#a8c8ff',
          x: 0,
          y: 4,
          z: -4,
          intensity: 3,
          size: 2.5,
          shadows: false,
        }),
      ],
    }),
    ...finishes.map((finish, i) =>
      set(`finish-${finish}`, { finishA: finish, finishB: finishes[(i + 1) % finishes.length] })
    ),
    set('pair', { materialMode: 'pair' }),
    set('custom-badge', {
      materialMode: 'custom',
      materials: [
        override({ slot: '1', color: '#ff5a36', roughness: 0.3, metalness: 0.2, clearcoat: 0.5 }),
        override({
          slot: 'paint:#0c322c',
          color: '#2453ff',
          roughness: 0.7,
          metalness: 0.9,
          clearcoat: 0,
        }),
      ],
    }),
    set('custom-duck', {
      source: 'model',
      modelAsset: DUCK,
      materialMode: 'custom',
      materials: [
        override({ slot: '1', color: '#ff5a36', roughness: 0.3, metalness: 0.2, clearcoat: 0.5 }),
      ],
    }),
    set('atmosphere', { atmosphere: true }),
    set('pedestal', { pedestal: true }),
    set('output-scene', { outputMode: 'scene' }),
    set('output-object-shadow', { outputMode: 'object-shadow' }),
    set('output-object', { outputMode: 'object' }),
    set('shadow-opaque', { outputMode: 'object-shadow', shadowOpacity: 1 }),
    set('position-right', { position: { x: 10, y: 10, z: -10 } }),
    set('position-left', { position: { x: -10, y: 10, z: -10 } }),
    set('scale-max', { transform: { scale: 5 } }),
    set('scale-min', { transform: { scale: 0.1 } }),
    set('rotation-max', { rotation: { x: 360, y: -360, z: 360 } }),
  ];
}

function sets04(m: InputManifest): ValueSet[] {
  const base = defaults(m);
  const set = (id: string, values: Values): ValueSet => ({
    id: `04-${id}`,
    era: '0.4',
    values: { ...base, ...values },
  });
  const object = (values: Values) => rowOf(m, 'objects', values);
  const subject = (values: Values) => rowOf(m, 'subjects', values);
  const key = (values: Values) => rowOf(m, 'cameraKeys', values);
  const added = [
    'chrome',
    'clay',
    'velvet',
    'glow',
    'neon',
    'glass',
    'frosted',
    'pearl',
    'iridescent',
  ];
  const environments = [
    'room',
    'studio',
    'gallery',
    'softbox',
    'window',
    'warehouse',
    'stage',
    'desert',
    'synthwave',
  ];
  const keys = [
    key({ at: 0, azimuth: 25, elevation: 14, fov: 29, zoom: 1, panY: 1.6 }),
    key({ at: 40, azimuth: 120, elevation: 30, fov: 35, zoom: 1.4, panX: 0.4, panY: 1.2 }),
    key({ at: 100, azimuth: -60, elevation: 5, fov: 24, zoom: 0.8, panZ: -0.5, focusDistance: 9 }),
  ];
  const cameraSets = ['smooth', 'flow', 'linear'].flatMap((ease) =>
    [false, true].map((loop) =>
      set(`camera-${ease}${loop ? '-loop' : ''}`, {
        cameraMotion: 'keys',
        cameraEase: ease,
        cameraLoop: loop,
        cameraKeys: keys,
        duration: 6,
      })
    )
  );
  return [
    set('defaults', {}),
    set('text-front', {
      source: 'text',
      words: 'Lolly',
      wordFont: 'sans',
      wordWeight: 700,
      wordPose: 'front',
    }),
    set('text-scene', {
      source: 'text',
      words: 'Brand\nStudio',
      wordFont: 'display',
      wordWeight: 500,
      wordPose: 'scene',
      wordAlign: 'left',
      wordTracking: 0.05,
      wordLineHeight: 1.3,
    }),
    set('arrangement', {
      source: 'arrangement',
      activeObject: 2,
      objects: [
        object({
          name: 'Mark',
          kind: 'artwork',
          asset: ART,
          x: -1.8,
          z: 0.4,
          rotY: 12,
          scale: 0.5,
          id: 'mark',
        }),
        object({ name: 'Duck', kind: 'model', asset: DUCK, x: 0.2, z: -1.2, scale: 0.55 }),
        object({
          name: 'Part',
          kind: 'model',
          asset: STL,
          modelFormat: 'stl',
          x: 1.9,
          y: 0.3,
          z: 0.6,
          rotX: 20,
          scale: 0.4,
          grounded: false,
        }),
        object({ name: 'Words', kind: 'text', text: 'Hi', x: 0, z: 1.8, scale: 0.45 }),
      ],
    }),
    ...environments.map((kind) => set(`env-${kind}`, { environment: kind })),
    set('env-image', { environment: 'image', environmentImage: HDR }),
    set('env-desert-shown', {
      environment: 'desert',
      environmentBackground: true,
      environmentBlur: 0,
    }),
    ...added.map((finish, i) =>
      set(`finish-${finish}`, { finishA: finish, finishB: added[(i + 1) % added.length] })
    ),
    set('surfaces', {
      surfaceFinishes: true,
      faceFinishA: 'chrome',
      bevelFinishA: 'glow',
      sideFinishA: 'inherit',
      faceFinishB: 'velvet',
      bevelFinishB: 'inherit',
      sideFinishB: 'pearl',
    }),
    ...cameraSets,
    set('light-positions', {
      keyPosition: { x: -5, y: 9, z: 6 },
      fillPosition: { x: 7, y: 2, z: 5 },
      rimPosition: { x: 2, y: 7, z: -6 },
    }),
    ...['spheres', 'copies'].flatMap((form) =>
      [0, 0.5, 1].map((spread) =>
        set(`atmosphere-${form}-${spread}`, {
          atmosphere: true,
          atmosphereForms: form,
          atmosphereSpread: spread,
        })
      )
    ),
    set('video-samples', {
      motion: 'turntable',
      duration: 4,
      turnDegrees: 180,
      lightMotion: 'orbit',
      videoSamples: 4,
    }),
    set('collection', {
      source: 'collection',
      activeSubject: 2,
      subjects: [
        subject({ name: 'Badge', kind: 'primitive', primitive: 'badge' }),
        subject({
          name: 'Duck',
          kind: 'model',
          asset: DUCK,
          ownFraming: true,
          azimuth: -40,
          elevation: 25,
          fov: 35,
          zoom: 1.3,
          panX: 0.2,
          panY: -0.1,
          ownFocus: true,
          focusDistance: 7,
          roleA: '1',
        }),
        subject({ name: 'Sphere', kind: 'primitive', primitive: 'sphere' }),
      ],
    }),
  ];
}

export function valueSets(): ValueSet[] {
  return [...sets03(manifest(MANIFEST_03_COMMIT)), ...sets04(manifest(PINNED_COMMIT))];
}

function requireUnchanged(paths: string[]): void {
  try {
    git(['diff', '--quiet', PINNED_COMMIT, '--', ...paths]);
  } catch {
    throw new Error(
      `${paths.join(', ')} differ from ${PINNED_COMMIT}. These fixtures pin the pushed output, so they are written only from the pushed code.`
    );
  }
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeRecipes(): number {
  requireUnchanged(['engine/src', 'packages/core/src']);
  for (const file of readdirSync(here)) if (/^0[34]-.*\.json$/.test(file)) rmSync(join(here, file));
  const sets = valueSets();
  const ids = new Set<string>();
  for (const { id, era, values } of sets) {
    if (ids.has(id)) throw new Error(`Two value sets are named ${id}.`);
    ids.add(id);
    const scene = buildStudioScene({ version: 1, values });
    writeFileSync(
      join(here, `${id}.json`),
      json({ source: PINNED_COMMIT, era, values, scene: JSON.parse(JSON.stringify(scene)) })
    );
  }
  return sets.length;
}

function writeMaterials(): number {
  requireUnchanged(['shells/web/src/lib/studio3d/materials.ts', 'engine/src/studio3d.ts']);
  const cases = materialCases();
  // One case per line keeps the file reviewable in a diff.
  const lines = cases.map(
    (c) => `    ${JSON.stringify({ ...c, materials: recordMaterialCase(c) })}`
  );
  writeFileSync(
    join(here, 'materials.json'),
    `{\n  "source": ${JSON.stringify(PINNED_COMMIT)},\n  "fields": ${JSON.stringify(MATERIAL_FIELDS)},\n  "cases": [\n${lines.join(',\n')}\n  ]\n}\n`
  );
  return cases.length;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  const both = !args.includes('--recipes') && !args.includes('--materials');
  if (both || args.includes('--recipes')) console.log(`wrote ${writeRecipes()} recipe fixtures`);
  if (both || args.includes('--materials'))
    console.log(`wrote materials.json with ${writeMaterials()} cases`);
}
