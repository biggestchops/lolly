// SPDX-License-Identifier: MPL-2.0
/**
 * 3D Studio: the default dramatic rig lights three surfaces the way a reader expects.
 *
 * Three subjects at 512 px under the dramatic rig and the room environment: a matte badge,
 * a satin torus and a ring with a chrome bevel. Each renders as a complete scene, as an
 * object with its shadow, as the object alone, and as the object alone lit by the room
 * environment without the rig's lights. The object mask is alpha above zero in
 * the object output; the shadow is the object-with-shadow alpha where the object output is
 * clear.
 *
 * Relational checks, which hold on any graphics backend:
 *   1. the half of the object facing the key light is brighter than the other half. The
 *      halves are split through the mask's centroid, square to the key's direction on
 *      screen, and each pixel is divided by the same pixel lit by the environment alone (a
 *      fourth render), so the paint's own lightness does not decide the comparison;
 *   2. the shadow falls on the far side of the object's base from the key;
 *   3. the shadow reaches within 6 px below the object's lowest row;
 *   4. fewer than 25% of object pixels reach 254 in any channel;
 *   5. object pixels darker than luma 0.1, if any, are not all one colour.
 * The key light's direction, the base and the camera come from the page: the recipe from
 * buildStudioScene, the camera from studioCamera and the placed subject from
 * loadStudioSource and placeStudioScene.
 *
 * Per-backend measures live in tests/fixtures/studio3d/lighting/backends.json, keyed by
 * `${process.platform}:${renderer}`. An entry marked reviewed (a person has seen the
 * images) is enforced within 10%; any other backend prints its measures, and
 * STUDIO_WRITE_BASELINE=1 records them as unreviewed. A run never marks an entry reviewed
 * and never overwrites a reviewed one. STUDIO_SHOTS saves every render for review.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  type StudioFrame,
  type StudioHarness,
  saveShot,
  startStudioHarness,
  studioSkip,
} from './helpers/studio3d-browser.ts';

type Point = [number, number];

interface LightingView {
  /** On-screen direction from the light target towards the key light, in pixels. */
  key: Point;
  /** The placed subject's base centre on screen. */
  base: Point;
  /** On-screen direction from the base towards the key light's ground projection. */
  keyGround: Point;
  /** The key light's world position, for the report. */
  keyPosition: [number, number, number];
}

declare global {
  interface Window {
    /** The key light and subject base on screen for a set of studio values (this suite's page helper). */
    lightingView?: (
      values: Record<string, unknown>,
      width: number,
      height: number
    ) => Promise<LightingView>;
  }
}

const pageHelper = `
import { Box3 as LightingBox, Group as LightingGroup, Vector3 as LightingVector } from 'three';
import { buildStudioScene as lightingRecipe } from './engine/src/studio3d.ts';
import { studioSceneObjects as lightingObjects } from './engine/src/studio3d-arrangement.ts';
import { STUDIO_LIGHT_TARGET as lightingTarget } from './engine/src/studio3d-lights.ts';
import { studioCamera as lightingCamera } from './shells/web/src/lib/studio3d/stage.ts';
import { placeStudioScene as lightingPlace } from './shells/web/src/lib/studio3d/camera.ts';
import { loadStudioSource as lightingSource } from './shells/web/src/lib/studio3d/source.ts';
window.lightingView = async (values, width, height) => {
  const recipe = lightingRecipe({ version: 1, values: { ...studioDefaults, ...values } });
  const camera = lightingCamera(recipe, width / height);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  const screen = (point) => {
    const p = point.clone().project(camera);
    return [((p.x + 1) / 2) * width, ((1 - p.y) / 2) * height];
  };
  // A short step towards a light projects safely even when the light is behind the camera.
  const towards = (from, to) => {
    const step = to.clone().sub(from).normalize().multiplyScalar(0.5).add(from);
    const a = screen(from), b = screen(step);
    return [b[0] - a[0], b[1] - a[1]];
  };
  const keyLight = recipe.lights.find((light) => light.id === 'key');
  if (!keyLight) throw new Error('The rig has no key light.');
  const key = new LightingVector(...keyLight.position);
  const asset = await lightingSource(recipe, read, new AbortController().signal);
  try {
    const root = new LightingGroup();
    root.add(asset.object);
    lightingPlace(root, [{ object: asset.object, spec: lightingObjects(recipe)[0] }], recipe);
    const box = new LightingBox().setFromObject(asset.object, true);
    const centre = box.getCenter(new LightingVector());
    const base = new LightingVector(centre.x, box.min.y, centre.z);
    return {
      key: towards(new LightingVector(...lightingTarget), key),
      base: screen(base),
      keyGround: towards(base, new LightingVector(key.x, base.y, key.z)),
      keyPosition: keyLight.position,
    };
  } finally {
    asset.dispose();
  }
};
`;

