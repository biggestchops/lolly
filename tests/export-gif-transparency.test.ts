// SPDX-License-Identifier: MPL-2.0
/**
 * An animated GIF keeps the holes in its frames (plan 265 milestone 2, E2).
 *
 * Run with:
 *   node --test tests/export-gif-transparency.test.ts
 *
 * GIF carries one bit of alpha. Until now the encoder quantised in RGB only, so a
 * clear pixel took the colour its zeroed channels held - black - and a transparent
 * icon or a 3D studio's alpha shadow came out on a black card. `export-gif-alpha.ts`
 * holds the rules; `renderGif` in the web shell's export bridge applies them per frame.
 * The frames here are the RGBA a canvas hands that renderer, written straight, because
 * Node has no canvas; everything after that is the shipping code and the real gifenc.
 *
 * The GIF is read back with the small parser at the bottom of this file - header,
 * palettes, graphic control extensions and an LZW decode - so every claim is measured
 * from the encoded bytes, not from what the encoder was asked to do.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
// Node resolves gifenc to its CommonJS build, so the named exports arrive on default.
import gifenc from 'gifenc';
import {
  GIF_ALPHA_FLOOR,
  gifClearIndex,
  gifHasClearPixels,
  gifIndices,
  gifMaskClear,
  gifPalette,
  gifTransparency,
} from '../shells/web/src/bridge/export-gif-alpha.ts';

const { GIFEncoder, quantize, applyPalette } = gifenc;

const W = 8, H = 8;

/**
 * One frame of what a canvas holds: a solid block `blockW` wide, the rest clear.
 * `alpha` lets a case sit either side of the floor.
 */
function frame(blockW: number, rgb: [number, number, number], alpha = 255): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const on = x < blockW;
      px[i] = on ? rgb[0] : 0;
      px[i + 1] = on ? rgb[1] : 0;
      px[i + 2] = on ? rgb[2] : 0;
      px[i + 3] = on ? alpha : 0;
    }
  }
  return px;
}

/** The no-dither loop of renderGif, verbatim in shape: per-frame palette and holes. */
function encodeClip(frames: Uint8ClampedArray[]): Uint8Array {
  const gif = GIFEncoder();
  frames.forEach((pixels, i) => {
    const hasClear = gifHasClearPixels(pixels), framePalette = gifPalette(quantize, pixels, hasClear);
    const indexed = gifIndices(applyPalette, pixels, framePalette, hasClear), clear = gifTransparency(gifClearIndex(framePalette));
    gif.writeFrame(indexed, W, H, i === 0 ? { palette: framePalette, delay: 70, repeat: 0, ...clear } : { palette: framePalette, delay: 70, ...clear });
  });
  gif.finish();
  return gif.bytes();
}

test('a two-frame GIF with a clear region declares it, and the clear pixels carry that index', () => {
  const bytes = encodeClip([frame(4, [220, 30, 40]), frame(6, [220, 30, 40])]);
  const gif = readGif(bytes);
  assert.equal(gif.frames.length, 2, 'two frames were written');

  gif.frames.forEach((f, i) => {
    assert.equal(f.transparent, true, `frame ${i} declares transparency`);
    const table = f.palette ?? gif.globalPalette!;
    assert.ok(f.transparentIndex < table.length, `frame ${i}'s clear index is inside its colour table`);
    assert.deepEqual(table[f.transparentIndex], [0, 0, 0], `frame ${i}'s clear entry is the cleared colour`);
    assert.equal(f.dispose, 2, `frame ${i} restores the background, so the holes do not fill with the frame before`);
  });

  // Measured per pixel: the block is drawn, the rest is a hole.
  const first = gif.frames[0]!;
  const opaqueSpan = 4;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = first.pixels[y * W + x]!;
      if (x < opaqueSpan) assert.notEqual(idx, first.transparentIndex, `the block at ${x},${y} is drawn`);
      else assert.equal(idx, first.transparentIndex, `the pixel at ${x},${y} is clear`);
    }
  }
  // The second frame's own palette moved the edge with it.
  const second = gif.frames[1]!;
  assert.notEqual(second.pixels[5]!, second.transparentIndex, 'the wider block reaches x=5 in frame 1');
  assert.equal(second.pixels[6]!, second.transparentIndex, 'and x=6 is still a hole');
});

