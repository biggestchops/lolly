// SPDX-License-Identifier: MPL-2.0
/**
 * Alpha checks for 3D Studio cutout outputs, shared by the renderer suite
 * (tests/studio3d-quality-alpha.browser.test.ts) and the live shell export case
 * (tests/studio3d.shell.browser.test.ts).
 *
 * Both images are un-premultiplied RGBA, as a 2D canvas returns them: `output` is the
 * image under test (an `object` or `object-shadow` output) and `object` is the `object`
 * output of the same scene, which supplies the object mask.
 *
 * 1. Clear outside. The allowed area is the object mask (object alpha above 0) grown by
 *    2 px. For object-shadow, it also takes the shadow region: every pixel with alpha that
 *    connects to the grown mask through other pixels with alpha (8-connected), because a
 *    contact shadow touches its object. Any alpha outside the allowed area is stray. The
 *    report also gives the largest alpha on the frame border: an object output keeps its
 *    subject inside the frame, while a shadow may run off the edge.
 * 2. Shadow bound. Shadow-only pixels (output alpha where object alpha is 0) stay at or
 *    below round(shadowOpacity * 255) + 1.
 * 3. No halo. A silhouette pixel (output alpha from 32 to 254 where the object has
 *    coverage) is a mix of what it covers, so each colour channel must lie within the
 *    range of the fully opaque object pixels in its 3 by 3 neighbourhood, plus a
 *    tolerance. When the output alpha is above the object alpha, part of the pixel is
 *    shadow, which is black, so the range then reaches down to 0. The alpha floor of 32
 *    keeps 8-bit un-premultiply rounding (up to 255 / (2 * alpha) per channel) inside the
 *    tolerance. A silhouette pixel with no opaque object neighbour has no reference colour
 *    and is counted as skipped. The range only describes the pixel when its neighbours
 *    show every surface it covers: on a lit subject, a side wall, bevel or grazing surface
 *    thinner than a pixel is darker or lighter than the faces next to it, so the report
 *    splits the excess into darker and lighter and leaves the judgement to the test.
 *
 * The functions measure and report; the tests decide what to assert.
 */

export interface AlphaImage {
  pixels: ArrayLike<number>;
  width: number;
  height: number;
}

export type StudioCutout = 'object' | 'object-shadow';

export interface HaloPixel {
  x: number;
  y: number;
  alpha: number;
  /** The object output's alpha at this pixel. */
  objectAlpha: number;
  rgb: [number, number, number];
  low: [number, number, number];
  high: [number, number, number];
  /** How far the worst channel lies outside [low, high]. */
  excess: number;
}

export interface StudioAlphaReport {
  /** Pixels with any object coverage. */
  objectPixels: number;
  /** Largest alpha outside the allowed area, and how many pixels carry any. */
  strayAlpha: number;
  strayPixels: number;
  /** Largest alpha on the outermost row and column of the frame. */
  borderAlpha: number;
  /** Shadow-only pixels with alpha, their largest alpha and the bound they must keep. */
  shadowPixels: number;
  shadowAlpha: number;
  shadowLimit: number;
  /** Silhouette pixels checked for halos, and those with no opaque object neighbour. */
  haloChecked: number;
  haloSkipped: number;
  /** The silhouette pixel furthest outside its neighbours' colour range, or null. */
  haloWorst: HaloPixel | null;
  /** The largest excess below the range (a darker edge) and above it (a lighter edge). */
  haloDarker: number;
  haloLighter: number;
}

/** The tolerance check 3 allows beyond the neighbours' range, per channel. */
export const HALO_TOLERANCE = 8;
/** The lowest alpha check 3 inspects. */
export const HALO_ALPHA_FLOOR = 32;

function sameSize(a: AlphaImage, b: AlphaImage): void {
  if (a.width !== b.width || a.height !== b.height || a.pixels.length !== b.pixels.length)
    throw new Error(
      `Alpha images differ in size: ${a.width}x${a.height} and ${b.width}x${b.height}.`
    );
  if (a.pixels.length !== a.width * a.height * 4) throw new Error('An alpha image is not RGBA.');
}

