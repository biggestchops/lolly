// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Resvg } from '@resvg/resvg-js';
import { browserInstalled, getBrowser, closeBrowser } from '../packages/node-shell/src/browsers.ts';
import { compileLottieSequence, lottieTransform } from '../engine/src/lottie-sequence.ts';
import type { LottieObject } from '../engine/src/lottie-model.ts';
import { writeDotLottie } from '../engine/src/dotlottie.ts';
import { movingLottie, nestedLottie, trimmedLottie } from './helpers/lottie-fixtures.ts';
import { appendLottieEdit, applyLottieEdits, type LottieEdit } from '../engine/src/lottie-edit.ts';
type Harness = typeof import('./helpers/lottie-browser-harness.ts');

test('edited mixed-rate clips with nested remapping match an independent dotLottie player', {
  skip: browserInstalled() ? false : 'No browser installed; set LOLLY_BROWSER_CHANNEL=chrome.', timeout: 60000,
}, async () => {
  const compiled = await build({ entryPoints: [fileURLToPath(new URL('./helpers/lottie-browser-harness.ts', import.meta.url))], bundle: true, platform: 'browser', format: 'iife', globalName: 'LOTTIE', write: false });
  const browser = await getBrowser(), context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.route('https://lottie.test/**', async route => {
      if (route.request().url().endsWith('.wasm')) await route.fulfill({ contentType: 'application/wasm', body: await readFile(new URL('../node_modules/@lottiefiles/dotlottie-web/dist/dotlottie-player.wasm', import.meta.url)) });
      else await route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
    });
    await page.goto('https://lottie.test/');
    await page.addScriptTag({ content: compiled.outputFiles[0]!.text });
    const animation = compileLottieSequence({ width: 128, height: 64, fps: 30, durationMs: 2000, layers: [movingLottie(), nestedLottie()].map((source, i) => ({
      name: `Clip ${i}`, x: i * 64, y: 0, w: 64, h: 64, rotation: 0, opacity: 1, startMs: i * 500, durationMs: 1000,
      content: { kind: 'animation' as const, animation: source, clipInMs: 200, speed: 1.5, fit: 'contain' as const },
    })) });
    const times = [0, 250, 499, 500, 750, 999, 1000, 1250, 1499, 1500, 1900];
    const frames = await page.evaluate(async ({ bytes, times }) => (globalThis as unknown as { LOTTIE: Harness }).LOTTIE.frames(bytes, times), { bytes: Array.from(writeDotLottie(animation)), times });
    const sourceFrames = await page.evaluate(async ({ bytes, times }) => (globalThis as unknown as { LOTTIE: Harness }).LOTTIE.frames(bytes, times), { bytes: Array.from(writeDotLottie(movingLottie())), times: [200, 575, 948.5, 950, 1325, 1698.5] });
    for (let i = 0; i < sourceFrames.length; i++) {
      const expected = new Resvg(sourceFrames[i]!.svg).render().pixels;
      const edited = new Resvg(frames[i]!.svg).render().pixels;
      let difference = 0;
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64 * 4; x++) difference += Math.abs(expected[y * 64 * 4 + x]! - edited[y * 128 * 4 + x]!);
      assert.ok(difference / expected.length < 0.2, `source-time mapping at ${times[i]} differs by ${difference / expected.length}`);
    }
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i]!;
      const expected = await sharp(new Resvg(frame.svg).render().asPng()).raw().toBuffer();
      assert.equal(frame.pixels.length, expected.length);
      let error = 0, active = 0;
      for (let j = 0; j < expected.length; j += 4) {
        // Compare premultiplied colour and alpha, allowing different edge antialiasing.
        const a = expected[j + 3]!, b = frame.pixels[j + 3]!;
        if (a || b) active++;
        error += Math.abs(a - b);
        for (let c = 0; c < 3; c++) error += Math.abs(expected[j + c]! * a / 255 - frame.pixels[j + c]! * b / 255);
      }
      assert.ok(error / Math.max(active * 4, 1) < 12, `frame ${times[i]}: mean active-channel error ${error / Math.max(active * 4, 1)}`);
      assert.equal(active > 0, times[i]! < 1500, `visibility at ${times[i]}`);
    }
    const png = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="128"><path fill="#00a040" d="M0 0h128v128H0z"/><path fill="#2060ff" d="M128 0h128v128H128z"/></svg>').render().asPng();
    const imageSequence = compileLottieSequence({ width: 64, height: 64, fps: 50, durationMs: 1000, layers: [{
      name: 'Packaged image', x: 10, y: 10, w: 30, h: 30, rotation: 10, opacity: 0.4, startMs: 0, durationMs: 1000,
      kf: 't0_x0_s1_o1_eh*t500_x10_s0.5_o0.5*t1000_x20_s1_o0',
      content: { kind: 'image', data: `data:image/png;base64,${png.toString('base64')}`, width: 256, height: 128, fit: 'cover' },
    }] });
    const images = await page.evaluate(async bytes => (globalThis as unknown as { LOTTIE: Harness }).LOTTIE.frames(bytes, [0, 250, 500, 750, 980]), Array.from(writeDotLottie(imageSequence)));
    const trimmed = compileLottieSequence({ width: 64, height: 64, fps: 30, durationMs: 1000, layers: [{ name: 'Trim paths', x: 0, y: 0, w: 64, h: 64, rotation: 0, opacity: 1, startMs: 0, durationMs: 1000, content: { kind: 'animation', animation: trimmedLottie(), clipInMs: 100, speed: 1.5, fit: 'contain' } }] });
    const trims = await page.evaluate(async bytes => (globalThis as unknown as { LOTTIE: Harness }).LOTTIE.frames(bytes, [0, 250, 500, 750, 950]), Array.from(writeDotLottie(trimmed)));
    const source = nestedLottie(), target = { asset: 'shared-id', index: 1 };
    const nested = source.assets![0]!.layers as LottieObject[];
    nested[0]!.parent = 2;
    const parentPose = lottieTransform(); parentPose.p = { a: 0, k: [2, 0, 0] };
    nested.unshift({ ty: 3, ind: 2, nm: 'Hidden reference', hd: true, ip: 10, op: 60, st: 0, ks: parentPose });
    let revision = '';
    const edits: LottieEdit[] = [
      { target, kind: 'layer', patch: { nm: 'Edited nested dot', ip: 15, op: 55 } },
      { target, kind: 'key', track: 'p', frame: 30, value: [40, 20, 0] },
      { target, kind: 'ease', track: 'p', frame: 10, dimension: 0, ease: [0.2, 0, 0.8, 1] },
      { target, kind: 'value', track: 'a', value: [2, 1, 0] },
      { target, kind: 'key', track: 'a', frame: 30, value: [4, -1, 0] },
      { target, kind: 'value', track: 's', value: [130, 80, 100] },
      { target, kind: 'key', track: 's', frame: 25, value: [80, 130, 100] },
      { target, kind: 'value', track: 'r', value: [30] },
      { target, kind: 'key', track: 'r', frame: 40, value: [60] },
      { target, kind: 'key', track: 'o', frame: 30, value: [40] },
      { target, kind: 'value', track: 'shapes/1/c', value: [0, 1, 0, 1] },
    ];
    for (const edit of edits) revision = await appendLottieEdit(source, revision, edit);
    const edited = await applyLottieEdits(source, revision);
    const internal = compileLottieSequence({ width: 64, height: 64, fps: 30, durationMs: 2000, layers: [{ name: 'Internal revision', x: 0, y: 0, w: 64, h: 64, rotation: 0, opacity: 1, startMs: 0, durationMs: 2000, content: { kind: 'animation', animation: edited, clipInMs: 0, speed: 1, fit: 'contain' } }] });
    const editedFrames = await page.evaluate(async bytes => (globalThis as unknown as { LOTTIE: Harness }).LOTTIE.frames(bytes, [0, 200, 400, 800, 1200, 1790, 1900]), Array.from(writeDotLottie(internal)));
    const nativeFrames = await page.evaluate(async bytes => (globalThis as unknown as { LOTTIE: Harness }).LOTTIE.frames(bytes, [0, 200, 400, 800, 1200, 1790, 1900]), Array.from(writeDotLottie(edited)));
    for (const [i, frame] of editedFrames.entries()) {
      const before = new Resvg(nativeFrames[i]!.svg).render().pixels, after = new Resvg(frame.svg).render().pixels;
      const error = before.reduce((sum, value, j) => sum + Math.abs(value - after[j]!), 0) / before.length;
      assert.ok(error < 0.2, `internal source motion at sample ${i}: ${error}`);
    }
    for (const frame of [...images, ...trims, ...editedFrames]) {
      const expected = await sharp(new Resvg(frame.svg).render().asPng()).raw().toBuffer();
      let error = 0, active = 0;
      for (let i = 0; i < expected.length; i += 4) {
        if (expected[i + 3] || frame.pixels[i + 3]) active++;
        error += Math.abs(expected[i + 3]! - frame.pixels[i + 3]!);
        for (let c = 0; c < 3; c++) error += Math.abs(expected[i + c]! * expected[i + 3]! / 255 - frame.pixels[i + c]! * frame.pixels[i + 3]! / 255);
      }
      assert.ok(error / expected.length < 2, `image/hold/scale/opacity or fractional-rate trim paths error ${error / expected.length}`);
      if (editedFrames.includes(frame)) {
        const index = editedFrames.indexOf(frame);
        if (error / Math.max(active * 4, 1) >= 12) {
          await writeFile(`/tmp/lolly-internal-player-${index}-expected.png`, new Resvg(frame.svg).render().asPng());
          await sharp(Buffer.from(frame.pixels), { raw: { width: 64, height: 64, channels: 4 } }).png().toFile(`/tmp/lolly-internal-player-${index}-actual.png`);
        }
        assert.ok(error / Math.max(active * 4, 1) < 12, `internal edits frame ${index}: active-channel error ${error / Math.max(active * 4, 1)}`);
      }
    }
  } finally { await context.close(); await closeBrowser(); }
});
