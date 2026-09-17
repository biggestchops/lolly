// SPDX-License-Identifier: MPL-2.0
/**
 * The pushed 3D Studio 0.4.0 recipe, pinned (plan 265, task A1).
 *
 * tests/fixtures/studio3d/recipes/ holds one file per value set, written by generate.ts
 * from commit 05faef7a4: 0.3-era sessions (only the inputs the 0.3.0 manifest had) and
 * 0.4 value sets. Today's buildStudioScene must give every field each fixture records.
 * The comparison is a deep subset, so a field added to the scene later does not fail
 * it, while any changed or removed field does, and the failure names its path.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { buildStudioScene, STUDIO_FINISHES } from '../engine/src/studio3d.ts';

const root = resolve(import.meta.dirname, '..');
const dir = join(import.meta.dirname, 'fixtures', 'studio3d', 'recipes');
const PINNED = '05faef7a4';
const MANIFEST_03 = 'd7b4593dd';

type Values = Record<string, unknown>;
interface RecipeFixture {
  file: string;
  id: string;
  source: string;
  era: '0.3' | '0.4';
  values: Values;
  scene: Values;
}

const fixtures: RecipeFixture[] = readdirSync(dir)
  .filter((file) => /^0[34]-.*\.json$/.test(file))
  .sort()
  .map((file) => {
    const parsed: Omit<RecipeFixture, 'file' | 'id'> = JSON.parse(
      readFileSync(join(dir, file), 'utf8')
    );
    return { ...parsed, file, id: file.replace(/\.json$/, '') };
  });

function fixture(id: string): RecipeFixture {
  const found = fixtures.find((f) => f.id === id);
  if (!found) throw new Error(`No recipe fixture ${id}.`);
  return found;
}

/** The scene as plain JSON, the form the fixtures were written in. */
function evaluate(values: Values): Values {
  const scene: Values = JSON.parse(JSON.stringify(buildStudioScene({ version: 1, values })));
  return scene;
}

function isRecord(value: unknown): value is Values {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Every path where `actual` lacks or differs from a value `expected` records. */
function subsetMismatches(expected: unknown, actual: unknown, path: string): string[] {
  const shown = (value: unknown) => (value === undefined ? 'nothing' : JSON.stringify(value));
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return [`${path}: expected an array, got ${shown(actual)}`];
    if (actual.length !== expected.length)
      return [`${path}: expected ${expected.length} entries, got ${actual.length}`];
    return expected.flatMap((item, i) => subsetMismatches(item, actual[i], `${path}[${i}]`));
  }
  if (isRecord(expected)) {
    if (!isRecord(actual)) return [`${path}: expected an object, got ${shown(actual)}`];
    return Object.entries(expected).flatMap(([key, value]) =>
      subsetMismatches(value, actual[key], `${path}.${key}`)
    );
  }
  return expected === actual ? [] : [`${path}: expected ${shown(expected)}, got ${shown(actual)}`];
}