/** The mask grown by `radius` pixels in every direction (a square neighbourhood). */
export function dilateMask(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number
): Uint8Array {
  const rows = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      for (let dx = Math.max(0, x - radius); dx <= Math.min(width - 1, x + radius); dx++)
        rows[y * width + dx] = 1;
    }
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (!rows[y * width + x]) continue;
      for (let dy = Math.max(0, y - radius); dy <= Math.min(height - 1, y + radius); dy++)
        out[dy * width + x] = 1;
    }
  return out;
}

/** Runs the three checks described in the header. */
export function studioAlphaReport(
  output: AlphaImage,
  object: AlphaImage,
  kind: StudioCutout,
  shadowOpacity: number
): StudioAlphaReport {
  sameSize(output, object);
  const { width, height } = output;
  const count = width * height;
  const alpha = (image: AlphaImage, i: number) => image.pixels[i * 4 + 3]!;
  const mask = new Uint8Array(count);
  let objectPixels = 0;
  for (let i = 0; i < count; i++)
    if (alpha(object, i) > 0) {
      mask[i] = 1;
      objectPixels++;
    }
  const allowed = dilateMask(mask, width, height, 2);
  if (kind === 'object-shadow') {
    const queue: number[] = [];
    for (let i = 0; i < count; i++) if (allowed[i]) queue.push(i);
    while (queue.length) {
      const i = queue.pop()!;
      const x = i % width,
        y = (i - x) / width;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx,
            ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const j = ny * width + nx;
          if (allowed[j] || alpha(output, j) === 0) continue;
          allowed[j] = 1;
          queue.push(j);
        }
    }
  }

  let strayAlpha = 0,
    strayPixels = 0,
    borderAlpha = 0,
    shadowPixels = 0,
    shadowAlpha = 0;
  for (let i = 0; i < count; i++) {
    const a = alpha(output, i);
    if (!a) continue;
    const x = i % width,
      y = (i - x) / width;
    if (!allowed[i]) {
      strayPixels++;
      strayAlpha = Math.max(strayAlpha, a);
    }
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1)
      borderAlpha = Math.max(borderAlpha, a);
    if (alpha(object, i) === 0) {
      shadowPixels++;
      shadowAlpha = Math.max(shadowAlpha, a);
    }
  }

  let haloChecked = 0,
    haloSkipped = 0,
    haloDarker = 0,
    haloLighter = 0;
  let haloWorst: HaloPixel | null = null;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const a = alpha(output, i);
      const objectAlpha = alpha(object, i);
      if (a < HALO_ALPHA_FLOOR || a > 254 || objectAlpha === 0) continue;
      const low: [number, number, number] = [255, 255, 255];
      const high: [number, number, number] = [0, 0, 0];
      let opaque = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx,
            ny = y + dy;
          if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const j = ny * width + nx;
          if (alpha(object, j) !== 255 || alpha(output, j) !== 255) continue;
          opaque++;
          for (let c = 0; c < 3; c++) {
            const value = output.pixels[j * 4 + c]!;
            low[c] = Math.min(low[c]!, value);
            high[c] = Math.max(high[c]!, value);
          }
        }
      if (!opaque) {
        haloSkipped++;
        continue;
      }
      haloChecked++;
      // Alpha beyond the object's own coverage is shadow under the edge.
      if (kind === 'object-shadow' && a > objectAlpha + 1) low.fill(0);
      const rgb: [number, number, number] = [
        output.pixels[i * 4]!,
        output.pixels[i * 4 + 1]!,
        output.pixels[i * 4 + 2]!,
      ];
      let darker = 0,
        lighter = 0;
      for (let c = 0; c < 3; c++) {
        darker = Math.max(darker, low[c]! - rgb[c]!);
        lighter = Math.max(lighter, rgb[c]! - high[c]!);
      }
      haloDarker = Math.max(haloDarker, darker);
      haloLighter = Math.max(haloLighter, lighter);
      const excess = Math.max(darker, lighter);
      if (!haloWorst || excess > haloWorst.excess)
        haloWorst = { x, y, alpha: a, objectAlpha, rgb, low, high, excess };
    }

  return {
    objectPixels,
    strayAlpha,
    strayPixels,
    borderAlpha,
    shadowPixels,
    shadowAlpha,
    shadowLimit: Math.round(shadowOpacity * 255) + 1,
    haloChecked,
    haloSkipped,
    haloWorst,
    haloDarker,
    haloLighter,
  };
}
