// SPDX-License-Identifier: MPL-2.0
/**
 * 3D Studio: twelve unrelated icons under one studio come out as one set (plan 265 step 3).
 *
 * The twelve public icon fixtures (tests/helpers/studio3d-icons.ts) become one collection,
 * and the contact sheet renders them through `renderStudioCollection`, the library the
 * review dialog calls, with no dev server and no `STUDIO_SHELL_URL`. Each item is captured
 * at 256 px with 8 samples, three times: the object alone, the object with its shadow, and
 * the object lit by the environment alone (the rig's lights at zero), which is the
 * reference each pixel is divided by so a darker icon does not decide which side is lit.
 *
 * The checks are relational, so they hold on any graphics backend:
 *   1. the rig reaches every item (rigLift, the mean lit-over-ambient, above 1.25) and the
 *      set is lit from the key side (median keyLightRatio above 1.1, every item above
 *      0.95: a flat extruded icon has one normal over its whole face, so only its bevel
 *      and sides tell the two halves apart, and the bell comes out level at 0.97);
 *   2. the twelve shadow directions, read from one origin, agree with each other within 5
 *      degrees and sit within 10 of the key's own ground direction (measured: 4.9 and 8.0);
 *   3. screen occupancy (the object mask over the frame) sits inside a 15 percent band
 *      around the set's median, once each item's `scale` correction is applied (measured:
 *      1.4 percent, where the widest item was 65 percent off the median before them).
 *
 * The corrections are the point of the third check: the twelve were drawn to sit
 * differently in their frames (three thin, three solid, three tall, three wide), so
 * without them the set is not level. CORRECTIONS below records the measured value for
 * each, and the suite proves they survive a change of studio, colour pair and finishes.
 *
 * Per-item measures live in tests/fixtures/studio3d/collection/backends.json, keyed by
 * `${process.platform}:${renderer}`, exactly as the lighting suite records its own. An
 * entry marked reviewed is enforced within 10 percent; any other backend prints its
 * measures, and STUDIO_WRITE_BASELINE=1 records them as unreviewed. STUDIO_SHOTS saves
 * every item and a contact sheet of the twelve, before and after the corrections.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  type StudioHarness,
  saveShot,
  startStudioHarness,
  studioSkip,
} from './helpers/studio3d-browser.ts';
import { STUDIO_ICONS } from './helpers/studio3d-icons.ts';

type Point = [number, number];

/** RGBA bytes of one captured item, row by row. */
interface Frame {
  width: number;
  height: number;
  pixels: Uint8Array;
}

/** One captured item as it comes back from the page. */
interface SheetItem {
  index: number;
  id: string;
  name: string;
  width: number;
  height: number;
  /** Base64 of the requested channels: RGBA, or the alpha plane alone. */
  bytes: string;
  error?: string;
}

interface CollectionView {
  /** On-screen direction from the light target towards the key light, in pixels. */
  key: Point;
  /** On-screen direction from the stage centre towards the key light's ground point. */
  keyGround: Point;
  keyPosition: [number, number, number];
  /** The stage centre on screen, as a fraction of the frame: one origin for every item. */
  stage: Point;
}

declare global {
  interface Window {
    /** Render one collection through the contact-sheet library (this suite's page helper). */
    collectionSheet?: (
      values: Record<string, unknown>,
      size: { width: number; height: number },
      options?: { channels?: 'rgba' | 'alpha'; contact?: boolean }
    ) => Promise<{ items: SheetItem[]; contact: string }>;
    /** The key light's direction on screen for these shared values. */
    collectionView?: (
      values: Record<string, unknown>,
      width: number,
      height: number
    ) => CollectionView;
  }
}