test('alpha under 128 is clear, alpha at 128 and above is drawn', () => {
  assert.equal(GIF_ALPHA_FLOOR, 128);
  assert.equal(gifHasClearPixels(frame(4, [10, 20, 30], 127)), true, 'a faint block is a hole');
  assert.equal(gifHasClearPixels(frame(8, [10, 20, 30], 128)), false, 'a block at the floor is drawn, and it covers the frame');

  const faint = frame(8, [10, 20, 30], 127);
  const palette = gifPalette(quantize, faint, true);
  const indexed = gifIndices(applyPalette, faint, palette, true);
  const clearIndex = gifClearIndex(palette);
  assert.ok(clearIndex >= 0, 'the palette carries a clear entry');
  assert.ok(indexed.every((i) => i === clearIndex), 'every pixel under the floor is clear');
});

test('a fully opaque clip is encoded exactly as it was before this change', () => {
  const frames = [frame(8, [12, 180, 90]), frame(8, [200, 40, 10])];

  const before = (() => {                       // the pre-change loop, kept here as the pin
    const gif = GIFEncoder();
    frames.forEach((pixels, i) => {
      const framePalette = quantize(pixels, 256);
      const indexed = applyPalette(pixels, framePalette);
      gif.writeFrame(indexed, W, H, i === 0 ? { palette: framePalette, delay: 70, repeat: 0 } : { palette: framePalette, delay: 70 });
    });
    gif.finish();
    return gif.bytes();
  })();

  assert.deepEqual(Buffer.from(encodeClip(frames)), Buffer.from(before), 'an opaque GIF is byte for byte what it was');
  assert.deepEqual(gifTransparency(gifClearIndex(gifPalette(quantize, frames[0]!, false))), {}, 'and nothing is declared');
});

test('the dithered path puts its holes back after the error diffusion', () => {
  const pixels = frame(4, [220, 30, 40]);
  const palette = gifPalette(quantize, pixels, true);
  const clearIndex = gifClearIndex(palette);
  // A dither pass reads RGB only, so it maps the clear half onto the nearest colour.
  const dithered = new Uint8Array(W * H).fill(clearIndex === 0 ? 1 : 0);
  const masked = gifMaskClear(dithered, pixels, palette, clearIndex);
  for (let i = 0; i < masked.length; i++) {
    const clear = pixels[i * 4 + 3]! < GIF_ALPHA_FLOOR;
    assert.equal(masked[i] === clearIndex, clear, `pixel ${i}`);
  }
  assert.equal(gifMaskClear(new Uint8Array([7, 7]), new Uint8ClampedArray(8), palette, -1)[0], 7, 'with no clear entry it is a no-op');
});

test('the dithered path also takes back a hole the diffusion invented', () => {
  // gifenc zeroes the clear entry's RGB, so a drawn near-black pixel can be mapped onto
  // it by an RGB-only dither. That pixel is drawn, and must stay drawn.
  const pixels = frame(4, [6, 6, 6]);                 // a nearly black block beside the holes
  const palette = gifPalette(quantize, pixels, true);
  const clearIndex = gifClearIndex(palette);
  assert.ok(clearIndex >= 0 && palette.length > 1, 'the palette has a clear entry and a drawn one');
  const dithered = new Uint8Array(W * H).fill(clearIndex);   // the worst case: everything went clear
  const masked = gifMaskClear(dithered, pixels, palette, clearIndex);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (x < 4) assert.notEqual(masked[i], clearIndex, `the drawn pixel at ${x},${y} kept a colour`);
      else assert.equal(masked[i], clearIndex, `the pixel at ${x},${y} is a hole`);
    }
  }
});

// ── A small GIF reader, enough to check what was written ─────────────────────

interface GifFrame {
  palette: number[][] | null;
  transparent: boolean;
  transparentIndex: number;
  dispose: number;
  pixels: Uint8Array;
}

