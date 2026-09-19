// SPDX-License-Identifier: MPL-2.0
/**
 * The IN-PAGE half of the preview-versus-export evidence (plans/268 SI-00).
 *
 * Bundled into `sequence-browser-harness.ts` and reached as `window.SEQ.golden` and
 * `window.SEQ.perf`. It never runs in Node.
 *
 * GOLDEN FRAMES. The existing `fidelity()` compares ONE static frame at t = 0 against a
 * dom-to-image of the same DOM. That cannot see anything that happens over time, and
 * a rasteriser of ours sits on both sides of it. Here the two sides share nothing:
 *
 *   export   the real `renderSequence` to a lossless APNG, every frame decoded back
 *            with the browser's own ImageDecoder;
 *   preview  the real `createSequenceClock` seeked to the same instant over the same
 *            stage, photographed by Playwright (`page.screenshot`), which is the
 *            browser's painted output and none of our code.
 *
 * So the question asked is the user's question: does the frame in the file look like
 * the frame the editor showed at that time?
 *
 * PERFORMANCE. `perf.*` drives the same clock and reports numbers a person can act
 * on. Which source frame a <video> is showing is read from the binary code every
 * synthesised frame carries, so the measures count FRAMES, and a display that runs at
 * a different rate gives the same answer. Nothing here is asserted: the absolute
 * values belong to the machine. `scripts/eval-sequence-perf.ts` prints them.
 */

import { loadAudioSpan } from '../../shells/web/src/views/sequence-audio-span.ts';
import { createPcmStore } from '../../shells/web/src/views/sequence-pcm-store.ts';
import { createSequenceClock, type SequenceClock } from '../../shells/web/src/views/sequence-clock.ts';
import type { ExportRun, StageSpec } from './sequence-browser-harness.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

/** What the main harness lends this module. Passed in, so there is no import cycle. */
export interface GoldenDeps {
  exportSeq(spec: StageSpec, format: 'apng', opts: Any): Promise<ExportRun>;
  buildStage(spec: StageSpec): HTMLElement;
  blob(key: string): Blob | undefined;
  /** Register a blob in the page and get its key back (a clip the stage can name). */
  put(blob: Blob): string;
  readCode(data: Uint8ClampedArray, imgW: number, rect: { x: number; y: number; w: number; h: number }): number | null;
}

interface Pixels { w: number; h: number; data: Uint8ClampedArray }

export interface GoldenDiff {
  /** Mean of the per-pixel largest channel error, 0 to 255. */
  mae: number;
  /** Largest single channel error in the frame. */
  maxErr: number;
  /** Share of pixels whose largest channel error is above 24. */
  overFrac: number;
  /** The source-frame code read from each side, null where no code is readable. */
  exportCode: number | null;
  previewCode: number | null;
}

const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function toPixels(src: CanvasImageSource, w: number, h: number): Pixels {
  const cvs = new OffscreenCanvas(w, h);
  const ctx = cvs.getContext('2d', { willReadFrequently: true }) as Any;
  ctx.drawImage(src, 0, 0, w, h);
  return { w, h, data: ctx.getImageData(0, 0, w, h).data };
}

/** Every frame of an animated PNG, decoded by the browser and not by us. */
async function decodeApng(blob: Blob): Promise<Pixels[]> {
  const ID = (globalThis as Any).ImageDecoder;
  if (!ID) throw new Error('no ImageDecoder in this browser');
  const dec = new ID({ data: await blob.arrayBuffer(), type: 'image/png' });
  await dec.tracks.ready;
  await dec.completed;
  const count: number = dec.tracks.selectedTrack?.frameCount ?? 1;
  const out: Pixels[] = [];
  for (let i = 0; i < count; i++) {
    const { image } = await dec.decode({ frameIndex: i });
    out.push(toPixels(image, image.displayWidth, image.displayHeight));
    image.close();
  }
  dec.close();
  return out;
}

/** The stage's visible videos have found their frame and stayed on it. */
async function settleVideos(root: HTMLElement, quietMs: number): Promise<void> {
  const deadline = performance.now() + 4000;
  let quietSince = performance.now();
  while (performance.now() < deadline) {
    await nextFrame();
    const busy = [...root.querySelectorAll('video')].some((v) => {
      const hidden = (v.closest('.lolly-box') as HTMLElement | null)?.classList.contains('seq-off');
      return !hidden && (v.seeking || v.readyState < 2);
    });
    if (busy) quietSince = performance.now();
    else if (performance.now() - quietSince >= quietMs) return;
  }
}

