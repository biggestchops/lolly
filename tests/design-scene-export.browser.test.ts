// SPDX-License-Identifier: MPL-2.0
/**
 * 3D scene boxes in an export, and under the playhead (plan 265 milestone 3, lane C).
 *
 * Run with:
 *   node --import ./tests/css-stub.mjs --test tests/design-scene-export.browser.test.ts
 *
 * Decision Q19 says every export draws every scene through the studio pool and embeds the
 * result, never photographs a live WebGL canvas. That is one rule with four visible
 * consequences, and this file is the evidence for each:
 *
 *   1. a video export of the lane document moves - the badge has turned between an early
 *      frame and a later one - and its box is never blank;
 *   2. a PNG still of the artboard embeds the scene at the box's own pixel size, and the
 *      pixels are the studio's own render of the same values at that size;
 *   3. a scene whose renderer refuses fails the export with the studio's words, rather
 *      than shipping a document with a hole in it;
 *   4. scrubbing the timeline moves the one LIVE scene box, and only by drawing a new
 *      frame (the studio's own counter says so).
 *
 * The page is the shared studio harness (tests/helpers/studio3d-browser.ts) with the
 * export bridge, the compositor, the clock and the Design enhancer added to its bundle,
 * driving the two documents lane T0 built (tests/helpers/design-scene.ts).
 *
 * The first test needs no browser at all and is not skipped with the rest: it is the C2
 * coverage question, which is a DOM walk over the document the tool itself renders.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { after, before, describe, it, test } from 'node:test';
import { JSDOM } from 'jsdom'; // typed by tests/jsdom.d.ts (no @types/jsdom exists)
import type { Page } from 'playwright';

import { loadTool } from '../engine/src/loader.ts';
import { sequenceTimeElements } from '../shells/web/src/bridge/sequence-dom.ts';
import {
  designSceneAssetUrls,
  designSceneDocumentHtml,
  designSceneLane,
  designSceneStill,
  serveDesignSceneAssets,
} from './helpers/design-scene.ts';
import { type StudioHarness, startStudioHarness, studioSkip } from './helpers/studio3d-browser.ts';

const root = resolve(import.meta.dirname, '..');
/** Eight samples, as every studio suite uses: the default 64 is minutes under SwiftShader. */
const SAMPLES = 'samples=8';
/** The lane document's own sequence length, from its `data-seq-ms`. */
const LANE_MS = 4000;
/** Both fixture documents lay out on the same artboard, and their scene box is 640 square. */
const STAGE = { w: 1920, h: 1080 };
const SCENE_BOX = 640;

/** Every scene marker's query gets the cheap sample count before it reaches the page. */
function withSamples(html: string): string {
  return html.replace(
    /data-lolly-scene="([^"]*)"/g,
    (_all, scene: string) => `data-lolly-scene="${scene}${scene ? '&amp;' : ''}${SAMPLES}"`,
  );
}

/** The documents, rendered by the shipped community/design tool with real asset urls. */
async function documents(): Promise<{ still: string; lane: string }> {
  const urls = designSceneAssetUrls();
  // An id with no catalog file keeps its own name as the url, which is how a procedural
  // source (the lane document's zzfxm bed) stays procedural instead of becoming a fetch.
  const overrides = {
    assets: { get: async (id: string) => ({ id, url: urls[id] ?? id }) },
  };
  return {
    still: withSamples(await designSceneDocumentHtml(designSceneStill, overrides)),
    lane: withSamples(await designSceneDocumentHtml(designSceneLane, overrides)),
  };
}

// ── C2: which boxes the playhead walks ──────────────────────────────────────

test('a scene box on the lane is walked by the clock; one off the lane is scenery', async () => {
  const docs = await documents();
  const read = (html: string): HTMLElement => {
    const dom = new JSDOM(`<body>${html}</body>`);
    return dom.window.document.body as unknown as HTMLElement;
  };
  const lane = read(docs.lane);
  const laneMarker = lane.querySelector('[data-lolly-scene]') as HTMLElement;
  const laneBox = laneMarker.closest('.lolly-box') as HTMLElement;
  assert.equal(laneBox.getAttribute('data-t-start'), '500', 'the fixture box starts at 0.5 s');
  assert.ok(
    sequenceTimeElements(lane).includes(laneBox),
    'a timed scene box is in the walked set, so driveMedia is offered it every frame',
  );

  // …and one that is not on the lane is NOT, by design (C2). It carries no start and no
  // keyframe track, so nothing about it changes with time: walking it would cost a
  // selector match per frame to do nothing. Its poster is its whole appearance.
  const still = read(docs.still);
  const stillBox = (still.querySelector('[data-lolly-scene]') as HTMLElement).closest(
    '.lolly-box',
  ) as HTMLElement;
  assert.equal(stillBox.getAttribute('data-t-start'), null);
  assert.ok(!sequenceTimeElements(still).includes(stillBox), 'scenery is not walked');
});

