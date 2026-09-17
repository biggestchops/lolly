// SPDX-License-Identifier: MPL-2.0
/**
 * The pushed 3D Studio 0.4.0 material assignment, pinned (plan 265, task A2).
 *
 * tests/fixtures/studio3d/recipes/materials.json was recorded from commit 05faef7a4 by
 * generate.ts: every finish, in source, pair and custom modes, for scene and object
 * outputs, on studio-owned paint materials and on authored GLB materials. The same
 * cases (material-cases.ts) are recorded again here with today's code and compared
 * field by field. Three only, no DOM.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  MATERIAL_FIELDS,
  type MaterialCase,
  type MaterialCell,
  materialCaseName,
  materialCases,
  recordMaterialCase,
} from './fixtures/studio3d/recipes/material-cases.ts';

interface MaterialFixture {
  source: string;
  fields: string[];
  cases: (MaterialCase & { materials: MaterialCell[][] })[];
}

const pinned: MaterialFixture = JSON.parse(
  readFileSync(
    join(import.meta.dirname, 'fixtures', 'studio3d', 'recipes', 'materials.json'),
    'utf8'
  )
);

function differences(
  c: MaterialCase,
  expected: MaterialCell[][],
  actual: MaterialCell[][]
): string[] {
  const name = materialCaseName(c);
  if (expected.length !== actual.length)
    return [`${name}: expected ${expected.length} slots, got ${actual.length}`];
  const out: string[] = [];
  for (const [i, row] of expected.entries())
    for (const [j, value] of row.entries())
      if (actual[i]![j] !== value)
        out.push(
          `${name} slot ${String(row[0])} ${pinned.fields[j]}: expected ${JSON.stringify(value)}, got ${JSON.stringify(actual[i]![j])}`
        );
  return out;
}

function field(c: MaterialCase, slot: number, name: string): MaterialCell {
  const found = pinned.cases.find(
    (p) =>
      p.finish === c.finish && p.mode === c.mode && p.output === c.output && p.asset === c.asset
  );
  if (!found) throw new Error(`No pinned case ${materialCaseName(c)}.`);
  return found.materials[slot]![pinned.fields.indexOf(name)]!;
}

describe('3D Studio pinned material assignment (pushed 0.4.0)', () => {
  it('records the same fields and cases the fixture was written with', () => {
    assert.equal(pinned.source, '05faef7a4');
    assert.deepEqual(pinned.fields, MATERIAL_FIELDS);
    assert.deepEqual(pinned.cases.map(materialCaseName), materialCases().map(materialCaseName));
    assert.equal(pinned.cases.length, 13 * 4 * 2 * 2);
  });

  it('assigns every finish in every mode and output as the pushed commit did', () => {
    const found: string[] = [];
    for (const [i, c] of materialCases().entries())
      found.push(...differences(c, pinned.cases[i]!.materials, recordMaterialCase(c)));
    assert.deepEqual(found, []);
  });

  it('pins the 0.4 behaviours the plan names', () => {
    // A finish that leaves clear coat roughness out writes 0.05.
    assert.equal(
      field(
        { finish: 'matte', mode: 'source', output: 'scene', asset: 'svg' },
        0,
        'clearcoatRoughness'
      ),
      0.05
    );
    // Pair mode applies the whole finish to authored GLB materials: authored emissive,
    // transmission and alpha are replaced.
    const pair: MaterialCase = { finish: 'satin', mode: 'pair', output: 'scene', asset: 'glb' };
    assert.equal(field(pair, 0, 'kept'), false);
    assert.equal(field(pair, 0, 'emissive'), '000000');
    assert.equal(field(pair, 0, 'transparent'), false);
    assert.equal(field(pair, 0, 'opacity'), 1);
    assert.equal(field(pair, 0, 'map'), null);
    assert.equal(field(pair, 0, 'normalMap'), 'normal');
    assert.equal(field(pair, 1, 'transmission'), 0);
    assert.equal(field(pair, 1, 'sheen'), 0);
    // A numeric custom override on a GLB takes only roughness, metalness and clear coat:
    // the authored transmission and sheen stay.
    const custom: MaterialCase = {
      finish: 'metal',
      mode: 'custom-one',
      output: 'scene',
      asset: 'glb',
    };
    assert.equal(field(custom, 0, 'roughness'), 0.3);
    assert.equal(field(custom, 0, 'metalness'), 0.6);
    assert.equal(field(custom, 0, 'clearcoat'), 0.9);
    assert.equal(field(custom, 0, 'color'), 'ff5a36');
    assert.equal(field(custom, 0, 'emissiveMap'), 'emissive');
    assert.equal(field(custom, 0, 'transparent'), true);
    assert.equal(field(custom, 1, 'kept'), true);
    assert.equal(field(custom, 1, 'transmission'), 0.8);
    // Source mode keeps a GLB's own materials.
    assert.equal(
      field({ finish: 'glow', mode: 'source', output: 'object', asset: 'glb' }, 0, 'kept'),
      true
    );
    // Glass over a transparent output becomes solid crystal on studio-owned materials.
    assert.equal(
      field({ finish: 'glass', mode: 'source', output: 'object', asset: 'svg' }, 0, 'transmission'),
      0
    );
    assert.equal(
      field({ finish: 'glass', mode: 'source', output: 'scene', asset: 'svg' }, 0, 'transmission'),
      1
    );
  });
});