const pageHelper = `
import { Vector3 as SheetVector } from 'three';
import { buildStudioScene as sheetRecipe } from './engine/src/studio3d.ts';
import { studioCollectionRows as sheetRows } from './engine/src/studio3d-collection.ts';
import { STUDIO_LIGHT_TARGET as sheetTarget } from './engine/src/studio3d-lights.ts';
import { renderStudioCollection as sheetRender } from './shells/web/src/lib/studio3d/collection-preview.ts';
import { studioCamera as sheetCamera } from './shells/web/src/lib/studio3d/stage.ts';

// One blob to the bytes a measure needs, plus the PNG itself for the shots folder.
const sheetBytes = async (blob, channels) => {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const wanted = channels === 'alpha' ? data.filter((value, i) => i % 4 === 3) : data;
  let text = '';
  for (let i = 0; i < wanted.length; i += 0x8000)
    text += String.fromCharCode.apply(null, wanted.subarray(i, i + 0x8000));
  return { width: canvas.width, height: canvas.height, bytes: btoa(text) };
};

const sheetDataUrl = (blob) =>
  new Promise((done) => {
    const reader = new FileReader();
    reader.onload = () => done(reader.result);
    reader.readAsDataURL(blob);
  });

// The twelve drawn into one picture, the way the review dialog's Download sheet does.
const sheetContact = async (tiles) => {
  const columns = 4;
  const rows = Math.ceil(tiles.length / columns);
  const first = await createImageBitmap(tiles[0].blob);
  const w = first.width, h = first.height, gap = 8;
  first.close();
  const canvas = document.createElement('canvas');
  canvas.width = columns * w + (columns + 1) * gap;
  canvas.height = rows * h + (rows + 1) * gap;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < tiles.length; i++) {
    const bitmap = await createImageBitmap(tiles[i].blob);
    ctx.drawImage(bitmap, gap + (i % columns) * (w + gap), gap + Math.floor(i / columns) * (h + gap), w, h);
    bitmap.close();
  }
  return canvas.toDataURL();
};

window.collectionSheet = async (values, size, options) => {
  const rows = sheetRows({ ...studioDefaults, ...values });
  const collected = [];
  await sheetRender(
    rows,
    read,
    new AbortController().signal,
    size,
    (row, result) => {
      collected.push({ index: row.index, id: row.id, name: row.name, result });
    },
    shapeText
  );
  const items = [];
  const tiles = [];
  for (const item of collected) {
    if (!(item.result instanceof Blob)) {
      items.push({ index: item.index, id: item.id, name: item.name, width: 0, height: 0, bytes: '', error: String(item.result && item.result.message || item.result) });
      continue;
    }
    tiles.push({ name: item.name, blob: item.result });
    items.push({
      index: item.index,
      id: item.id,
      name: item.name,
      png: await sheetDataUrl(item.result),
      ...(await sheetBytes(item.result, options && options.channels)),
    });
  }
  return { items, contact: options && options.contact && tiles.length ? await sheetContact(tiles) : '' };
};

window.collectionView = (values, width, height) => {
  const recipe = sheetRecipe({ version: 1, values: { ...studioDefaults, ...values } });
  const camera = sheetCamera(recipe, width / height);
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
  const key = new SheetVector(...keyLight.position);
  const target = new SheetVector(...sheetTarget);
  const ground = new SheetVector(sheetTarget[0], 0, sheetTarget[2]);
  return {
    key: towards(target, key),
    keyGround: towards(ground, new SheetVector(key.x, 0, key.z)),
    keyPosition: keyLight.position,
    stage: screen(ground).map((value, i) => value / (i ? height : width)),
  };
};
`;

const SIZE = 256;
const SAMPLES = 8;

/**
 * Each icon's size correction, measured on this set: `scale` is the square root of the
 * median occupancy over the item's own, so an icon that covered half the median area
 * grows by about 1.41. The test prints the uncorrected occupancy of every run, so these
 * twelve values can be re-derived whenever the set or the studio changes.
 *
 * `offsetX` and `offsetY` are available here too and are not needed by this set: the
 * twelve already centre within three percent of the frame across, and a lift would take
 * an object off the stage, which moves the contact its shadow is measured from.
 */
const CORRECTIONS: Record<string, { scale?: number; offsetX?: number; offsetY?: number }> = {
  'bolt-ring': { scale: 1 },
  gear: { scale: 0.96 },
  leaf: { scale: 0.98 },
  play: { scale: 0.78 },
  cloud: { scale: 1.01 },
  padlock: { scale: 0.9 },
  magnifier: { scale: 1.04 },
  bell: { scale: 1.08 },
  house: { scale: 1.02 },
  pin: { scale: 1 },
  chat: { scale: 0.97 },
  star: { scale: 1.1 },
};