function compare(a: Pixels, b: Pixels, deps: GoldenDeps): GoldenDiff {
  let sum = 0;
  let over = 0;
  let maxErr = 0;
  const n = a.data.length / 4;
  for (let i = 0; i < a.data.length; i += 4) {
    let d = 0;
    // Over an opaque backdrop, so a transparent pixel and a black one are told apart.
    for (let c = 0; c < 3; c++) {
      const av = ((a.data[i + c] as number) * (a.data[i + 3] as number)) / 255;
      const bv = ((b.data[i + c] as number) * (b.data[i + 3] as number)) / 255;
      d = Math.max(d, Math.abs(av - bv));
    }
    sum += d;
    if (d > 24) over++;
    if (d > maxErr) maxErr = d;
  }
  const rect = { x: 0, y: 0, w: a.w, h: a.h };
  return {
    mae: sum / n, maxErr, overFrac: over / n,
    exportCode: deps.readCode(a.data, a.w, rect),
    previewCode: deps.readCode(b.data, b.w, rect),
  };
}

export function goldenApi(deps: GoldenDeps): Any {
  let frames: Pixels[] = [];
  let fps = 10;
  let fromMs = 0;
  let clock: SequenceClock | null = null;
  let stage: HTMLElement | null = null;

  const close = (): void => {
    try { clock?.destroy(); } catch { /* already gone */ }
    clock = null;
    frames = [];
  };

  /**
   * Export the stage, keep every frame, then put the REAL preview clock on the same
   * stage. The export leaves the stage in the document, exactly as `fidelity()` relies
   * on, so both sides read one DOM.
   */
  async function open(spec: StageSpec, atFps = 10): Promise<Any> {
    close();
    fps = atFps;
    fromMs = Number(spec.sequenceMarks?.match(/\|i,(\d+)/)?.[1] ?? 0);
    const run = await deps.exportSeq(spec, 'apng', { fps });
    if (!run.key) return { error: run.error, logs: run.logs };
    frames = await decodeApng(deps.blob(run.key) as Blob);
    stage = document.querySelector('.seq-test-target') as HTMLElement;
    clock = createSequenceClock({ canvasEl: stage });
    const first = frames[0] as Pixels;
    return { error: null, frames: frames.length, w: first.w, h: first.h, fps, logs: run.logs };
  }

  /** Park the preview on export frame `n` and say where to photograph. */
  async function pose(n: number): Promise<Any> {
    if (!clock || !stage) return { error: 'golden.open() was not called' };
    const tMs = fromMs + (n * 1000) / fps;
    clock.seek(tMs);
    await nextFrame();
    await nextFrame();
    // One confirm window plus the single nudge the seeker is allowed.
    await settleVideos(stage, 350);
    const art = stage.querySelector('.artboard') as HTMLElement;
    const r = art.getBoundingClientRect();
    return { error: null, tMs, rect: { x: r.x, y: r.y, width: r.width, height: r.height } };
  }

  /** Compare export frame `n` with a PNG photograph of the preview (base64). */
  async function diff(n: number, pngBase64: string): Promise<Any> {
    const want = frames[n];
    if (!want) return { error: `no export frame ${n} (have ${frames.length})` };
    const bytes = Uint8Array.from(atob(pngBase64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    if (bmp.width !== want.w || bmp.height !== want.h) {
      const got = `${bmp.width}x${bmp.height}`;
      bmp.close();
      return { error: `size: export ${want.w}x${want.h}, preview ${got}` };
    }
    const shot = toPixels(bmp, want.w, want.h);
    bmp.close();
    return { error: null, ...compare(want, shot, deps) };
  }

  return { open, pose, diff, close };
}

// ── performance ──────────────────────────────────────────────────────────────

export interface PerfClip { key: string; fps: number; frames: number }

export function perfApi(deps: GoldenDeps): Any {
  const probe = new OffscreenCanvas(160, 40);
  const pctx = probe.getContext('2d', { willReadFrequently: true }) as Any;

  /** The source frame a <video> is painting now, from its own code strip. */
  function codeOf(v: HTMLVideoElement): number | null {
    // No readiness check: a seeking element still paints its last frame, and what is
    // painted is the measure. `seekingTicks` reports the readiness side on its own.
    try {
      // The code strip is the top sixth of the picture; that is all that is copied.
      pctx.drawImage(v, 0, 0, v.videoWidth, v.videoHeight / 6, 0, 0, 160, 40);
      const px = pctx.getImageData(0, 0, 160, 40).data;
      return deps.readCode(px, 160, { x: 0, y: 0, w: 160, h: 240 });
    } catch {
      return null;
    }
  }

  /** Count every `currentTime` write to one element: each one is a seek. */
  function countSeeks(v: HTMLVideoElement): { n: () => number; undo: () => void } {
    const proto = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime') as PropertyDescriptor;
    let n = 0;
    Object.defineProperty(v, 'currentTime', {
      configurable: true,
      get() { return proto.get?.call(this); },
      set(x: number) { n++; proto.set?.call(this, x); },
    });
    return { n: () => n, undo: () => { delete (v as Any).currentTime; } };
  }

  function mount(spec: StageSpec): { stage: HTMLElement; clock: SequenceClock; videos: HTMLVideoElement[] } {
    const stage = deps.buildStage(spec);
    const clock = createSequenceClock({ canvasEl: stage });
    return { stage, clock, videos: [...stage.querySelectorAll('video')] };
  }

  async function warm(videos: HTMLVideoElement[]): Promise<void> {
    await Promise.all(videos.map((v) => new Promise<void>((res) => {
      if (v.readyState >= 2) { res(); return; }
      v.addEventListener('loadeddata', () => res(), { once: true });
      v.load();
    })));
  }

  /**
   * SCRUB TO PIXEL. Seek, then count display frames until the visible video paints the
   * source frame that instant asks for. Reported in frames missed and in ms.
   */
  async function scrub(clip: PerfClip, targetsMs: number[]): Promise<Any> {
    const durMs = (clip.frames / clip.fps) * 1000;
    const { clock, videos } = mount({ w: 320, h: 240, seqMs: durMs, boxes: [{ clip: clip.key, start: 0, dur: durMs, lane: 'seq' }] });
    await warm(videos);
    const v = videos[0] as HTMLVideoElement;
    const rows: Any[] = [];
    for (const tMs of targetsMs) {
      const want = Math.floor((tMs / 1000) * clip.fps + 1e-6);
      const t0 = performance.now();
      clock.seek(tMs);
      let missed = 0;
      let got: number | null = null;
      while (performance.now() - t0 < 2000) {
        await nextFrame();
        got = codeOf(v);
        if (got != null && Math.abs(got - want) <= 1) break;
        missed++;
      }
      rows.push({ tMs, want, got, framesMissed: missed, ms: Math.round(performance.now() - t0) });
    }
    clock.destroy();
    return { rows };
  }

  /**
   * PLAY ACROSS A CUT. Two clips meet on the main row. While the clock plays through
   * the junction, every display frame records which clip is on screen and which source
   * frame it paints. A frame is LATE when the painted source frame is more than two
   * frames from what the playhead asks for, and BLANK when the clip on screen paints no
   * readable frame at all (the thing a viewer sees as a flash at the cut). SEEKING
   * counts the display frames on which the clip on screen was still looking for its
   * frame, whatever it painted meanwhile.
   */
  async function playAcrossCut(a: PerfClip, b: PerfClip, passes = 1): Promise<Any> {
    const halfMs = 1500;
    const spec: StageSpec = {
      w: 320, h: 240, seqMs: halfMs * 2,
      boxes: [
        { clip: a.key, start: 0, dur: halfMs, lane: 'seq' },
        { clip: b.key, start: halfMs, dur: halfMs, lane: 'seq' },
      ],
    };
    const { stage, clock, videos } = mount(spec);
    await warm(videos);
    const boxes = [...stage.querySelectorAll<HTMLElement>('.lolly-box')];
    const out: Any[] = [];
    for (let p = 0; p < passes; p++) {
      clock.pause();
      clock.seek(halfMs - 600);
      await settleVideos(stage, 200);
      let late = 0;
      let blank = 0;
      let ticks = 0;
      let blankAfterCut = 0;
      let seekingTicks = 0;
      clock.play();
      const t0 = performance.now();
      while (performance.now() - t0 < 1200) {
        // After the frame's own callbacks: the clock applies the DOM inside its rAF, and a
        // sample taken before that would read this frame's time against last frame's DOM.
        await nextFrame();
        await sleep(0);
        const tMs = clock.t();
        // What is on screen is read from the DOM, which is what a viewer sees.
        const idx = boxes.findIndex((el) => !el.classList.contains('seq-off'));
        ticks++;
        if (idx < 0) { blank++; if (tMs >= halfMs) blankAfterCut++; continue; }
        const clip = idx === 0 ? a : b;
        const start = idx === 0 ? 0 : halfMs;
        const want = Math.floor(((tMs - start) / 1000) * clip.fps + 1e-6);
        const onScreen = videos[idx] as HTMLVideoElement;
        if (onScreen.seeking || onScreen.readyState < 2) seekingTicks++;
        const got = codeOf(onScreen);
        if (got == null) { blank++; if (idx === 1) blankAfterCut++; }
        else if (Math.abs(got - want) > 2) late++;
      }
      clock.pause();
      out.push({ pass: p + 1, ticks, late, blank, blankAfterCut, seekingTicks });
    }
    clock.destroy();
    return { passes: out };
  }

  /**
   * CORRECTIVE SEEKS AGAINST SPEED (the baseline plans/268 SI-03 asks for). One clip
   * at `speed`, played for `playMs`: how many times did the clock write `currentTime`?
   * Steady playback needs none. A tolerance that is too tight for the speed shows up
   * here as a stream of them.
   */
  async function driftSeeks(clip: PerfClip, speed: number, playMs = 2500): Promise<Any> {
    const srcMs = (clip.frames / clip.fps) * 1000;
    const durMs = Math.floor(srcMs / speed) - 100;
    const { stage, clock, videos } = mount({ w: 320, h: 240, seqMs: durMs, boxes: [{ clip: clip.key, start: 0, dur: durMs, speed, lane: 'seq' }] });
    await warm(videos);
    const v = videos[0] as HTMLVideoElement;
    clock.seek(0);
    await settleVideos(stage, 200);
    const seeks = countSeeks(v);
    clock.play();
    const run = Math.min(playMs, durMs - 200);
    // Fewer seeks is only good news if the picture stayed with the playhead, so the
    // drift is sampled on every display frame: how far the element is from where the
    // playhead says it should be, in TIMELINE ms (source drift divided by speed),
    // which is the number a viewer can see. The first 300ms are start-up and are left out.
    let sum = 0;
    let count = 0;
    let worst = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < run) {
      await nextFrame();
      if (performance.now() - t0 < 300 || v.seeking) continue;
      const wantSec = (clock.t() / 1000) * speed;
      const d = Math.abs(v.currentTime - wantSec) / speed * 1000;
      sum += d;
      count++;
      if (d > worst) worst = d;
    }
    clock.pause();
    const n = seeks.n();
    seeks.undo();
    clock.destroy();
    return {
      speed, playedMs: run, seeks: n, seeksPerSec: Math.round((n / (run / 1000)) * 100) / 100,
      meanDriftMs: count ? Math.round(sum / count) : null, maxDriftMs: Math.round(worst),
    };
  }

  /**
   * Take a REAL media file (base64) so `driftSeeks` can run against the material that
   * matters: long-GOP camera footage, not the light synthetic clip. It carries no frame
   * code, so the scrub and cut measures cannot read it.
   */
  async function adopt(base64: string, type: string): Promise<Any> {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const key = deps.put(new Blob([bytes], { type }));
    const v = document.createElement('video');
    v.muted = true;
    v.src = URL.createObjectURL(deps.blob(key) as Blob);
    const durSec = await new Promise<number>((res) => {
      v.addEventListener('loadedmetadata', () => res(Number.isFinite(v.duration) ? v.duration : 0), { once: true });
      v.addEventListener('error', () => res(0), { once: true });
    });
    URL.revokeObjectURL(v.src);
    if (!(durSec > 0)) return { error: 'this browser cannot play that file' };
    return { error: null, key, fps: 30, frames: Math.floor(durSec * 30), w: v.videoWidth, h: v.videoHeight };
  }

  async function audioSpan(key: string): Promise<Any> {
    const url = URL.createObjectURL(deps.blob(key)!);
    const controller = new AbortController();
    const logs: string[] = [];
    const store = createPcmStore(48_000 * 2 * 4);
    try {
      const span = await loadAudioSpan(url, { from: 1.2, to: 1.7, rate: 48_000 }, controller.signal, (_level, line) => logs.push(line));
      if (!span) return { error: 'no span', logs };
      let sum = 0; const samples = span.getChannelData(0);
      for (const sample of samples) sum += sample * sample;
      await store.put('a', span);
      const copy = await store.get('a');
      const cacheEqual = !!copy && copy.length === span.length && copy.numberOfChannels === span.numberOfChannels
        && copy.getChannelData(0).every((value, i) => value === samples[i]);
      controller.abort();
      const cancelled = await loadAudioSpan(url, { from: 0, to: 1, rate: 48_000 }, controller.signal, () => {});
      return { error: null, duration: span.duration, rms: Math.sqrt(sum / samples.length), cacheEqual,
        opfs: !!navigator.storage?.getDirectory, cancelled: cancelled === null, logs };
    } finally { store.destroy(); URL.revokeObjectURL(url); }
  }
  return { scrub, playAcrossCut, driftSeeks, adopt, audioSpan };
}