// ── the browser tier ────────────────────────────────────────────────────────

/** What one export or scrub reports back. */
interface StillReport {
  ok: boolean;
  error: string;
  /** The exported picture's own pixel size. */
  width: number;
  height: number;
  /** Mean absolute channel difference between the scene region and a direct studio render. */
  delta: number;
  /** The marker's `<img>` natural size: the poster the walker actually read. */
  poster: [number, number] | null;
}

interface VideoReport {
  ok: boolean;
  error: string;
  /** The compositor's own log lines plus the layer kinds it read, for a failure message. */
  notes: string;
  size: number;
  width: number;
  height: number;
  /** Mean absolute channel difference between the two sampled frames, scene region only. */
  moved: number;
  /** Channel spread inside the scene region on each sampled frame; a blank box is flat. */
  spread: [number, number];
}

/** What the one live box's marker looks like, before and after an export runs over it. */
interface MarkerState {
  sceneState: string;
  canvases: number;
  /** The live renderer's canvas display style: '' is showing, 'none' is hidden for a shot. */
  canvasDisplay: string;
  posterHidden: boolean;
}

interface ScrubStep {
  ms: number;
  /** Frames the studio actually drew by then (a cached frame is not counted). */
  frames: number;
  /** The phase the clock last drove this box to, from `data-scene-t`. */
  sceneT: string;
}

interface SceneExportApi {
  mount(html: string): Promise<number>;
  posters(count: number, timeoutMs: number): Promise<number>;
  select(ids: string[]): Promise<string>;
  scrub(msList: number[]): Promise<ScrubStep[]>;
  video(fps: number, width: number, height: number): Promise<VideoReport>;
  still(width: number, height: number, compare: boolean): Promise<StillReport>;
  markerState(): MarkerState;
  failNextUpdate(message: string): void;
}

declare global {
  interface Window {
    /** The Design scene export page API (this suite). */
    sceneExport?: SceneExportApi;
  }
}

/**
 * Page code appended to the harness bundle. It shares the harness page's own names
 * (container, nextFrame) and adds window.sceneExport.
 */