/** The shared studio the twelve are photographed in. */
const STUDIO = {
  source: 'collection',
  studio: 'dramatic',
  environment: 'room',
  collectionName: 'Twelve icons',
  collectionSize: { width: SIZE, height: SIZE },
  samples: SAMPLES,
};

/** The rig's lights at zero: the reference each pixel is divided by for the key-side check. */
const ENVIRONMENT_ONLY = {
  studio: 'custom',
  lights: [{ kind: 'directional', intensity: 0, shadows: false }],
};

/** A change of look the corrections and framing must survive. */
const OTHER_LOOK = {
  studio: 'electric',
  colorA: '#ff8f1f',
  colorB: '#101820',
  finishA: 'chrome',
  finishB: 'matte',
  surfaceFinishes: true,
  bevelFinishA: 'metal',
};

function subjects(corrected: boolean): Record<string, unknown>[] {
  return STUDIO_ICONS.map((icon) => ({
    name: icon.name,
    id: icon.id,
    kind: 'artwork',
    asset: { id: icon.id, url: `/icons/${icon.file}`, name: icon.file },
    ...(corrected ? (CORRECTIONS[icon.id] ?? {}) : {}),
  }));
}

const luma = (px: Uint8Array, i: number) =>
  (0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!) / 255;
const round = (n: number) => Math.round(n * 10_000) / 10_000;
/** Screen angle of a vector in degrees, counted anticlockwise from the right. */
const angleOf = (v: Point): number => (Math.atan2(-v[1], v[0]) * 180) / Math.PI;
/** The signed difference between two angles, in (-180, 180]. */
const angleGap = (a: number, b: number): number => ((((a - b) % 360) + 540) % 360) - 180;

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const half = sorted.length >> 1;
  return sorted.length % 2 ? sorted[half]! : (sorted[half - 1]! + sorted[half]!) / 2;
}

export interface ItemMeasures extends Record<string, number> {
  /** The object mask over the whole frame. */
  occupancy: number;
  /** Mean lit-over-ambient on the key side, over the same on the other side. */
  keyLightRatio: number;
  /** Mean lit-over-ambient over the whole object: how much the rig adds to the room. */
  rigLift: number;
  /** Visible shadow alpha over the object's pixel count. */
  shadowCoverage: number;
  /** The object's alpha centroid, as a fraction of the frame. */
  centreX: number;
  centreY: number;
  /** The middle of the object's lowest rows: where its shadow leaves from. */
  baseX: number;
  baseY: number;
  /** The visible shadow's alpha centroid, as a fraction of the frame. */
  shadowX: number;
  shadowY: number;
}

/**
 * One item's measures. `object` and `ambient` are RGBA; `shadow` is the alpha plane of the
 * object-with-shadow output. The shadow is what that output covers where the object output
 * is clear, and its direction is read from the object's base on screen, the point the
 * shadow actually leaves from.
 */
