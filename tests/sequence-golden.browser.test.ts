// SPDX-License-Identifier: MPL-2.0
/**
 * Preview versus export, as pixels, over TIME (plans/268 SI-00).
 *
 * `sequence-render.browser.test.ts` section 6 compares one static frame at t = 0. This
 * file asks the question at the instants where the two paths can disagree: either side
 * of a cut, in the middle of an enter or an exit, between two keyframes, inside a
 * crossfade, and on a video clip whose source frame has to be the same one.
 *
 * The two sides share no code of ours:
 *   export   `renderSequence` to a lossless APNG, decoded by the browser's ImageDecoder;
 *   preview  `createSequenceClock` seeked to the same instant on the same stage, then
 *            photographed by Playwright.
 *
 * TOLERANCE. The same two limits as section 6 of the export tier, for the same reason:
 * the compositor rasterises a box once and then moves the bitmap, the browser paints
 * the moved geometry, so edges antialias differently and interiors must not. The
 * numbers each case measured are printed at the end of the run.
 *
 * THE CROSSFADE CASE HAS A HISTORY. A crossfade is authored as a fade out of one clip
 * and a fade into the next, and the true handover is derived from the pair
 * (`crossfadeJunctions` in bridge/sequence-plan.ts). Until plans/268 SI-01 only the
 * export read that, and this file first pinned the difference as a number. The preview
 * now reads the same function, and the case is an ordinary parity case.
 */
import { readFileSync } from 'node:fs';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openHarness, browserGate, type Harness } from './helpers/sequence-browser.ts';
import { closeBrowser } from '../packages/node-shell/src/browsers.ts';

const gate = browserGate();
const measured: string[] = [];

const MAE_LIMIT = 1.0;
const OVER_LIMIT = 0.01;

interface Diff { error: string | null; mae: number; maxErr: number; overFrac: number; exportCode: number | null; previewCode: number | null }
interface GoldenApi {
  open(spec: unknown, fps: number): Promise<{ error: unknown; frames: number; w: number; h: number; logs?: string[] }>;
  pose(n: number): Promise<{ error: string | null; tMs: number; rect: { x: number; y: number; width: number; height: number } }>;
  diff(n: number, png: string): Promise<Diff>;
  close(): void;
}
interface SeqApi {
  perf: { audioSpan(key: string): Promise<{ error: string | null; duration: number; rms: number; cacheEqual: boolean; opfs: boolean; cancelled: boolean }>; adopt(base64: string, type: string): Promise<{ key: string; error: string | null }> };
  golden: GoldenApi;
  makeClip(spec: unknown): Promise<{ key: string }>;
}