/** One ring in one inline fill on a 40-unit viewBox: wide enough to keep a 0.05 bevel. */
const ringSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path fill="#30ba78" d="M20 1a19 19 0 1 1 0 38a19 19 0 1 1 0-38M20 9a11 11 0 1 0 0 22a11 11 0 1 0 0-22"/></svg>';

const SIZE = 512;
const rig = { studio: 'dramatic', environment: 'room', samples: 8 };
/** The rig's lights at zero: the reference each pixel is divided by for the key-side check. */
const environmentOnly = {
  studio: 'custom',
  lights: [{ kind: 'directional', intensity: 0, shadows: false }],
};
const SCENES: Record<string, Record<string, unknown>> = {
  'matte-badge': { source: 'primitive', primitive: 'badge', finishA: 'matte', finishB: 'matte' },
  'satin-torus': { source: 'primitive', primitive: 'torus', finishA: 'satin' },
  'chrome-bevel-ring': {
    source: 'artwork',
    artwork: { url: '/ring.svg' },
    surfaceFinishes: true,
    bevelFinishA: 'chrome',
    shape: { bevel: 0.05 },
  },
};

type LightingMeasures = Record<string, number>;

interface BackendEntry {
  reviewed: boolean;
  recorded: string;
  size: number;
  samples: number;
  scenes: Record<string, LightingMeasures>;
}

const BACKENDS = join(import.meta.dirname, 'fixtures', 'studio3d', 'lighting', 'backends.json');
const TOLERANCE = 0.1;
/**
 * The smallest difference a reviewed measure allows, so a value near zero (a clipped
 * fraction of 0.002, say) is not held to an exact match. The contact gap is in whole pixels.
 */
const FLOOR: Record<string, number> = { contactGap: 1 };
const DEFAULT_FLOOR = 0.01;

/** Measures that differ from a reviewed reference by more than 10% (or the floor), with both values. */
function measureDrift(measured: LightingMeasures, reference: LightingMeasures): string[] {
  const drift: string[] = [];
  for (const [name, expected] of Object.entries(reference)) {
    const actual = measured[name];
    const allowed = Math.max(TOLERANCE * Math.abs(expected), FLOOR[name] ?? DEFAULT_FLOOR);
    if (actual === undefined || !(Math.abs(actual - expected) <= allowed))
      drift.push(`${name}: ${actual} against reviewed ${expected} (allowed ${allowed.toFixed(4)})`);
  }
  return drift;
}

const luma = (px: number[], i: number) =>
  (0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!) / 255;