export function measureCollectionItem(
  object: Frame,
  shadow: { width: number; height: number; alpha: Uint8Array },
  ambient: Frame,
  key: Point
): ItemMeasures {
  const { width, height } = object;
  let count = 0,
    cx = 0,
    cy = 0,
    lowest = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (!object.pixels[(y * width + x) * 4 + 3]) continue;
      count++;
      cx += x + 0.5;
      cy += y + 0.5;
      lowest = y;
    }
  assert.ok(count > 100, `the object covers only ${count} pixels`);
  cx /= count;
  cy /= count;
  // The base is the middle of the object's lowest rows: a shadow leaves from the contact,
  // not from the centre, so a tall icon and a wide one are read the same way.
  let baseX = 0,
    baseWeight = 0;
  for (let y = Math.max(0, lowest - 2); y <= lowest; y++)
    for (let x = 0; x < width; x++)
      if (object.pixels[(y * width + x) * 4 + 3]) {
        baseX += x + 0.5;
        baseWeight++;
      }
  baseX = baseWeight ? baseX / baseWeight : cx;
  const sides = { sum: [0, 0], weight: [0, 0] };
  let lift = 0,
    lifted = 0,
    shadowSum = 0,
    sx = 0,
    sy = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const alpha = object.pixels[i + 3]!;
      if (alpha) {
        const base = luma(ambient.pixels, i);
        if (alpha === 255 && ambient.pixels[i + 3] === 255 && base > 0.02) {
          const value = luma(object.pixels, i) / base;
          const side = (x + 0.5 - cx) * key[0] + (y + 0.5 - cy) * key[1] > 0 ? 0 : 1;
          sides.sum[side]! += value;
          sides.weight[side]!++;
          lift += value;
          lifted++;
        }
        continue;
      }
      const s = shadow.alpha[y * width + x]! / 255;
      if (!s) continue;
      shadowSum += s;
      sx += (x + 0.5) * s;
      sy += (y + 0.5) * s;
    }
  return {
    occupancy: round(count / (width * height)),
    keyLightRatio: round(sides.sum[0]! / sides.weight[0]! / (sides.sum[1]! / sides.weight[1]!)),
    rigLift: round(lift / lifted),
    shadowCoverage: round(shadowSum / count),
    centreX: round(cx / width),
    centreY: round(cy / height),
    baseX: round(baseX / width),
    baseY: round((lowest + 0.5) / height),
    shadowX: shadowSum > 0 ? round(sx / shadowSum / width) : Number.NaN,
    shadowY: shadowSum > 0 ? round(sy / shadowSum / height) : Number.NaN,
  };
}

/** The direction of one item's shadow from a point of the frame, in screen degrees. */
export function shadowDirection(item: ItemMeasures, from: 'base' | 'centre' | Point): number {
  const origin: Point =
    from === 'base'
      ? [item.baseX, item.baseY]
      : from === 'centre'
        ? [item.centreX, item.centreY]
        : from;
  return round(angleOf([item.shadowX - origin[0], item.shadowY - origin[1]]));
}

interface BackendEntry {
  reviewed: boolean;
  recorded: string;
  size: number;
  samples: number;
  /** Degrees, measured: how far the shadow directions sit from the key's ground direction. */
  keyAwayAngle: number;
  items: Record<string, ItemMeasures>;
}

const BACKENDS = join(import.meta.dirname, 'fixtures', 'studio3d', 'collection', 'backends.json');
const TOLERANCE = 0.1;
const FLOOR: Record<string, number> = {};
const DEFAULT_FLOOR = 0.01;

/** Measures that differ from a reviewed reference by more than 10% (or the floor), with both values. */
export function measureDrift(
  measured: Record<string, number>,
  reference: Record<string, number>
): string[] {
  const drift: string[] = [];
  for (const [name, expected] of Object.entries(reference)) {
    const actual = measured[name];
    const allowed = Math.max(TOLERANCE * Math.abs(expected), FLOOR[name] ?? DEFAULT_FLOOR);
    if (actual === undefined || !(Math.abs(actual - expected) <= allowed))
      drift.push(`${name}: ${actual} against reviewed ${expected} (allowed ${allowed.toFixed(4)})`);
  }
  return drift;
}

function readBackends(): Record<string, BackendEntry> {
  return existsSync(BACKENDS)
    ? (JSON.parse(readFileSync(BACKENDS, 'utf8')) as Record<string, BackendEntry>)
    : {};
}

function frameOf(item: SheetItem, channels: 'rgba' | 'alpha') {
  const bytes = new Uint8Array(Buffer.from(item.bytes, 'base64'));
  assert.equal(
    bytes.length,
    item.width * item.height * (channels === 'alpha' ? 1 : 4),
    `${item.name} came back with ${bytes.length} bytes`
  );
  return channels === 'alpha'
    ? { width: item.width, height: item.height, alpha: bytes }
    : { width: item.width, height: item.height, pixels: bytes };
}

