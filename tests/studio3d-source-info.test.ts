// SPDX-License-Identifier: MPL-2.0
/**
 * What a loaded source reports about the file it came from (plan 265 milestone 3, F1).
 *
 * The studio scales every subject so its longest side is 3.25 studio units, which makes a
 * duck and a bolt the same size on screen and throws the file's own numbers away. A model
 * file does carry numbers, even if STL never says what they mean, so `loadStudioSource`
 * keeps the box it measured before that scaling and reports it as `StudioSourceInfo.bounds`
 * plus one line in the Source notes.
 *
 * Artwork, words and the built-in shapes are drawn to fit, so they report no bounds: a size
 * in their own space would mean nothing to the reader.
 *
 * A GLB is covered in the browser suite instead: three's GLTFLoader decodes a texture
 * through the page's own image decoder, which Node has not got.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStudioScene } from '../engine/src/studio3d.ts';
import { loadStudioSource } from '../shells/web/src/lib/studio3d/source.ts';
import { installStudioDom, loadSvgFixture } from './helpers/studio3d-dom.ts';

/** An ASCII STL box from the origin to (x, y, z): 12 facets, every facet normal zero. */
function boxStl(x: number, y: number, z: number): string {
  const corner = (i: number): number[] => [i & 1 ? x : 0, i & 2 ? y : 0, i & 4 ? z : 0];
  const quads = [
    [0, 2, 3, 1],
    [4, 5, 7, 6],
    [0, 1, 5, 4],
    [2, 6, 7, 3],
    [0, 4, 6, 2],
    [1, 3, 7, 5],
  ];
  const facets = quads.flatMap(([a, b, c, d]) => [
    [a!, b!, c!],
    [a!, c!, d!],
  ]);
  return (
    'solid box\n' +
    facets
      .map(
        (facet) =>
          'facet normal 0 0 0\nouter loop\n' +
          facet.map((i) => 'vertex ' + corner(i).join(' ')).join('\n') +
          '\nendloop\nendfacet'
      )
      .join('\n') +
    '\nendsolid box'
  );
}

function loadStl(stl: string) {
  const scene = buildStudioScene({
    version: 1,
    values: { source: 'model', modelAsset: { url: '/box.stl', name: 'box.stl' } },
  });
  const bytes = new TextEncoder().encode(stl);
  return loadStudioSource(scene, async () => bytes, new AbortController().signal);
}

test('an STL reports the box it measures in the file, and keeps its units disclaimer', async () => {
  installStudioDom();
  const asset = await loadStl(boxStl(20, 10, 5));
  try {
    assert.deepEqual(asset.info.bounds, { x: 20, y: 10, z: 5, span: 20 });
    assert.ok(
      asset.info.warnings.includes(
        'Model spans 20 by 10 by 5 units in its file; shown at 3.25 studio units.'
      ),
      asset.info.warnings.join(' / ')
    );
    // The measurement is a note beside the two an STL already carries, not a replacement.
    assert.ok(
      asset.info.warnings.some((warning) => /print dimensions are not inferred/.test(warning))
    );
    assert.ok(asset.info.warnings.some((warning) => /carried no facet normals/.test(warning)));
  } finally {
    asset.dispose();
  }
});

test('the reported spans read to at most two decimals while the bounds keep the measurement', async () => {
  installStudioDom();
  const asset = await loadStl(boxStl(12.3456, 0.125, 7));
  try {
    assert.ok(Math.abs(asset.info.bounds!.x - 12.3456) < 1e-4, String(asset.info.bounds!.x));
    assert.equal(asset.info.bounds!.span, asset.info.bounds!.x);
    assert.ok(
      asset.info.warnings.includes(
        'Model spans 12.35 by 0.13 by 7 units in its file; shown at 3.25 studio units.'
      ),
      asset.info.warnings.join(' / ')
    );
  } finally {
    asset.dispose();
  }
});

test('artwork reports no bounds, because it is drawn to fit rather than measured', async () => {
  const asset = await loadSvgFixture(
    '<svg xmlns="http://www.w3.org/2000/svg"><path fill="#e63946" d="M0 0H40V24H0Z"/></svg>',
    { bevel: 0 }
  );
  try {
    assert.equal(asset.info.bounds, undefined);
    assert.deepEqual(
      asset.info.warnings.filter((warning) => /Model spans/.test(warning)),
      []
    );
    assert.equal(asset.info.slots.length, 1);
  } finally {
    asset.dispose();
  }
});