const extraSource = `
import { createExportAPI } from './shells/web/src/bridge/export.ts';
import { renderSequence } from './shells/web/src/bridge/sequence-render.ts';
import { parseSequenceStage as parseStage } from './shells/web/src/bridge/sequence-plan.ts';
import { createSequenceClock } from './shells/web/src/views/sequence-clock.ts';
import {
  designScenesSettled,
  designSceneFor,
  destroyDesignScenes,
  mountDesignScenes,
  setSelectedScenes,
} from './shells/web/src/lib/design-scene-mount.ts';
import { renderStudioPoster } from './shells/web/src/lib/studio3d/poster.ts';
import { inspectToolStudio as inspectStudio } from './shells/web/src/lib/studio3d/mount.ts';
import { StudioRenderer as ExportRenderer } from './shells/web/src/lib/studio3d/renderer.ts';

document.documentElement.style.setProperty('--font-brand', 'Harness Sans');

let sceneManifest = null;
const exportHost = {
  version: '1',
  log: () => {},
  profile: { get: async () => ({}) },
  assets: {
    async get(id) { return { id, url: '/catalog/' + id }; },
    async bytes(target) {
      const url = typeof target === 'string' ? target : target.url;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Fixture missing: ' + url);
      return new Uint8Array(await res.arrayBuffer());
    },
  },
  text: {
    async fontUrl() { return { url: '/harness.ttf' }; },
    async toPath({ text, fontSize, letterSpacing }) {
      const w = fontSize * 0.6, adv = w + fontSize * 0.1 + (letterSpacing || 0);
      let d = '';
      for (let i = 0; i < text.length; i++) {
        if (text[i] === ' ') continue;
        const x = i * adv;
        d += 'M' + x + ' ' + (-fontSize * 0.7) + 'h' + w + 'v' + (fontSize * 0.7) + 'h' + (-w) + 'Z';
      }
      return { d, advanceWidth: text.length * adv };
    },
  },
};
const exportApi = createExportAPI(exportHost);
const sceneOptions = {
  host: exportHost,
  manifest: async () => {
    if (!sceneManifest) sceneManifest = await fetch('/3d-studio.json').then((r) => r.json());
    return sceneManifest;
  },
};
const sceneRead = async (url, signal) => {
  signal.throwIfAborted();
  return await exportHost.assets.bytes(url);
};

// The Design tool's render root is .lolly-frames; the artboard inside it is the one
// .lolly-frame-page, sized in stage-native px by the hook. The real shell mounts the root
// at the tool's own render size, so mount() below does the same.
const stageEl = () => container.querySelector('.lolly-frames');
const pageEl = () => container.querySelector('.lolly-frame-page');
const markerEl = () => container.querySelector('[data-lolly-scene]');
const boxOf = (marker) => marker.closest('.lolly-box');
/** The scene box's own rect in stage-native px, straight off the inline style. */
const sceneRect = () => {
  const box = boxOf(markerEl());
  return {
    x: parseFloat(box.style.left) || 0, y: parseFloat(box.style.top) || 0,
    w: parseFloat(box.style.width) || 0, h: parseFloat(box.style.height) || 0,
  };
};
const nativeSize = () => {
  const page = pageEl();
  return { w: parseFloat(page.style.width) || 0, h: parseFloat(page.style.height) || 0 };
};

/** Mean absolute channel difference between two RGBA buffers of the same size. */
const meanDelta = (a, b) => {
  let sum = 0, n = 0;
  for (let i = 0; i < a.length; i += 4) {
    sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    n += 3;
  }
  return n ? sum / n : 0;
};

/** Mean absolute deviation from the buffer's own mean: 0 is a flat, blank box. */
const spreadOf = (px) => {
  let sum = 0, n = 0;
  for (let i = 0; i < px.length; i += 4) { sum += px[i] + px[i + 1] + px[i + 2]; n += 3; }
  const mean = n ? sum / n : 0;
  let dev = 0;
  for (let i = 0; i < px.length; i += 4) {
    dev += Math.abs(px[i] - mean) + Math.abs(px[i + 1] - mean) + Math.abs(px[i + 2] - mean);
  }
  return n ? dev / n : 0;
};

const bitmapPixels = async (source, w, h) => {
  const bitmap = source instanceof ImageBitmap ? source : await createImageBitmap(source);
  const cvs = new OffscreenCanvas(w, h);
  const ctx = cvs.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return ctx.getImageData(0, 0, w, h).data;
};

/** The pixels of one rectangle of a blob's picture, at the blob's own resolution. */
const regionOf = async (blob, rect, scale) => {
  const bitmap = await createImageBitmap(blob);
  const w = Math.round(rect.w * scale), h = Math.round(rect.h * scale);
  const cvs = new OffscreenCanvas(w, h);
  const ctx = cvs.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, Math.round(rect.x * scale), Math.round(rect.y * scale), w, h, 0, 0, w, h);
  const full = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return { data: ctx.getImageData(0, 0, w, h).data, full, w, h };
};

/** One output frame of a webm, as RGBA, decoded with mediabunny. */
const decodeFrames = async (blob, times) => {
  const mb = await import('mediabunny');
  const input = new mb.Input({
    formats: [mb.MP4, mb.QTFF, mb.WEBM, mb.MATROSKA],
    source: new mb.BlobSource(blob),
  });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return null;
    const w = await track.getDisplayWidth(), h = await track.getDisplayHeight();
    const cvs = new OffscreenCanvas(w, h);
    const ctx = cvs.getContext('2d', { willReadFrequently: true });
    const out = [];
    for (const t of times) {
      const sink = new mb.VideoSampleSink(track);
      const sample = await sink.getSample(t);
      if (!sample) { out.push(null); continue; }
      ctx.clearRect(0, 0, w, h);
      sample.draw(ctx, 0, 0, w, h);
      sample.close();
      out.push({ data: ctx.getImageData(0, 0, w, h).data, w, h });
    }
    return out;
  } finally {
    input.dispose();
  }
};

const cropFrom = (frame, rect, scale) => {
  const x0 = Math.round(rect.x * scale), y0 = Math.round(rect.y * scale);
  const w = Math.round(rect.w * scale), h = Math.round(rect.h * scale);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const from = ((y0 + y) * frame.w + x0) * 4;
    out.set(frame.data.subarray(from, from + w * 4), y * w * 4);
  }
  return out;
};

let clock = null;

window.sceneExport = {
  async mount(html) {
    if (!document.getElementById('design-css')) {
      const css = await fetch('/design.css').then((r) => r.text());
      const style = document.createElement('style');
      style.id = 'design-css';
      style.textContent = css;
      document.head.appendChild(style);
    }
    clock?.destroy();
    clock = null;
    destroyDesignScenes();
    container.innerHTML = html;
    // The render root is laid out at the document's own size, exactly as views/tool.ts
    // mounts a tool canvas: the compositor and the export both read that box.
    const root = stageEl(), page = pageEl();
    if (root && page) {
      root.style.position = 'relative';
      root.style.width = page.style.width;
      root.style.height = page.style.height;
      container.style.width = page.style.width;
      container.style.height = page.style.height;
    }
    await mountDesignScenes(container, sceneOptions);
    await designScenesSettled();
    await nextFrame();
    return container.querySelectorAll('[data-lolly-scene]').length;
  },
  async posters(count, timeoutMs) {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const ready = [...container.querySelectorAll('img.lolly-scene-poster')]
        .filter((img) => !img.hidden && img.naturalWidth > 0).length;
      if (ready >= count || Date.now() > until) return ready;
      await new Promise((done) => setTimeout(done, 100));
    }
  },
  async select(ids) {
    setSelectedScenes(ids);
    await designScenesSettled();
    await nextFrame();
    await nextFrame();
    return markerEl()?.dataset.sceneState || '';
  },
  async scrub(msList) {
    // A synchronous frame seam, so a seek applies before the call returns: this is the
    // real clock (createSequenceClock), driving the real driveMedia, not a stand-in.
    clock ??= createSequenceClock({ canvasEl: container, raf: (cb) => { cb(); return 0; } });
    const marker = markerEl();
    const box = boxOf(marker);
    const steps = [];
    for (const ms of msList) {
      clock.seek(ms);
      await nextFrame();
      const seen = inspectStudio(box);
      steps.push({
        ms,
        frames: seen ? seen.counters.frames : -1,
        sceneT: marker.dataset.sceneT || '',
      });
    }
    return steps;
  },
  async video(fps, width, height) {
    const logs = [];
    const warn = console.warn;
    console.warn = (...args) => { logs.push('warn: ' + args.map(String).join(' ')); };
    try {
      const blob = await renderSequence(stageEl(), 'webm', { fps, width, height },
        { log: (l, m) => logs.push(l + ': ' + m) });
      logs.push('layers: ' + JSON.stringify(
        (parseStage(stageEl()) || { layers: [] }).layers.map((L) => L.kind + '@' + JSON.stringify(L.rect)),
      ) + ' native ' + JSON.stringify(nativeSize()));
      const total = ${LANE_MS} / 1000;
      // Two moments well inside the clip (it runs 0.5 s to 3.5 s), sampled at the middle
      // of an output frame so the request cannot land on a frame boundary.
      const frames = await decodeFrames(blob, [(5 + 0.5) / fps, (20 + 0.5) / fps]);
      if (!frames || !frames[0] || !frames[1]) {
        return { ok: false, error: 'no frames decoded', notes: logs.join(' | '), size: blob.size,
          width: 0, height: 0, moved: 0, spread: [0, 0] };
      }
      const scale = frames[0].w / nativeSize().w;
      const rect = sceneRect();
      const a = cropFrom(frames[0], rect, scale);
      const b = cropFrom(frames[1], rect, scale);
      return {
        ok: true, error: '', notes: logs.filter((l) => /sequence:|warn:|layers:/.test(l)).join(' | '),
        size: blob.size, width: frames[0].w, height: frames[0].h,
        moved: meanDelta(a, b), spread: [spreadOf(a), spreadOf(b)],
      };
    } catch (err) {
      return { ok: false, error: String(err && err.stack || err), notes: logs.join(' | '), size: 0,
        width: 0, height: 0, moved: 0, spread: [0, 0] };
    } finally {
      console.warn = warn;
    }
  },
  async still(width, height, compare) {
    try {
      const marker = markerEl();
      const info = designSceneFor(marker);
      const blob = await exportApi.render(stageEl(), 'png', { width, height });
      const poster = marker.querySelector('img.lolly-scene-poster');
      const shot = await regionOf(blob, sceneRect(), width / nativeSize().w);
      let delta = -1;
      if (compare) {
        // The studio's own render of the SAME values at the size the export embedded,
        // straight through the pool: what the picture in the file has to be.
        const direct = await renderStudioPoster(
          info.values, shot.w, shot.h, 0, 'export', sceneRead, null, new AbortController().signal,
        );
        delta = meanDelta(shot.data, await bitmapPixels(direct, shot.w, shot.h));
      }
      return {
        ok: true, error: '', width: shot.full.width, height: shot.full.height, delta,
        poster: poster && poster.naturalWidth ? [poster.naturalWidth, poster.naturalHeight] : null,
      };
    } catch (err) {
      return { ok: false, error: String(err && err.stack || err), width: 0, height: 0,
        delta: -1, poster: null };
    }
  },
  markerState() {
    const marker = markerEl();
    const canvas = marker.querySelector('canvas');
    const poster = marker.querySelector('img.lolly-scene-poster');
    return {
      sceneState: marker.dataset.sceneState || '',
      canvases: marker.querySelectorAll('canvas').length,
      canvasDisplay: canvas ? canvas.style.display : 'absent',
      posterHidden: poster ? poster.hidden : true,
    };
  },
  failNextUpdate(message) {
    const original = ExportRenderer.prototype.update;
    ExportRenderer.prototype.update = function () {
      ExportRenderer.prototype.update = original;
      return Promise.reject(new Error(message));
    };
  },
};
`;

