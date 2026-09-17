// SPDX-License-Identifier: MPL-2.0
/**
 * Tessellation baseline for 3D Studio artwork (plan 265, B3).
 *
 * three flattens every curve into a fixed number of chords (the Smoothness value), so the
 * flattening error depends on the artwork and the output size rather than on a tolerance.
 * This file measures that error for the curved ring and the Outfit B at smoothness 8, 24
 * and 64, together with the triangle count, as a record for milestone 2. Nothing here is
 * compared with the record.
 *
 * Chord error: for each curve of each prepared shape, three samples the curve at
 * `divisions` even steps of its parameter; between two neighbouring samples the true curve
 * is sampled 32 more times and the largest distance to the chord is kept. It is reported
 * in studio units and in output pixels for square outputs of 64, 512 and 4096 px, by
 * projecting both the curve and the chord through two framings of the placed object
 * (placeStudioObject from camera.ts, default bevel and depth, front face):
 *   default   the recipe's default camera (zoom 1, aimed at the object's middle), which is
 *             what a new studio shows;
 *   fitted    the same camera after fitStudioObject (the Fit button), which fills about
 *             80% of the frame.
 *
 * STUDIO_WRITE_BASELINE=1 writes tests/fixtures/studio3d/geometry/tessellation-baseline.json.
 *
 * The one assertion: triangle counts do not depend on the source's scale.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { buildStudioScene } from '../engine/src/studio3d.ts';
import { fitStudioObject, placeStudioObject } from '../shells/web/src/lib/studio3d/camera.ts';
import { prepareStudioSvg, type StudioAsset } from '../shells/web/src/lib/studio3d/source.ts';
import { studioCamera } from '../shells/web/src/lib/studio3d/stage.ts';
import { installStudioDom, loadSvgFixture } from './helpers/studio3d-dom.ts';

const root = resolve(import.meta.dirname, '..');
const dir = join(root, 'tests/fixtures/studio3d/geometry');
const FIXTURES = ['ring-opposite.svg', 'letter-b-outfit.svg'];
const SMOOTHNESS = [8, 24, 64];
const OUTPUTS = [64, 512, 4096];
const SAMPLES = 32;

installStudioDom();

function triangles(asset: StudioAsset): number {
  let count = 0;
  asset.object.traverse((node) => {
    if (node instanceof THREE.Mesh) count += node.geometry.getAttribute('position').count / 3;
  });
  return count;
}

/** How many chords three draws for one curve; a straight line has no chord error. */
function chordSteps(curve: THREE.Curve<THREE.Vector2>, divisions: number): number {
  if (curve instanceof THREE.LineCurve) return 0;
  return curve instanceof THREE.EllipseCurve ? divisions * 2 : divisions;
}

function segmentDistance(p: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2): number {
  const ab = b.clone().sub(a),
    length = ab.lengthSq();
  const t = length > 0 ? THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / length, 0, 1) : 0;
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}

interface Measure {
  triangles: number;
  /** Largest chord error in studio units. */
  chordError: number;
  /** Largest chord error in output pixels, per framing and output size. */
  pixels: Record<'default' | 'fitted', Record<string, number>>;
}

function round(value: number): number {
  return Number(value.toPrecision(4));
}

