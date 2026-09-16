// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildStudioScene } from '../engine/src/studio3d.ts';

test('depth forms default to subject copies with a bounded spread and count', () => {
  const scene = buildStudioScene({ version: 1, values: { atmosphere: true } });
  assert.equal(scene.stage.atmosphereForms, 'copies');
  assert.equal(scene.stage.atmosphereSpread, 0.5);
  assert.equal(scene.stage.atmosphereCount, 7);
  const custom = buildStudioScene({
    version: 1,
    values: {
      atmosphere: true,
      atmosphereForms: 'spheres',
      atmosphereSpread: 4,
      atmosphereCount: 0.4,
      seed: 12,
    },
  });
  assert.equal(custom.stage.atmosphereForms, 'spheres');
  assert.equal(custom.stage.atmosphereSpread, 1);
  assert.equal(custom.stage.atmosphereCount, 1);
  assert.equal(custom.stage.seed, 12);
  assert.equal(
    buildStudioScene({ version: 1, values: { atmosphereForms: 'cubes' } }).stage.atmosphereForms,
    'copies'
  );
  // Transparent outputs never carry the forms; the recipe keeps the settings for the scene image.
  const cutout = buildStudioScene({
    version: 1,
    values: { atmosphere: true, outputMode: 'object-shadow' },
  });
  assert.equal(cutout.stage.atmosphere, true);
  assert.equal(cutout.stage.output, 'object-shadow');
});