describe('Design scene boxes in an export', { skip: studioSkip, concurrency: 1 }, () => {
  let harness: StudioHarness;
  let page: Page;
  let docs: { still: string; lane: string };

  before(async () => {
    docs = await documents();
    const read = (path: string) => readFile(join(root, 'community', path), 'utf8');
    const tool = await loadTool('3d-studio', read);
    const design = await loadTool('design', read);
    harness = await startStudioHarness({
      size: 420,
      extraSource,
      routes: serveDesignSceneAssets({
        '/3d-studio.json': JSON.stringify(tool.manifest),
        '/design.css': design.styles ?? '',
      }),
    });
    page = await harness.open();
    await page.waitForFunction(() => Boolean(window.sceneExport));
  });

  after(async () => {
    await harness?.close();
  });

  it('a video export turns the badge, and never ships a blank box', async () => {
    assert.equal(await page.evaluate((html) => window.sceneExport!.mount(html), docs.lane), 1);
    assert.equal(await page.evaluate(() => window.sceneExport!.posters(1, 180_000)), 1);
    // 8 fps over the document's own 4 s: 32 output frames, of which the badge is on
    // screen for 24. Small enough to encode under software WebGL in a reasonable time.
    const out = await page.evaluate(
      ([fps, w, h]) => window.sceneExport!.video(fps, w, h),
      [8, 480, 270] as [number, number, number],
    );
    assert.ok(out.ok, `the export failed: ${out.error} (${out.notes})`);
    assert.ok(out.size > 0, 'a webm with bytes in it');
    assert.equal(out.width, 480);
    // The studio pool answered a frame per moment: 0.19 s and 2.06 s into a four second
    // turntable are about 17 and 185 degrees apart, which no amount of codec smoothing
    // flattens. Measured under SwiftShader: 8.10 with the scene layer kind, and 1.74 with
    // it removed, which is what a box classified `static` gives (one plate re-drawn 32
    // times, plus the codec's own noise). The floor sits between the two.
    assert.ok(
      out.spread[0] > 2 && out.spread[1] > 2,
      `the scene region is flat, so the box came out blank (spreads ${out.spread.map((n) => n.toFixed(2)).join(', ')}; ${out.notes})`,
    );
    assert.ok(out.moved > 3, `the scene box did not turn between frames (mean delta ${out.moved.toFixed(2)}; ${out.notes})`);
  });

  it('a PNG still embeds the scene at the box pixel size, as the studio drew it', async () => {
    assert.equal(await page.evaluate((html) => window.sceneExport!.mount(html), docs.still), 1);
    assert.equal(await page.evaluate(() => window.sceneExport!.posters(1, 180_000)), 1);
    const out = await page.evaluate(
      ([w, h]) => window.sceneExport!.still(w, h, true),
      [STAGE.w, STAGE.h] as [number, number],
    );
    assert.ok(out.ok, `the export failed: ${out.error}`);
    assert.deepEqual([out.width, out.height], [STAGE.w, STAGE.h], 'the artboard at its own size');
    assert.deepEqual(
      out.poster,
      [SCENE_BOX, SCENE_BOX],
      "the walker read a poster at the BOX's pixel size, not at the screen's",
    );
    // The same values, the same size, the same pool. The tolerance covers the PNG round
    // trip and the pool's own re-lease, not a different picture: a poster of the wrong
    // scene, or one stretched from a screen-sized render, is tens of levels out.
    assert.ok(out.delta >= 0 && out.delta < 12, `the embedded scene is not the studio's render (mean delta ${out.delta.toFixed(2)})`);
  });

  it('a scene the renderer refuses fails the export with the studio words', async () => {
    const message = 'The graphics context could not be opened.';
    await page.evaluate((text) => window.sceneExport!.failNextUpdate(text), message);
    // A size nothing has drawn yet, so the export cannot be answered from the poster the
    // box already holds and the refused render is what it gets.
    const out = await page.evaluate(
      ([w, h]) => window.sceneExport!.still(w, h, false),
      [STAGE.w * 2, STAGE.h * 2] as [number, number],
    );
    assert.equal(out.ok, false, 'an export with an undrawable scene must not produce a file');
    assert.match(out.error, new RegExp(message.replace(/[.]/g, '\\.')), "the studio's own words reach the caller");
  });

  it('a scrub draws a new frame on the live box, and records where it is', async () => {
    assert.equal(await page.evaluate((html) => window.sceneExport!.mount(html), docs.lane), 1);
    assert.equal(await page.evaluate(() => window.sceneExport!.posters(1, 180_000)), 1);
    assert.equal(await page.evaluate(() => window.sceneExport!.select(['badge'])), 'live');
    // 1.0 s and 2.5 s are both inside the clip (0.5 s to 3.5 s), so the box is active and
    // its source time is 0.5 s and 2.0 s into a four second scene.
    const steps = await page.evaluate(() => window.sceneExport!.scrub([1000, 2500]));
    assert.equal(steps.length, 2);
    assert.ok(steps[0]!.frames > 0, 'the first scrub drew a frame');
    assert.ok(
      steps[1]!.frames > steps[0]!.frames,
      `a second moment is a second frame, not a cached one (${steps[0]!.frames} then ${steps[1]!.frames})`,
    );
    assert.equal(steps[0]!.sceneT, '0.125', '0.5 s into a 4 s scene');
    assert.equal(steps[1]!.sceneT, '0.5', 'and 2 s into it');
  });

  it('a still of a LIVE box embeds the pooled picture and hands the renderer back', async () => {
    // Follows the scrub above, so the badge box holds the one live renderer and the playhead
    // has parked it at 2 s. Decision Q19's whole point: the export does not photograph that
    // canvas, it asks the pool for the same moment at the output's size.
    const before = await page.evaluate(() => window.sceneExport!.markerState());
    assert.equal(before.sceneState, 'live');
    assert.equal(before.canvases, 1);

    const out = await page.evaluate(([w, h]) => window.sceneExport!.still(w, h, false),
      [STAGE.w, STAGE.h] as [number, number]);
    assert.ok(out.ok, `the export failed: ${out.error}`);
    assert.deepEqual(out.poster, [SCENE_BOX, SCENE_BOX], 'a poster at the box pixel size, not the screen canvas');

    const rest = await page.evaluate(() => window.sceneExport!.markerState());
    assert.equal(rest.sceneState, 'live', 'the box is still the live one afterwards');
    assert.equal(rest.canvases, 1, 'and still holds its renderer');
    assert.notEqual(rest.canvasDisplay, 'none', 'which is showing again, not left hidden by the shot');
    assert.equal(rest.canvasDisplay, before.canvasDisplay, 'at exactly the style it had before');
    assert.equal(rest.posterHidden, true, 'with the export poster put back out of the way');
  });
});