async function measure(file: string, smoothness: number): Promise<Measure> {
  const text = readFileSync(join(dir, file), 'utf8');
  const asset = await loadSvgFixture(text, { bevel: 0.025, smoothness });
  try {
    const recipe = buildStudioScene({
      version: 1,
      values: { source: 'artwork', artwork: { url: '/fixture.svg' }, shape: { smoothness } },
    });
    placeStudioObject(asset.object, recipe);
    const raw = asset.object.children[0]!;
    raw.updateMatrixWorld(true);
    const front = recipe.shape.depth / raw.scale.x;
    const fitted = structuredClone(recipe);
    const fit = fitStudioObject(asset.object, fitted, 1);
    fitted.camera.target = fit.target.toArray();
    fitted.camera.zoom = fit.zoom;
    const cameras = { default: studioCamera(recipe, 1), fitted: studioCamera(fitted, 1) };
    for (const camera of Object.values(cameras)) camera.updateMatrixWorld(true);
    const world = (point: THREE.Vector2) =>
      raw.localToWorld(new THREE.Vector3(point.x, point.y, front));
    const screen = (point: THREE.Vector3, camera: THREE.Camera) => {
      const ndc = point.clone().project(camera);
      return new THREE.Vector2(ndc.x, ndc.y);
    };
    let chordError = 0;
    const ndcError = { default: 0, fitted: 0 };
    const { svg } = prepareStudioSvg(text);
    const shapes = new SVGLoader().parse(svg).paths.flatMap((path) => path.toShapes());
    const curves = shapes.flatMap((shape) =>
      [shape, ...shape.holes].flatMap((path) => path.curves)
    );
    for (const curve of curves) {
      const steps = chordSteps(curve, smoothness);
      for (let i = 0; i < steps; i++) {
        const a = world(curve.getPoint(i / steps)),
          b = world(curve.getPoint((i + 1) / steps));
        const ends = Object.fromEntries(
          Object.entries(cameras).map(([name, camera]) => [
            name,
            [screen(a, camera), screen(b, camera)],
          ])
        ) as Record<'default' | 'fitted', [THREE.Vector2, THREE.Vector2]>;
        for (let k = 1; k < SAMPLES; k++) {
          const p = world(curve.getPoint((i + k / SAMPLES) / steps));
          const ab = b.clone().sub(a);
          const t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1);
          chordError = Math.max(chordError, p.distanceTo(a.clone().addScaledVector(ab, t)));
          for (const [name, camera] of Object.entries(cameras) as [
            'default' | 'fitted',
            THREE.Camera,
          ][]) {
            const [sa, sb] = ends[name];
            ndcError[name] = Math.max(ndcError[name], segmentDistance(screen(p, camera), sa, sb));
          }
        }
      }
    }
    // NDC spans 2 units across the output, so one NDC unit is half the output in pixels.
    const pixels = (name: 'default' | 'fitted') =>
      Object.fromEntries(OUTPUTS.map((size) => [String(size), round((ndcError[name] * size) / 2)]));
    return {
      triangles: triangles(asset),
      chordError: round(chordError),
      pixels: { default: pixels('default'), fitted: pixels('fitted') },
    };
  } finally {
    asset.dispose();
  }
}

test('tessellation baseline: chord error and triangle count per smoothness', async (t) => {
  const record: Record<string, Record<string, Measure>> = {};
  for (const file of FIXTURES) {
    record[file] = {};
    for (const smoothness of SMOOTHNESS) {
      const result = await measure(file, smoothness);
      record[file]![String(smoothness)] = result;
      t.diagnostic(
        `${file} smoothness ${smoothness}: ${result.triangles} triangles, chord error ${result.chordError} studio units, ` +
          `default ${OUTPUTS.map((size) => `${result.pixels.default[size]} px at ${size}`).join(', ')}; ` +
          `fitted ${OUTPUTS.map((size) => `${result.pixels.fitted[size]} px at ${size}`).join(', ')}`
      );
      assert.ok(result.triangles > 0 && Number.isFinite(result.chordError));
    }
  }
  if (process.env.STUDIO_WRITE_BASELINE === '1') {
    const three = JSON.parse(
      readFileSync(join(root, 'node_modules/three/package.json'), 'utf8')
    ) as {
      version: string;
    };
    const baseline = {
      about:
        'Tessellation record for plan 265 milestone 2, written by tests/studio3d-tessellation.test.ts with STUDIO_WRITE_BASELINE=1. No test compares against it.',
      three: three.version,
      shape: { bevel: 0.025, depth: 0.25 },
      outputs: OUTPUTS,
      framings: {
        default: 'the default recipe camera (zoom 1, target at the object middle), square output',
        fitted: 'the same camera after fitStudioObject at aspect 1',
      },
      method:
        'chordError is the largest distance from the true curve to its chord in studio units (32 samples per chord, front face); pixels projects the same distance through each framing',
      fixtures: record,
    };
    writeFileSync(
      join(dir, 'tessellation-baseline.json'),
      `${JSON.stringify(baseline, null, 2)}\n`
    );
    t.diagnostic('wrote tests/fixtures/studio3d/geometry/tessellation-baseline.json');
  }
});

test('triangle counts do not depend on the source scale', async () => {
  for (const file of FIXTURES) {
    const text = readFileSync(join(dir, file), 'utf8');
    const scaled = text
      .replace(/<svg([^>]*)viewBox="0 0 40 40"/, '<svg$1viewBox="0 0 4000 4000"')
      .replace(/(<path[\s\S]*?\/>)/, '<g transform="scale(100)">$1</g>');
    assert.notEqual(scaled, text);
    for (const smoothness of SMOOTHNESS) {
      const counts: number[] = [];
      for (const source of [text, scaled]) {
        const asset = await loadSvgFixture(source, { bevel: 0.025, smoothness });
        try {
          counts.push(triangles(asset));
        } finally {
          asset.dispose();
        }
      }
      assert.equal(counts[0], counts[1], `${file} at smoothness ${smoothness}: 1x and 100x`);
    }
  }
});