describe('3D Studio collection measures', () => {
  it('reads occupancy, the key side and the shadow direction from a drawn frame', () => {
    // A 64 px frame: a disc whose left half is dark paint lit brightly and whose right half
    // is light paint lit dimly, with a shadow to the lower right of its base.
    const size = 64;
    const rgba = () => ({
      width: size,
      height: size,
      pixels: new Uint8Array(size * size * 4),
    });
    const object = rgba(),
      ambient = rgba();
    const shadow = { width: size, height: size, alpha: new Uint8Array(size * size) };
    const paint = (target: Uint8Array, i: number, level: number) =>
      target.set([level, level, level, 255], i);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        if (Math.hypot(x - 32, y - 28) < 12) {
          const left = x < 32;
          paint(object.pixels, i, left ? 60 : 150);
          paint(ambient.pixels, i, left ? 20 : 120);
        } else if (y > 40 && y < 48 && x > 34 && x < 54) shadow.alpha[y * size + x] = 90;
      }
    const measures = measureCollectionItem(object, shadow, ambient, [-1, 0]);
    assert.ok(measures.keyLightRatio > 2, JSON.stringify(measures));
    assert.ok(measures.rigLift > 2 && measures.rigLift < 2.1, JSON.stringify(measures));
    assert.equal(measures.occupancy, round(437 / (size * size)));
    // Down and to the right of the base: between -90 and 0 degrees on screen.
    const angle = shadowDirection(measures, 'base');
    assert.ok(angle < 0 && angle > -90, `shadow at ${angle} degrees`);
    assert.ok(shadowDirection(measures, 'centre') < angle, 'the centre sits above the base');
    assert.ok(measures.centreX > 0.49 && measures.centreX < 0.51, JSON.stringify(measures));
  });

  it('holds a reviewed measure within 10%, with a floor near zero', () => {
    const reference = { occupancy: 0.1, keyLightRatio: 1.2, shadowY: 0.6 };
    assert.deepEqual(
      measureDrift({ occupancy: 0.107, keyLightRatio: 1.3, shadowY: 0.64 }, reference),
      []
    );
    assert.equal(
      measureDrift({ occupancy: 0.13, keyLightRatio: 1.5, shadowY: 0.7 }, reference).length,
      3
    );
    assert.match(measureDrift({}, { occupancy: 1 })[0]!, /occupancy: undefined/);
  });

  it('reads a median from an even and an odd count', () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 3, 2]), 2.5);
  });
});

let harness: StudioHarness | undefined;