const round = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * The relational checks' inputs and the recorded measures for one subject. `object` and
 * `shadow` are the object and object-with-shadow outputs; `ambient` is the object output lit
 * by the environment alone (the rig's lights at zero), which carries each pixel's paint and
 * the room's own light but none of the rig's.
 */
function measureLighting(
  object: Pick<StudioFrame, 'pixels' | 'width' | 'height'>,
  shadow: Pick<StudioFrame, 'pixels' | 'width' | 'height'>,
  ambient: Pick<StudioFrame, 'pixels' | 'width' | 'height'>,
  view: Pick<LightingView, 'key' | 'base' | 'keyGround'>
) {
  const { width, height } = object;
  let count = 0,
    cx = 0,
    cy = 0,
    lowest = -1,
    left = width,
    right = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (!object.pixels[(y * width + x) * 4 + 3]) continue;
      count++;
      cx += x + 0.5;
      cy += y + 0.5;
      lowest = y;
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
  assert.ok(count > 100, `the object covers only ${count} pixels`);
  cx /= count;
  cy /= count;
  // Mean luminance on each side of the line through the centroid, square to the key. The
  // plain means weigh each pixel by its alpha. The rig means divide each opaque pixel by
  // the same pixel under the environment alone, so a darker paint on one side (the
  // badge's bolt) does not decide which side reads brighter; a flat face under a
  // directional key is otherwise lit almost evenly.
  const plain = { sum: [0, 0], weight: [0, 0] };
  const rig = { sum: [0, 0], weight: [0, 0] };
  let shadowSum = 0,
    sx = 0,
    sy = 0,
    contactAlpha = 0,
    contactGap = Number.POSITIVE_INFINITY,
    clipped = 0,
    dark = 0,
    darkLow = 1,
    darkHigh = 0,
    lumaSum = 0,
    alphaSum = 0;
  const darkColours = new Set<number>();
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const alpha = object.pixels[i + 3]!;
      if (alpha) {
        const px = object.pixels;
        const l = luma(px, i);
        const side = (x + 0.5 - cx) * view.key[0] + (y + 0.5 - cy) * view.key[1] > 0 ? 0 : 1;
        plain.sum[side]! += l * (alpha / 255);
        plain.weight[side]! += alpha / 255;
        const base = luma(ambient.pixels, i);
        if (alpha === 255 && ambient.pixels[i + 3] === 255 && base > 0.02) {
          rig.sum[side]! += l / base;
          rig.weight[side]!++;
        }
        if (Math.max(px[i]!, px[i + 1]!, px[i + 2]!) >= 254) clipped++;
        lumaSum += l * (alpha / 255);
        alphaSum += alpha / 255;
        if (l < 0.1) {
          dark++;
          darkLow = Math.min(darkLow, l);
          darkHigh = Math.max(darkHigh, l);
          darkColours.add((px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!);
        }
        continue;
      }
      const s = shadow.pixels[i + 3]! / 255;
      if (!s) continue;
      shadowSum += s;
      sx += (x + 0.5) * s;
      sy += (y + 0.5) * s;
      if (y > lowest && x >= left && x <= right) {
        contactGap = Math.min(contactGap, y - lowest);
        if (y - lowest <= 6) contactAlpha = Math.max(contactAlpha, s);
      }
    }
  const ratio = (halves: { sum: number[]; weight: number[] }) =>
    halves.sum[0]! / halves.weight[0]! / (halves.sum[1]! / halves.weight[1]!);
  const offset: Point = [sx / shadowSum - view.base[0], sy / shadowSum - view.base[1]];
  const ground = Math.hypot(...view.keyGround) || 1;
  // Cosine between the shadow's offset from the base and the direction away from the key.
  const shadowAway =
    shadowSum > 0
      ? -(offset[0] * view.keyGround[0] + offset[1] * view.keyGround[1]) /
        (Math.hypot(...offset) * ground)
      : Number.NaN;
  return {
    darkColours: darkColours.size,
    measures: {
      keyLightRatio: round(ratio(rig)),
      keyRatio: round(ratio(plain)),
      meanLuma: round(lumaSum / alphaSum),
      shadowAway: round(shadowAway),
      shadowCoverage: round(shadowSum / count),
      contactGap: Number.isFinite(contactGap) ? contactGap : -1,
      contactAlpha: round(contactAlpha),
      clipFraction: round(clipped / count),
      darkFraction: round(dark / count),
      darkSpread: round(dark ? darkHigh - darkLow : 0),
    } satisfies LightingMeasures,
  };
}

function readBackends(): Record<string, BackendEntry> {
  return existsSync(BACKENDS)
    ? (JSON.parse(readFileSync(BACKENDS, 'utf8')) as Record<string, BackendEntry>)
    : {};
}

describe('3D Studio lighting measures', () => {
  it('holds a reviewed measure within 10%, with a floor near zero', () => {
    const reference = { keyRatio: 1.5, clipFraction: 0.002, contactGap: 3 };
    assert.deepEqual(
      measureDrift({ keyRatio: 1.64, clipFraction: 0.011, contactGap: 4 }, reference),
      []
    );
    const drift = measureDrift({ keyRatio: 1.7, clipFraction: 0.02, contactGap: 5 }, reference);
    assert.equal(drift.length, 3, drift.join('\n'));
    assert.match(measureDrift({}, { keyRatio: 1 })[0]!, /keyRatio: undefined/);
  });

  it('reads the key side, the shadow side and the contact from a drawn frame', () => {
    // A 64 px square: a disc whose left half is dark paint lit brightly and whose right
    // half is light paint lit dimly, its shadow to the lower right, with a two-pixel gap
    // under the disc. The plain means favour the right; the rig means find the left.
    const size = 64;
    const frame = () => ({
      pixels: new Array<number>(size * size * 4).fill(0),
      width: size,
      height: size,
    });
    const object = frame(),
      shadow = frame(),
      ambient = frame();
    const paint = (target: number[], i: number, level: number) =>
      target.splice(i, 4, level, level, level, 255);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        if (Math.hypot(x - 32, y - 28) < 12) {
          const left = x < 32;
          paint(object.pixels, i, left ? 60 : 150 + (x % 3));
          paint(shadow.pixels, i, left ? 60 : 150);
          paint(ambient.pixels, i, left ? 20 : 120);
        } else if (y > 40 && y < 48 && x > 30 && x < 50) shadow.pixels[i + 3] = 90;
      }
    const result = measureLighting(object, shadow, ambient, {
      key: [-1, 0],
      base: [32, 40],
      keyGround: [-1, -0.2],
    });
    assert.ok(result.measures.keyRatio < 1, JSON.stringify(result.measures));
    assert.ok(result.measures.keyLightRatio > 2, JSON.stringify(result.measures));
    assert.ok(result.measures.shadowAway > 0.5, JSON.stringify(result.measures));
    assert.equal(result.measures.contactGap, 2);
    assert.equal(result.measures.contactAlpha, round(90 / 255));
    assert.equal(result.measures.clipFraction, 0);
    assert.equal(result.measures.darkFraction, 0);
    assert.equal(result.darkColours, 0);
  });
});