describe('sequence preview matches the export over time (browser tier)', { skip: gate ?? false, concurrency: 1 }, () => {
  let H: Harness;

  before(async () => {
    H = await openHarness();
    // A photograph of the preview is only comparable at one device pixel per CSS pixel.
    const dpr = await H.page.evaluate(() => window.devicePixelRatio);
    assert.equal(dpr, 1, 'the browser context is not at a device pixel ratio of 1');
  });

  after(async () => {
    await H?.page.evaluate(() => (window as never as { SEQ: SeqApi }).SEQ.golden.close()).catch(() => {});
    await H?.close();
    await closeBrowser();
    for (const line of measured) console.log(line);
  });

  /** Export `spec`, then compare each frame in `frames` with a photograph of the preview. */
  async function run(name: string, spec: unknown, fps: number, frames: number[], codes = false): Promise<Map<number, Diff>> {
    const opened = await H.page.evaluate(
      async ([s, f]) => (window as never as { SEQ: SeqApi }).SEQ.golden.open(s, f as number),
      [spec, fps] as const,
    );
    assert.equal(opened.error, null, `${name}: the export failed: ${JSON.stringify(opened.error)} ${(opened.logs ?? []).join(' | ')}`);
    const out = new Map<number, Diff>();
    for (const n of frames) {
      assert.ok(n < opened.frames, `${name}: frame ${n} is past the export (${opened.frames} frames)`);
      const posed = await H.page.evaluate(async (i) => (window as never as { SEQ: SeqApi }).SEQ.golden.pose(i), n);
      assert.equal(posed.error, null, `${name}: ${posed.error}`);
      const png = await H.page.screenshot({ clip: posed.rect, type: 'png' });
      const d = await H.page.evaluate(
        async ([i, b64]) => (window as never as { SEQ: SeqApi }).SEQ.golden.diff(i as number, b64 as string),
        [n, png.toString('base64')] as const,
      );
      assert.equal(d.error, null, `${name} frame ${n}: ${d.error}`);
      measured.push(`[measured] ${name} @${Math.round(posed.tMs)}ms: mae=${d.mae.toFixed(3)} max=${d.maxErr.toFixed(0)} over24=${(d.overFrac * 100).toFixed(3)}%`
        + (codes ? ` source frame: export=${d.exportCode} preview=${d.previewCode}` : ''));
      out.set(n, d);
    }
    return out;
  }

  const assertParity = (name: string, diffs: Map<number, Diff>): void => {
    for (const [n, d] of diffs) {
      assert.ok(d.mae <= MAE_LIMIT, `${name} frame ${n}: mean difference ${d.mae.toFixed(3)} exceeds ${MAE_LIMIT}`);
      assert.ok(d.overFrac <= OVER_LIMIT, `${name} frame ${n}: ${(d.overFrac * 100).toFixed(2)}% of pixels differ by more than 24/255`);
    }
  };

  const A = '#d04020';
  const B = '#2060d0';

  test('a hard cut: the frame before and the frame after are the same in both', async () => {
    const spec = {
      w: 320, h: 240, seqMs: 2000, bg: '#0b1220',
      boxes: [
        { bg: A, start: 0, dur: 1000, lane: 'seq' },
        { bg: B, start: 1000, dur: 1000, lane: 'seq' },
      ],
    };
    assertParity('cut', await run('cut', spec, 10, [0, 9, 10, 19]));
  });

  test('an enter and an exit fade agree in the middle of each phase', async () => {
    const spec = {
      w: 320, h: 240, seqMs: 2000, bg: '#0b1220',
      boxes: [{ x: 60, y: 50, w: 200, h: 140, bg: '#ffffff', start: 400, dur: 1200, enter: 'fade', enterMs: 400, exit: 'fade', exitMs: 400 }],
    };
    // 600ms is half way in, 1000ms is at rest, 1400ms is half way out.
    assertParity('fade', await run('fade', spec, 10, [3, 6, 10, 14, 17]));
  });

  test('a slide agrees in the middle of its travel', async () => {
    const spec = {
      w: 320, h: 240, seqMs: 2000, bg: '#0b1220',
      boxes: [{ x: 60, y: 50, w: 200, h: 140, bg: '#20c0a0', start: 200, dur: 1600, enter: 'slide-left', enterMs: 600, exit: 'slide-down', exitMs: 600 }],
    };
    assertParity('slide', await run('slide', spec, 10, [4, 5, 10, 15, 16]));
  });

  test('a keyframed move agrees between its keys', async () => {
    const spec = {
      w: 320, h: 240, seqMs: 2000, bg: '#0b1220',
      boxes: [{ x: 20, y: 80, w: 80, h: 80, bg: '#e0a020', start: 0, dur: 2000, kf: 't0_x0*t2000_x180' }],
    };
    assertParity('keyframes', await run('keyframes', spec, 10, [0, 5, 10, 15, 19]));
  });

  test('a video clip shows the same source frame in the preview and in the file', async () => {
    const clip = await H.page.evaluate(async () => (window as never as { SEQ: SeqApi }).SEQ.makeClip({ frames: 60, fps: 30, w: 320, h: 240 }));
    const spec = { w: 320, h: 240, seqMs: 2000, boxes: [{ clip: clip.key, start: 0, dur: 2000, lane: 'seq' }] };
    // At 12 fps an odd frame falls in the MIDDLE of a 30 fps source frame (2.5 source
    // frames per step), so the comparison is about content and never about which way a
    // browser rounds a seek that is exactly on a frame boundary.
    const diffs = await run('video', spec, 12, [1, 7, 13, 21], true);
    for (const [n, d] of diffs) {
      assert.notEqual(d.exportCode, null, `video frame ${n}: no readable source frame in the export`);
      assert.equal(d.previewCode, d.exportCode, `video frame ${n}: the preview shows source frame ${d.previewCode}, the file shows ${d.exportCode}`);
    }
  });

  test('a clip at double speed shows the same source frame in both', async () => {
    const clip = await H.page.evaluate(async () => (window as never as { SEQ: SeqApi }).SEQ.makeClip({ frames: 90, fps: 30, w: 320, h: 240 }));
    const spec = { w: 320, h: 240, seqMs: 1200, boxes: [{ clip: clip.key, start: 0, dur: 1200, speed: 2, lane: 'seq' }] };
    // 12 fps at speed 2 is 5 source frames per step: shift by a clip-in of half a source
    // frame so that every sample is mid-frame here too.
    const diffs = await run('video speed 2', { ...spec, boxes: [{ ...spec.boxes[0], clipIn: 1000 / 60 }] }, 12, [1, 5, 9, 13], true);
    for (const [n, d] of diffs) {
      assert.notEqual(d.exportCode, null, `speed frame ${n}: no readable source frame in the export`);
      assert.equal(d.previewCode, d.exportCode, `speed frame ${n}: the preview shows source frame ${d.previewCode}, the file shows ${d.exportCode}`);
    }
  });

  // ── the crossfade handover (plans/268 SI-01) ────────────────────────────────
  //
  // This was the one KNOWN DIFFERENCE, pinned as a number before it was fixed: the
  // preview ran A's fade out before the cut and B's fade in after it, the file held A at
  // rest up to the cut and crossed the two over the handover. Measured then: mean error
  // 35 at 800ms and 28 at 1200ms, every pixel different. The preview now asks the
  // planner's own `crossfadeJunctions`, and the same frames measure 0.000 and 1.000.
  //
  // The 1.000 is one level of rounding on EVERY pixel of a flat half-and-half blend
  // (the browser and the canvas round 127.5 opposite ways), which is a uniform shift
  // and no visible difference. So the mean limit here is 1.5, and the share of pixels
  // more than 24 out stays at the ordinary limit, which is the one that would catch a
  // handover that went missing again.
  test('inside a crossfade the preview shows the same handover as the file', async () => {
    const spec = {
      w: 320, h: 240, seqMs: 2000, bg: '#000000',
      boxes: [
        { bg: A, start: 0, dur: 1000, lane: 'seq', exit: 'fade', exitMs: 400 },
        { bg: B, start: 1000, dur: 1000, lane: 'seq', enter: 'fade', enterMs: 400 },
      ],
    };
    // 800ms: A is still at rest. 1000ms: the cut. 1100 to 1300ms: inside the handover.
    const diffs = await run('crossfade', spec, 10, [5, 8, 10, 11, 12, 13, 15]);
    for (const [n, d] of diffs) {
      assert.ok(d.mae <= 1.5, `crossfade frame ${n}: mean difference ${d.mae.toFixed(3)} exceeds 1.5`);
      assert.ok(d.overFrac <= OVER_LIMIT, `crossfade frame ${n}: ${(d.overFrac * 100).toFixed(2)}% of pixels differ by more than 24/255`);
    }
  });

  test('a crossfade between two video clips keeps the outgoing clip playing through the handover', async () => {
    const [one, two] = await H.page.evaluate(async () => {
      const S = (window as never as { SEQ: SeqApi }).SEQ;
      return [
        await S.makeClip({ frames: 60, fps: 30, w: 320, h: 240, tint: '#203040' }),
        await S.makeClip({ frames: 60, fps: 30, w: 320, h: 240, tint: '#402030' }),
      ];
    });
    const spec = {
      w: 320, h: 240, seqMs: 2000, bg: '#000000',
      boxes: [
        // A uses the first second of a two second source, so it has media to hand over with.
        { clip: one.key, start: 0, dur: 1000, lane: 'seq', exit: 'fade', exitMs: 500 },
        { clip: two.key, start: 1000, dur: 1000, lane: 'seq', enter: 'fade', enterMs: 500 },
      ],
    };
    // Frames 13 and 15 at 12 fps are 1083ms and 1250ms: both inside the handover, and
    // both mid source frame. Two blended pictures carry no readable frame code, so the
    // comparison is the pixels. A preview that froze or dropped A would differ widely.
    const diffs = await run('video crossfade', spec, 12, [7, 13, 15, 21]);
    for (const [n, d] of diffs) {
      assert.ok(d.mae <= 2.5, `video crossfade frame ${n}: mean difference ${d.mae.toFixed(3)} exceeds 2.5`);
      assert.ok(d.overFrac <= 0.02, `video crossfade frame ${n}: ${(d.overFrac * 100).toFixed(2)}% of pixels differ by more than 24/255`);
    }
  });
  test('a marked range starts at its in point and retains the original transition phases', async () => {
    const spec = { w: 160, h: 120, seqMs: 3000, sequenceMarks: 'v1|i,1200|o,2200', boxes: [
      { start: 0, dur: 1500, lane: 'seq', bg: '#ff0000', exit: 'fade', exitMs: 500 },
      { start: 1500, dur: 1500, lane: 'seq', bg: '#0000ff', enter: 'fade', enterMs: 500 },
    ] };
    const diffs = await run('range', spec, 10, [0, 3, 5, 9]);
    for (const [n, d] of diffs) assert.ok(d.mae <= 1.5, `range frame ${n}: ${d.mae}`);
  });

  test('a split asset has independent source positions on both sides of its crossfade', async () => {
    const clip = await H.page.evaluate(async () => (window as never as { SEQ: SeqApi }).SEQ.makeClip({ frames: 72, fps: 24, w: 160, h: 120 }));
    const spec = { w: 160, h: 120, seqMs: 2000, boxes: [
      { clip: clip.key, start: 0, dur: 1000, lane: 'seq', exit: 'fade', exitMs: 500 },
      { clip: clip.key, start: 1000, dur: 1000, clipIn: 1500, lane: 'seq', enter: 'fade', enterMs: 500 },
    ] };
    const diffs = await run('shared-source crossfade', spec, 12, [11, 13, 15, 19]);
    for (const [n, d] of diffs) assert.ok(d.mae <= 2.5, `shared-source frame ${n}: ${d.mae}`);
  });

  test('preview decodes only the requested audio span and round-trips its PCM through OPFS', async () => {
    const source = await H.page.evaluate(async () => (window as never as { SEQ: SeqApi }).SEQ.makeClip({
      w: 160, h: 120, frames: 72, fps: 24, tone: { hz: 440, gain: 0.2, fromSec: 1, toSec: 2 },
    }));
    const result = await H.page.evaluate(async key => (window as never as { SEQ: SeqApi }).SEQ.perf.audioSpan(key), source.key);
    assert.equal(result.error, null);
    assert.ok(Math.abs(result.duration - 0.5) < 1 / 48_000, `duration ${result.duration}`);
    assert.ok(result.rms > 0.1 && result.rms < 0.2, `rms ${result.rms}`);
    if (result.opfs) assert.ok(result.cacheEqual, 'the disk cache preserves every sample');
    assert.ok(result.cancelled, 'an aborted span does not open a decoder');
  });

  test('open-GOP HEVC seeks agree with native video after an interior trim', async (t) => {
    const supported = await H.page.evaluate(async () => {
      try { return (await VideoDecoder.isConfigSupported({ codec: 'hvc1.1.6.L60.B0', codedWidth: 160, codedHeight: 120 })).supported; }
      catch { return false; }
    });
    if (!supported) { t.skip('HEVC decoding is unavailable in this browser build'); return; }
    const encoded = readFileSync(new URL('./fixtures/sequence/open-gop-hevc.mp4', import.meta.url)).toString('base64');
    const clip = await H.page.evaluate(async (data) => (window as never as { SEQ: SeqApi }).SEQ.perf.adopt(data, 'video/mp4'), encoded);
    assert.equal(clip.error, null);
    const frames = await run('open-GOP', { w: 160, h: 120, seqMs: 1000, boxes: [
      { clip: clip.key, start: 0, dur: 1000, clipIn: 1250, lane: 'seq' },
    ] }, 24, [0, 1, 4, 18, 22], true);
    for (const [n, frame] of frames) {
      assert.equal(frame.exportCode, 30 + n, 'export decodes the requested source frame after a GOP boundary');
      assert.ok(frame.previewCode != null && Math.abs(frame.previewCode - (30 + n)) <= 1, 'native video is within one source frame');
    }
  });

});