describe('twelve icons under one studio', { skip: studioSkip }, () => {
  const measured: Record<string, ItemMeasures> = {};
  let backendKey = '';
  let reference: BackendEntry | undefined;
  let keyAway = Number.NaN;

  before(async () => {
    harness = await startStudioHarness({ size: SIZE, extraSource: pageHelper });
  });
  after(async () => {
    await harness?.close();
  });

  /** One pass of the whole set at one output mode. */
  async function sheet(
    page: import('playwright').Page,
    values: Record<string, unknown>,
    channels: 'rgba' | 'alpha',
    contact = false
  ): Promise<{ items: SheetItem[]; contact: string }> {
    const result = await page.evaluate(
      ([values, size, options]) =>
        window.collectionSheet!(
          values as Record<string, unknown>,
          size as { width: number; height: number },
          options as { channels?: 'rgba' | 'alpha'; contact?: boolean }
        ),
      [values, { width: SIZE, height: SIZE }, { channels, contact }] as const
    );
    const failed = result.items.filter((item) => item.error);
    assert.deepEqual(
      failed.map((item) => `${item.name}: ${item.error}`),
      []
    );
    assert.equal(result.items.length, STUDIO_ICONS.length);
    return result;
  }

  it('renders the twelve as one set: key-lit, shadows agreeing, and level in the frame', async () => {
    if (!harness) throw new Error('The 3D Studio harness did not start.');
    const page = await harness.open();
    try {
      backendKey = `${process.platform}:${await harness.rendererName(page)}`;
      reference = readBackends()[backendKey];
      const view = await page.evaluate(
        ([values, w, h]) =>
          window.collectionView!(values as Record<string, unknown>, w as number, h as number),
        [
          { ...STUDIO, source: 'artwork', artwork: { url: `/icons/${STUDIO_ICONS[0]!.file}` } },
          SIZE,
          SIZE,
        ] as const
      );
      keyAway = angleOf([-view.keyGround[0], -view.keyGround[1]]);

      // Before: the set as drawn, with no corrections. The contact sheet of this pass is
      // what the scale values in CORRECTIONS were read from.
      const plain = await sheet(
        page,
        { ...STUDIO, subjects: subjects(false), outputMode: 'object' },
        'rgba',
        true
      );
      await saveShot('collection-before.png', plain.contact);
      const before = plain.items.map((item) => item.width && item.height);
      assert.ok(before.every(Boolean), 'every item rendered');

      const object = await sheet(
        page,
        { ...STUDIO, subjects: subjects(true), outputMode: 'object' },
        'rgba',
        true
      );
      await saveShot('collection-after.png', object.contact);
      const shadow = await sheet(
        page,
        { ...STUDIO, subjects: subjects(true), outputMode: 'object-shadow' },
        'alpha'
      );
      const ambient = await sheet(
        page,
        {
          ...STUDIO,
          ...ENVIRONMENT_ONLY,
          subjects: subjects(true),
          outputMode: 'object',
        },
        'rgba'
      );
      for (const [index, icon] of STUDIO_ICONS.entries()) {
        await saveShot(`collection-${icon.id}.png`, (object.items[index] as unknown as { png: string }).png);
        measured[icon.id] = measureCollectionItem(
          frameOf(object.items[index]!, 'rgba') as Frame,
          frameOf(shadow.items[index]!, 'alpha') as {
            width: number;
            height: number;
            alpha: Uint8Array;
          },
          frameOf(ambient.items[index]!, 'rgba') as Frame,
          view.key
        );
      }
      const report = `${backendKey}, key at ${view.keyPosition}, away ${round(keyAway)} degrees: ${JSON.stringify(measured)}`;
      console.log(report);

      const occupancy = STUDIO_ICONS.map((icon) => measured[icon.id]!.occupancy);
      const middle = median(occupancy);
      const uncorrected = plain.items.map((item, index) =>
        measureCollectionItem(
          frameOf(item, 'rgba') as Frame,
          frameOf(shadow.items[index]!, 'alpha') as {
            width: number;
            height: number;
            alpha: Uint8Array;
          },
          frameOf(ambient.items[index]!, 'rgba') as Frame,
          view.key
        )
      );
      console.log(
        `occupancy before corrections: ${JSON.stringify(
          Object.fromEntries(STUDIO_ICONS.map((icon, i) => [icon.id, uncorrected[i]!.occupancy]))
        )}\nmedian after corrections: ${middle}`
      );
      // Every shadow is read from one origin, the stage centre, so the twelve are
      // comparable: read from each object's own base the silhouette decides the answer
      // (the same twelve spread over 46 degrees that way, and over 20 read from their
      // centroids). Both alternatives are in the evidence folder for this run.
      const angles = STUDIO_ICONS.map((icon) => shadowDirection(measured[icon.id]!, view.stage));
      const pointing = angles.reduce((sum, angle) => sum + angle, 0) / angles.length;
      const offKey = angles.map((angle) => Math.abs(angleGap(angle, keyAway)));
      console.log(
        `shadow direction from the stage centre: ${JSON.stringify(
          Object.fromEntries(STUDIO_ICONS.map((icon, i) => [icon.id, angles[i]]))
        )}\n  mean ${round(pointing)} degrees, widest deviation from it ${round(
          Math.max(...angles.map((angle) => Math.abs(angleGap(angle, pointing))))
        )}, widest from the key's ground direction ${round(Math.max(...offKey))}`
      );
      for (const [index, icon] of STUDIO_ICONS.entries()) {
        const item = measured[icon.id]!;
        // A flat extruded icon has one normal over its whole face, so a directional key
        // lights the face evenly and only the bevel and sides tell the halves apart. The
        // key side still wins on eleven of the twelve; the bell, which is nearly all face,
        // comes out level at 0.97. That is why the per-item bound is 0.95 and the set's
        // median carries the claim.
        assert.ok(
          item.keyLightRatio > 0.95,
          `${icon.name} is darker on the key side; ${JSON.stringify(item)}`
        );
        assert.ok(
          item.rigLift > 1.25,
          `the rig barely reaches ${icon.name}; ${JSON.stringify(item)}`
        );
        assert.ok(
          Math.abs(angleGap(angles[index]!, pointing)) <= 5,
          `${icon.name}'s shadow points ${angles[index]} degrees, against the set's ${round(pointing)}`
        );
        assert.ok(
          offKey[index]! <= 10,
          `${icon.name}'s shadow is ${round(offKey[index]!)} degrees off the key's ground direction`
        );
        assert.ok(
          Math.abs(item.occupancy - middle) <= middle * 0.15,
          `${icon.name} covers ${item.occupancy} of the frame against a median of ${middle}`
        );
      }
      assert.ok(
        median(STUDIO_ICONS.map((icon) => measured[icon.id]!.keyLightRatio)) > 1.1,
        'the set is not lit from the key side'
      );
      assert.deepEqual(harness.errors, []);
    } finally {
      await page.close();
    }
  });

  it('keeps every correction and framing through a change of studio, colours and finishes', async () => {
    if (!harness) throw new Error('The 3D Studio harness did not start.');
    const page = await harness.open();
    try {
      const rows = subjects(true);
      // One item also keeps its own framing, which the shared camera must not take back.
      rows[5] = { ...rows[5], ownFraming: true, azimuth: -20, zoom: 1.2 };
      const looked = await sheet(
        page,
        { ...STUDIO, ...OTHER_LOOK, subjects: rows, outputMode: 'object' },
        'rgba',
        true
      );
      await saveShot('collection-other-look.png', looked.contact);
      const occupancy = looked.items.map(
        (item) =>
          measureCollectionItem(
            frameOf(item, 'rgba') as Frame,
            {
              width: item.width,
              height: item.height,
              alpha: new Uint8Array(item.width * item.height),
            },
            frameOf(item, 'rgba') as Frame,
            [1, 0]
          ).occupancy
      );
      // The corrected item keeps the size its correction gave it, whatever the look.
      const band = median(occupancy.filter((_value, index) => index !== 5));
      for (const [index, icon] of STUDIO_ICONS.entries()) {
        if (index === 5) continue;
        assert.ok(
          Math.abs(occupancy[index]! - band) <= band * 0.15,
          `${icon.name} covers ${occupancy[index]} under the other look, median ${band}`
        );
      }
      // The item with its own framing is the one that moved, and it moved on purpose.
      assert.notEqual(occupancy[5], measured[STUDIO_ICONS[5]!.id]?.occupancy);
      assert.deepEqual(harness.errors, []);
    } finally {
      await page.close();
    }
  });

  it('records the measures for this backend as unreviewed when asked', async () => {
    const complete = STUDIO_ICONS.every((icon) => measured[icon.id]);
    if (reference?.reviewed) {
      const drift = STUDIO_ICONS.flatMap((icon) =>
        measureDrift(measured[icon.id] ?? {}, reference?.items[icon.id] ?? {}).map(
          (line) => `${icon.id} ${line}`
        )
      );
      assert.deepEqual(drift, [], `the twelve drifted from the reviewed measures on ${backendKey}`);
      console.log(`${backendKey} has a reviewed entry; its measures were enforced.`);
      return;
    }
    console.log(
      `${backendKey || 'this backend'} has no reviewed entry, so only the relational checks apply.`
    );
    if (process.env.STUDIO_WRITE_BASELINE !== '1' || !complete || !backendKey) return;
    const backends = readBackends();
    backends[backendKey] = {
      reviewed: false,
      recorded: new Date().toISOString().slice(0, 10),
      size: SIZE,
      samples: SAMPLES,
      keyAwayAngle: round(keyAway),
      items: measured,
    };
    const sorted = Object.fromEntries(
      Object.entries(backends).sort(([a], [b]) => a.localeCompare(b))
    );
    await mkdir(dirname(BACKENDS), { recursive: true });
    await writeFile(BACKENDS, JSON.stringify(sorted, null, 2) + '\n');
    console.log(`Wrote unreviewed measures for ${backendKey} to ${BACKENDS}.`);
  });
});