function hasCommit(commit: string): boolean {
  try {
    execFileSync('git', ['cat-file', '-e', `${commit}^{commit}`], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('3D Studio pinned recipe (pushed 0.4.0)', () => {
  it('has the pinned value sets from the pushed commit', () => {
    assert.ok(fixtures.length >= 60, `only ${fixtures.length} recipe fixtures`);
    for (const f of fixtures) {
      assert.equal(f.source, PINNED, f.file);
      assert.equal(f.era, f.id.startsWith('03-') ? '0.3' : '0.4', f.file);
      assert.equal(f.scene.version, 1, f.file);
    }
    const eras = (era: RecipeFixture['era']) => fixtures.filter((f) => f.era === era);
    const scenes = (era: RecipeFixture['era']) => eras(era).map((f) => evaluate(f.values));
    const materials = (scene: Values) => (isRecord(scene.materials) ? scene.materials : {});
    const stage = (scene: Values) => (isRecord(scene.stage) ? scene.stage : {});
    // Each finish of an era is pinned on role A and on role B.
    for (const [era, finishes] of [
      ['0.3', STUDIO_FINISHES.slice(0, 4)],
      ['0.4', STUDIO_FINISHES.slice(4)],
    ] as const)
      for (const finish of finishes)
        for (const role of ['finishA', 'finishB'])
          assert.ok(
            scenes(era).some((scene) => materials(scene)[role] === finish),
            `${era} ${role} ${finish}`
          );
    const all = scenes('0.4');
    const environments = new Set(
      all.map((scene) => (isRecord(scene.environment) ? scene.environment.kind : null))
    );
    for (const kind of [
      'room',
      'studio',
      'gallery',
      'softbox',
      'window',
      'warehouse',
      'stage',
      'desert',
      'synthwave',
      'image',
    ])
      assert.ok(environments.has(kind), `environment ${kind}`);
    for (const ease of ['smooth', 'flow', 'linear'])
      for (const loop of [false, true])
        assert.ok(
          all.some(
            (scene) =>
              isRecord(scene.cameraMotion) &&
              scene.cameraMotion.kind === 'keys' &&
              scene.cameraMotion.ease === ease &&
              scene.cameraMotion.loop === loop
          ),
          `camera ${ease} loop ${loop}`
        );
    for (const form of ['spheres', 'copies'])
      for (const spread of [0, 0.5, 1])
        assert.ok(
          all.some(
            (scene) =>
              stage(scene).atmosphere === true &&
              stage(scene).atmosphereForms === form &&
              stage(scene).atmosphereSpread === spread
          ),
          `depth forms ${form} ${spread}`
        );
    for (const output of ['scene', 'object-shadow', 'object'])
      assert.ok(
        scenes('0.3').some((scene) => stage(scene).output === output),
        `0.3 output ${output}`
      );
    for (const kind of ['svg', 'glb', 'stl', 'primitive'])
      assert.ok(
        scenes('0.3').some((scene) => isRecord(scene.source) && scene.source.kind === kind),
        `0.3 source ${kind}`
      );
    const arrangement = evaluate(fixture('04-arrangement').values);
    assert.deepEqual(
      Array.isArray(arrangement.objects)
        ? arrangement.objects.map((o) => (isRecord(o) && isRecord(o.source) ? o.source.kind : null))
        : [],
      ['svg', 'glb', 'stl', 'text']
    );
  });

  for (const f of fixtures)
    it(`${f.id} evaluates as the pushed commit did`, () => {
      const scene = evaluate(f.values);
      assert.deepEqual(subsetMismatches(f.scene, scene, 'scene'), []);
      // The hemisphere fill the pushed stage built from colour A and the background,
      // now declared in the recipe (task A5).
      assert.ok(isRecord(scene.stage) && isRecord(scene.materials));
      assert.deepEqual(scene.stage.fill, {
        sky: scene.materials.colorA,
        ground: scene.stage.background,
        intensity: 0.12,
      });
    });

  it('reports the exact path of a mismatch', () => {
    const f = fixture('03-atmosphere');
    const edited: Values = JSON.parse(JSON.stringify(f.scene));
    if (isRecord(edited.stage)) edited.stage.atmosphereSpread = 0.25;
    if (Array.isArray(edited.lights) && isRecord(edited.lights[1])) edited.lights[1].id = 'moved';
    assert.deepEqual(subsetMismatches(edited, evaluate(f.values), 'scene'), [
      'scene.lights[1].id: expected "moved", got "fill"',
      'scene.stage.atmosphereSpread: expected 0.25, got 0.5',
    ]);
    // A field the scene gains later is not a mismatch; a field it loses is.
    assert.deepEqual(subsetMismatches({ a: 1 }, { a: 1, b: 2 }, 'scene'), []);
    assert.deepEqual(subsetMismatches({ a: 1, b: 2 }, { a: 1 }, 'scene'), [
      'scene.b: expected 2, got nothing',
    ]);
  });

  it('reopens a 0.3 session with depth forms as the pushed 0.4 renders it', () => {
    const f = fixture('03-atmosphere');
    assert.equal(f.values.atmosphere, true);
    for (const key of ['atmosphereForms', 'atmosphereSpread', 'atmosphereCount'])
      assert.equal(key in f.values, false, `${key} is not a 0.3 input`);
    const stage = evaluate(f.values).stage;
    assert.ok(isRecord(stage));
    assert.equal(stage.atmosphereForms, 'copies');
    assert.equal(stage.atmosphereSpread, 0.5);
    assert.equal(stage.atmosphereCount, 7);
  });

  it('keeps the transform limits 0.3 sessions were saved with', () => {
    const transform = (id: string) => {
      const scene = evaluate(fixture(id).values);
      assert.ok(isRecord(scene.transform));
      return scene.transform;
    };
    assert.deepEqual(transform('03-position-right').position, [10, 10, -10]);
    assert.deepEqual(transform('03-position-left').position, [-10, 10, -10]);
    assert.equal(transform('03-scale-max').scale, 5);
    assert.equal(transform('03-scale-min').scale, 0.1);
    assert.deepEqual(transform('03-rotation-max').rotation, [360, -360, 360]);
    const beyond = evaluate({
      ...fixture('03-defaults').values,
      position: { x: 12, y: -40, z: 11 },
      transform: { scale: 9 },
      rotation: { x: 400, y: -500, z: 0 },
    });
    assert.ok(isRecord(beyond.transform));
    assert.deepEqual(beyond.transform.position, [10, -10, 10]);
    assert.equal(beyond.transform.scale, 5);
    assert.deepEqual(beyond.transform.rotation, [360, -360, 0]);
  });

  const manifestSkip = hasCommit(MANIFEST_03)
    ? false
    : `Commit ${MANIFEST_03} is not in this clone (shallow checkout), so the 0.3 manifest fixture cannot be read; a full clone runs this check`;
  it('builds 0.3-era sets only from inputs the 0.3.0 manifest declared', {
    skip: manifestSkip,
  }, () => {
    const manifest: { version: string; inputs: { id: string; fields?: { id: string }[] }[] } =
      JSON.parse(
        execFileSync('git', ['show', `${MANIFEST_03}:community/3d-studio/tool.json`], {
          cwd: root,
          encoding: 'utf8',
        })
      );
    assert.equal(manifest.version, '0.3.0');
    const inputs = new Map(manifest.inputs.map((input) => [input.id, input]));
    const sets = fixtures.filter((f) => f.era === '0.3');
    assert.ok(sets.length >= 20, `only ${sets.length} 0.3-era sets`);
    for (const f of sets) {
      assert.ok(['artwork', 'model', 'primitive'].includes(String(f.values.source)), f.id);
      for (const [id, value] of Object.entries(f.values)) {
        const input = inputs.get(id);
        assert.ok(input, `${f.id}: ${id} is not a 0.3 input`);
        if (!input.fields) continue;
        const fields = new Set(input.fields.map((field) => field.id));
        const records = Array.isArray(value) ? value : value === null ? [] : [value];
        for (const record of records) {
          assert.ok(isRecord(record), `${f.id}: ${id} holds a non-object entry`);
          for (const key of Object.keys(record))
            assert.ok(fields.has(key), `${f.id}: ${id}.${key} is not a 0.3 field`);
        }
      }
    }
  });
});