function readGif(bytes: Uint8Array): { globalPalette: number[][] | null; frames: GifFrame[] } {
  assert.equal(Buffer.from(bytes.subarray(0, 6)).toString('latin1'), 'GIF89a', 'a GIF89a header');
  let p = 6;
  const width = bytes[p]! | (bytes[p + 1]! << 8);
  const height = bytes[p + 2]! | (bytes[p + 3]! << 8);
  const fields = bytes[p + 4]!;
  p += 7;
  let globalPalette: number[][] | null = null;
  if (fields & 0x80) {
    const size = 1 << ((fields & 0x07) + 1);
    globalPalette = readTable(bytes, p, size);
    p += size * 3;
  }
  const frames: GifFrame[] = [];
  let pending = { transparent: false, transparentIndex: 0, dispose: 0 };
  while (p < bytes.length) {
    const block = bytes[p++]!;
    if (block === 0x3b) break;                                   // trailer
    if (block === 0x21) {                                        // extension
      const label = bytes[p++]!;
      if (label === 0xf9) {
        p++;                                                     // block size, always 4
        const packed = bytes[p]!;
        pending = { transparent: (packed & 1) === 1, dispose: (packed >> 2) & 7, transparentIndex: bytes[p + 3]! };
        p += 4;
        p = skipSubBlocks(bytes, p);
      } else {
        p = skipSubBlocks(bytes, p);
      }
      continue;
    }
    assert.equal(block, 0x2c, `an image descriptor at ${p - 1}`);
    p += 8;                                                      // left, top, width, height
    const imgFields = bytes[p++]!;
    let palette: number[][] | null = null;
    if (imgFields & 0x80) {
      const size = 1 << ((imgFields & 0x07) + 1);
      palette = readTable(bytes, p, size);
      p += size * 3;
    }
    const minCodeSize = bytes[p++]!;
    const { data, next } = readSubBlocks(bytes, p);
    p = next;
    frames.push({ palette, ...pending, pixels: lzwDecode(data, minCodeSize, width * height) });
    pending = { transparent: false, transparentIndex: 0, dispose: 0 };
  }
  assert.equal(height, H);
  return { globalPalette, frames };
}

function readTable(bytes: Uint8Array, at: number, size: number): number[][] {
  const table: number[][] = [];
  for (let i = 0; i < size; i++) table.push([bytes[at + i * 3]!, bytes[at + i * 3 + 1]!, bytes[at + i * 3 + 2]!]);
  return table;
}

function skipSubBlocks(bytes: Uint8Array, at: number): number {
  let p = at;
  while (bytes[p]! !== 0) p += bytes[p]! + 1;
  return p + 1;
}

function readSubBlocks(bytes: Uint8Array, at: number): { data: Uint8Array; next: number } {
  const parts: number[] = [];
  let p = at;
  while (bytes[p]! !== 0) {
    const len = bytes[p++]!;
    for (let i = 0; i < len; i++) parts.push(bytes[p + i]!);
    p += len;
  }
  return { data: Uint8Array.from(parts), next: p + 1 };
}

/** The GIF flavour of LZW: variable code width, a clear code and an end code. */
function lzwDecode(data: Uint8Array, minCodeSize: number, expected: number): Uint8Array {
  const clearCode = 1 << minCodeSize, endCode = clearCode + 1;
  const out: number[] = [];
  let dict: number[][] = [];
  const reset = () => {
    dict = [];
    for (let i = 0; i < clearCode; i++) dict.push([i]);
    dict.push([], []);                                           // clear and end have no output
  };
  reset();
  let codeSize = minCodeSize + 1, bit = 0, previous: number[] | null = null;
  const read = (): number => {
    let code = 0;
    for (let i = 0; i < codeSize; i++, bit++) {
      code |= ((data[bit >> 3]! >> (bit & 7)) & 1) << i;
    }
    return code;
  };
  while (bit + codeSize <= data.length * 8) {
    const code = read();
    if (code === clearCode) { reset(); codeSize = minCodeSize + 1; previous = null; continue; }
    if (code === endCode) break;
    let entry: number[];
    if (code < dict.length) entry = dict[code]!;
    else if (previous) entry = [...previous, previous[0]!];
    else break;
    out.push(...entry);
    if (previous) dict.push([...previous, entry[0]!]);
    previous = entry;
    if (dict.length === 1 << codeSize && codeSize < 12) codeSize++;
  }
  assert.equal(out.length, expected, 'the decoded frame is the size the descriptor promised');
  return Uint8Array.from(out);
}
