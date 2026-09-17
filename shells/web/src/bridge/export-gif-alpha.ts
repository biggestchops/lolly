// SPDX-License-Identifier: MPL-2.0
/**
 * Transparency for the animated GIF export (plan 265 milestone 2, E2).
 *
 * GIF carries one bit of alpha: a palette entry can be declared clear, and every
 * pixel pointing at it is a hole. Without this the encoder quantised in RGB only,
 * so a clear pixel took the colour its zeroed RGB channels happened to hold - black -
 * and a transparent icon or a 3D studio shadow came out on a black card. A frame is
 * judged first: one with no pixel under the alpha floor keeps the RGB565 palette it
 * has always had, so every opaque GIF this app has ever written is unchanged, byte
 * for byte. A frame that does hold clear pixels is quantised in gifenc's RGBA format
 * with one-bit alpha, which folds every faint pixel into a single clear entry, and
 * the caller writes the frame naming that entry as its transparent index.
 *
 * gifenc's own encoder takes over from there: a frame written with transparency is
 * given disposal 2 (restore to background), so a moving subject does not smear its
 * earlier frames through its own holes.
 *
 * Pure and codec-free: the two gifenc functions arrive as arguments, because the
 * library is loaded on demand in export.ts and must stay off the main chunk.
 */

/**
 * A gifenc colour table: `[r, g, b]` entries, or `[r, g, b, a]` when the frame was
 * quantised in the alpha format. Loosely typed for that reason.
 */
export type GifPalette = number[][];
export type GifQuantize = (rgba: Uint8ClampedArray, maxColors: number, opts?: Record<string, unknown>) => GifPalette;
export type GifApplyPalette = (rgba: Uint8ClampedArray, palette: GifPalette, format?: string) => Uint8Array;

/** Alpha at or above this is drawn; below it the pixel is a hole. GIF has no in-between. */
export const GIF_ALPHA_FLOOR = 128;

/** gifenc's palette formats: the alpha-carrying one, and the default the opaque path keeps. */
const RGBA_FORMAT = 'rgba4444';
const RGB_FORMAT = 'rgb565';

/** Does this frame hold anything to keep clear? One pass over the alpha channel, early out. */
export function gifHasClearPixels(rgba: Uint8ClampedArray): boolean {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i]! < GIF_ALPHA_FLOOR) return true;
  return false;
}

/**
 * The colour table for one frame. `clear` picks the format, so an opaque frame is
 * quantised exactly as before. `oneBitAlpha` rounds each quantised entry's alpha to
 * 0 or 255 at the same floor this module uses, and gifenc then clears those entries'
 * RGB to black and collapses them into one.
 */
export function gifPalette(quantize: GifQuantize, rgba: Uint8ClampedArray, clear: boolean): GifPalette {
  return clear
    ? quantize(rgba, 256, { format: RGBA_FORMAT, oneBitAlpha: GIF_ALPHA_FLOOR - 1 })
    : quantize(rgba, 256);
}

/** The indexed bitmap for one frame, matched to the palette gifPalette built. */
export function gifIndices(applyPalette: GifApplyPalette, rgba: Uint8ClampedArray, palette: GifPalette, clear: boolean): Uint8Array {
  return applyPalette(rgba, palette, clear ? RGBA_FORMAT : RGB_FORMAT);
}

/** The palette's clear entry, or -1 when it has none (an opaque frame always has none). */
export function gifClearIndex(palette: GifPalette): number {
  for (let i = 0; i < palette.length; i++) if (palette[i]!.length > 3 && palette[i]![3] === 0) return i;
  return -1;
}

/**
 * The frame options that declare the transparency, or nothing at all when the frame
 * has no clear entry - so an opaque frame is written with the same options as before.
 */
export function gifTransparency(clearIndex: number): { transparent?: boolean; transparentIndex?: number } {
  return clearIndex >= 0 ? { transparent: true, transparentIndex: clearIndex } : {};
}

/**
 * Put the holes back after a dithering pass, and take back the ones it invented.
 * Floyd-Steinberg diffuses RGB error only and cannot see alpha, so it maps a clear
 * pixel to whatever colour is nearest AND can map a drawn pixel onto the clear entry,
 * whose RGB gifenc zeroed - a near-black pixel would become a hole. Every pixel under
 * the floor is returned to the clear entry, and every pixel over it that took the
 * clear entry is moved to the nearest drawn colour. A no-op with no clear entry.
 */
export function gifMaskClear(indexed: Uint8Array, rgba: Uint8ClampedArray, palette: GifPalette, clearIndex: number): Uint8Array {
  if (clearIndex < 0) return indexed;
  const substitute = nearestDrawn(palette, clearIndex);
  for (let i = 0, a = 3; i < indexed.length; i++, a += 4) {
    if (rgba[a]! < GIF_ALPHA_FLOOR) indexed[i] = clearIndex;
    else if (indexed[i] === clearIndex) indexed[i] = substitute;
  }
  return indexed;
}

/** The drawn palette entry closest in RGB to the clear one, or the clear one alone. */
function nearestDrawn(palette: GifPalette, clearIndex: number): number {
  const clear = palette[clearIndex] ?? [0, 0, 0];
  let best = clearIndex, bestDistance = Infinity;
  for (let i = 0; i < palette.length; i++) {
    if (i === clearIndex) continue;
    const c = palette[i]!;
    const d = (c[0]! - clear[0]!) ** 2 + (c[1]! - clear[1]!) ** 2 + (c[2]! - clear[2]!) ** 2;
    if (d < bestDistance) { bestDistance = d; best = i; }
  }
  return best;
}