let harness: StudioHarness | undefined;

describe('3D Studio lighting under the dramatic rig', { skip: studioSkip }, () => {
  const measured: Record<string, LightingMeasures> = {};
  let backendKey = '';
  let reference: BackendEntry | undefined;

  before(async () => {
    harness = await startStudioHarness({
      size: SIZE,
      routes: { '/ring.svg': ringSvg },
      extraSource: pageHelper,
    });
  });
  after(async () => {
    await harness?.close();
  });

  for (const [name, subject] of Object.entries(SCENES))
    it(`lights the ${name.replaceAll('-', ' ')} from the key side, with a grounded shadow and no crushed or clipped surface`, async () => {
      if (!harness) throw new Error('The 3D Studio harness did not start.');
      const page = await harness.open();
      try {
        if (!backendKey) {
          backendKey = `${process.platform}:${await harness.rendererName(page)}`;
          reference = readBackends()[backendKey];
        }
        const frames: Record<string, StudioFrame> = {};
        for (const [output, values] of [
          ['scene', { outputMode: 'scene' }],
          ['object-shadow', { outputMode: 'object-shadow' }],
          ['object', { outputMode: 'object' }],
          ['object-environment-only', { outputMode: 'object', ...environmentOnly }],
        ] as const) {
          const frame = await harness.render(page, { ...rig, ...subject, ...values });
          assert.equal(frame.state, 'ready', frame.info);
          assert.equal(frame.width, SIZE);
          await saveShot(`lighting-${name}-${output}.png`, frame.png);
          frames[output] = frame;
        }
        const view = await page.evaluate(([values, w, h]) => window.lightingView!(values, w, h), [
          { ...rig, ...subject },
          SIZE,
          SIZE,
        ] as const);
        const result = measureLighting(
          frames.object!,
          frames['object-shadow']!,
          frames['object-environment-only']!,
          view
        );
        const { measures } = result;
        const report = `${name} on ${backendKey}: ${JSON.stringify(measures)} (key at ${view.keyPosition}, info ${JSON.stringify(frames.object!.info)})`;
        console.log(report);
        assert.ok(measures.keyLightRatio > 1, `the key side is not the brighter one; ${report}`);
        assert.ok(measures.shadowAway > 0, `the shadow does not fall away from the key; ${report}`);
        assert.ok(
          measures.contactGap >= 1 && measures.contactGap <= 6,
          `no shadow within 6 px below the object; ${report}`
        );
        assert.ok(measures.clipFraction < 0.25, `too many clipped pixels; ${report}`);
        assert.ok(
          measures.darkFraction === 0 || result.darkColours > 1,
          `every dark pixel has one colour; ${report}`
        );
        measured[name] = measures;
        if (reference?.reviewed) {
          const expected = reference.scenes[name];
          assert.ok(expected, `the reviewed entry for ${backendKey} has no ${name} measures`);
          const drift = measureDrift(measures, expected);
          assert.deepEqual(
            drift,
            [],
            `${name} drifted from the reviewed measures on ${backendKey}`
          );
        }
        assert.deepEqual(harness.errors, []);
      } finally {
        await page.close();
      }
    });

  it('records the measures for this backend as unreviewed when asked', async () => {
    const complete = Object.keys(SCENES).every((name) => measured[name]);
    if (reference?.reviewed) {
      console.log(
        `${backendKey} has a reviewed entry; its measures were enforced and are left as they are.`
      );
      return;
    }
    console.log(
      `${backendKey || 'this backend'} has no reviewed entry, so only the relational checks apply. Measures: ${JSON.stringify(measured)}`
    );
    if (process.env.STUDIO_WRITE_BASELINE !== '1' || !complete || !backendKey) return;
    const backends = readBackends();
    backends[backendKey] = {
      reviewed: false,
      recorded: new Date().toISOString().slice(0, 10),
      size: SIZE,
      samples: rig.samples,
      scenes: measured,
    };
    const sorted = Object.fromEntries(
      Object.entries(backends).sort(([a], [b]) => a.localeCompare(b))
    );
    await mkdir(dirname(BACKENDS), { recursive: true });
    await writeFile(BACKENDS, JSON.stringify(sorted, null, 2) + '\n');
    console.log(`Wrote unreviewed measures for ${backendKey} to ${BACKENDS}.`);
  });
});
