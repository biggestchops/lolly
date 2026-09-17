// SPDX-License-Identifier: MPL-2.0
/**
 * 3D Studio lifecycle in a real browser: the export clock, frame holds during a capture,
 * capture errors, source keys, lifecycle states, renderer counters and the empty-frame check.
 *
 * Run with:
 *   node --import ./tests/css-stub.mjs --test tests/studio3d-lifecycle.browser.test.ts
 *
 * Uses the shared harness (tests/helpers/studio3d-browser.ts) at 256 px with 8 samples.
 * With STUDIO_SHOTS set, the counter baseline is written there as lifecycle-counters.json
 * next to the review renders.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { Page } from 'playwright';
import {
  type StudioHarness,
  type StudioValues,
  saveShot,
  startStudioHarness,
  studioSkip,
} from './helpers/studio3d-browser.ts';

const EMPTY_FRAME =
  'The studio frame came out empty. Export again, or reload the studio if it happens again.';
const CONTEXT_LOST = 'The graphics context was lost. Reload the studio and try a smaller output.';
const CLIP_SIZE = { width: 320, height: 240 };

interface Counters {
  updates: number;
  sourceLoads: number;
  materialSets: number;
  stageBuilds: number;
  backdropBuilds: number;
  environmentBuilds: number;
  frames: number;
  captures: number;
  memory: { geometries: number; textures: number };
}

interface LifecycleStatus {
  /** The marker's data-studio-state, or 'none' without a marker. */
  state: string;
  /** The state inspectToolStudio reports, or null when no studio is mounted. */
  entry: string | null;
  counters: Counters | null;
  /** Reads through this page API's own read function. */
  reads: number;
  /** Calls to the harness's stand-in shaper. */
  shaped: number;
  canvases: number;
}

interface LifecycleApi {
  mount(values: StudioValues, extra?: { interactive?: boolean; frameQuality?: 'preview' }): Promise<LifecycleStatus>;
  status(): LifecycleStatus;
  begin(): boolean;
  frame(t: number, clipSec?: number, size?: { width: number; height: number }): { width: number; height: number };
  end(): void;
  png(): string;
  direct(t: number, clipSec?: number, size?: { width: number; height: number }): string;
  remount(values: StudioValues): LifecycleStatus;
  settle(): Promise<LifecycleStatus>;
  resizeMarker(width: string): Promise<void>;
  canvasPoint(): { x: number; y: number } | null;
  edits(): number;
  prepareError(): string | null;
  captureError(): string | null;
  opaquePixels(): number;
  failNextRender(message: string): void;
  blankNextCapture(): void;
  cancelDuringLoad(): Promise<{
    before: string;
    after: string;
    settled: string;
    outcome: string;
    canvases: number;
    prepare: string | null;
    inspected: boolean;
  }>;
  heldUpdate(): Promise<{
    first: string;
    held: string;
    heldSets: number;
    firstSets: number;
    viewed: string;
    released: string;
    releasedSets: number;
  }>;
  loseContext(): Promise<LifecycleStatus>;
  destroy(): void;
}

declare global {
  interface Window {
    lifecycle?: LifecycleApi;
  }
}

/**
 * Page code added to the harness bundle. It shares the harness page's names (container, read,
 * shapeText, the mount functions, studioCanvas, nextFrame, stageTemplate, readFrame).
 */
const extraSource = `
import { beginFrameClock as lifecycleBegin, renderFrameAt as lifecycleFrame, endFrameClock as lifecycleEnd } from './shells/web/src/bridge/frame-clock.ts';
import { StudioRenderer as LifecycleRenderer } from './shells/web/src/lib/studio3d/renderer.ts';
import { StudioCapture as LifecycleCapture } from './shells/web/src/lib/studio3d/capture.ts';
import { inspectToolStudio, studioCaptureError } from './shells/web/src/lib/studio3d/mount.ts';
import { buildStudioScene as lifecycleScene } from './engine/src/studio3d.ts';

let lifecycleReads = 0;
const countedRead = (url, signal) => {
  lifecycleReads++;
  return read(url, signal);
};
let lifecycleClock = null;
let lifecycleOptions = { read: countedRead, shapeText };
let lifecyclePending = null;
let lifecycleEdits = 0;
const markerNow = () => container.querySelector('[data-lolly-studio]');
const statusNow = () => {
  const inspected = inspectToolStudio(container);
  return {
    state: markerNow()?.dataset.studioState ?? 'none',
    entry: inspected ? inspected.state : null,
    counters: inspected ? inspected.counters : null,
    reads: lifecycleReads,
    shaped: window.shaped.length,
    canvases: container.querySelectorAll('canvas').length,
  };
};
const messageOf = (run) => {
  try {
    run();
    return null;
  } catch (error) {
    return error.message;
  }
};
const opaqueIn = (canvas) => {
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  const ctx = copy.getContext('2d');
  ctx.drawImage(canvas, 0, 0);
  const data = ctx.getImageData(0, 0, copy.width, copy.height).data;
  let count = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count++;
  return count;
};

window.lifecycle = {
  async mount(values, extra = {}) {
    stageTemplate(values);
    lifecycleOptions = { read: countedRead, shapeText };
    if (extra.interactive) lifecycleOptions.setInput = () => lifecycleEdits++;
    if (extra.frameQuality) lifecycleOptions.frameQuality = extra.frameQuality;
    await mountToolStudio(container, lifecycleOptions);
    await nextFrame();
    await nextFrame();
    return statusNow();
  },
  status: statusNow,
  begin() {
    lifecycleClock = lifecycleBegin(container);
    return lifecycleClock !== null;
  },
  frame(t, clipSec, size) {
    lifecycleFrame(lifecycleClock, t, clipSec, size);
    const canvas = studioCanvas();
    return { width: canvas.width, height: canvas.height };
  },
  end() {
    lifecycleEnd(lifecycleClock);
    lifecycleClock = null;
  },
  png: () => studioCanvas().toDataURL(),
  direct(t, clipSec, size) {
    const canvas = studioCanvas();
    canvas.__lollyFrameRender(t, clipSec, size);
    return canvas.toDataURL();
  },
  remount(values) {
    markerNow().dataset.lollyStudio = JSON.stringify({ version: 1, values: { ...studioDefaults, ...values } });
    lifecyclePending = mountToolStudio(container, lifecycleOptions);
    return statusNow();
  },
  async settle() {
    await lifecyclePending;
    await nextFrame();
    await nextFrame();
    return statusNow();
  },
  async resizeMarker(width) {
    markerNow().style.width = width;
    await nextFrame();
    await nextFrame();
  },
  canvasPoint() {
    const canvas = studioCanvas();
    const box = canvas.getBoundingClientRect();
    for (let y = 0.45; y < 0.95; y += 0.05)
      for (let x = 0.2; x < 0.8; x += 0.05) {
        const point = { x: box.left + box.width * x, y: box.top + box.height * y };
        if (document.elementFromPoint(point.x, point.y) === canvas) return point;
      }
    return null;
  },
  edits: () => lifecycleEdits,
  prepareError: () => messageOf(() => prepareToolStudio(container)),
  captureError: () => studioCaptureError(container)?.message ?? null,
  opaquePixels: () => opaqueIn(studioCanvas()),
  failNextRender(message) {
    const original = LifecycleRenderer.prototype.render;
    LifecycleRenderer.prototype.render = function () {
      LifecycleRenderer.prototype.render = original;
      throw new Error(message);
    };
  },
  blankNextCapture() {
    const original = LifecycleCapture.prototype.render;
    LifecycleCapture.prototype.render = function (...args) {
      LifecycleCapture.prototype.render = original;
      original.apply(this, args);
      this.renderer.setRenderTarget(null);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.clear(true, true, true);
    };
  },
  async cancelDuringLoad() {
    const marker = stageTemplate({ source: 'model', modelAsset: { url: '/binary.stl?cancel', name: 'slow.stl' } });
    let release = () => {};
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const pending = mountToolStudio(container, {
      read: async (url, signal) => {
        await gate;
        signal.throwIfAborted();
        return read(url, signal);
      },
    });
    await nextFrame();
    const before = marker.dataset.studioState;
    destroyToolStudio(container);
    const after = marker.dataset.studioState;
    release();
    let outcome = 'resolved';
    try {
      await pending;
    } catch (error) {
      outcome = 'rejected: ' + error.message;
    }
    await nextFrame();
    return {
      before,
      after,
      settled: marker.dataset.studioState,
      outcome,
      canvases: container.querySelectorAll('canvas').length,
      prepare: messageOf(() => prepareToolStudio(container)),
      inspected: inspectToolStudio(container) !== null,
    };
  },
  async heldUpdate() {
    // The renderer on its own, as another surface would hold it: a frozen host keeps its
    // instances and its camera until it is thawed.
    const canvas = document.createElement('canvas');
    const renderer = new LifecycleRenderer(canvas);
    try {
      const scene = (values) => lifecycleScene({ version: 1, values: { ...studioDefaults, ...values } });
      await renderer.update(scene({ source: 'primitive', primitive: 'sphere', colorA: '#30ba78' }), countedRead);
      renderer.render(96, 96, 'export');
      const first = canvas.toDataURL();
      const firstSets = renderer.inspect().materialSets;
      renderer.freeze(true);
      const update = renderer.update(scene({ source: 'primitive', primitive: 'torus', colorA: '#ff4060' }), countedRead);
      for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 10));
      const heldSets = renderer.inspect().materialSets;
      renderer.render(96, 96, 'export');
      const held = canvas.toDataURL();
      renderer.view({ azimuth: 120 });
      renderer.render(96, 96, 'export');
      const viewed = canvas.toDataURL();
      renderer.freeze(false);
      await update;
      renderer.render(96, 96, 'export');
      return { first, held, heldSets, firstSets, viewed, released: canvas.toDataURL(), releasedSets: renderer.inspect().materialSets };
    } finally {
      renderer.dispose();
    }
  },
  async loseContext() {
    studioCanvas().getContext('webgl2').getExtension('WEBGL_lose_context').loseContext();
    for (let i = 0; i < 20 && markerNow().dataset.studioState !== 'error'; i++) await nextFrame();
    return statusNow();
  },
  destroy() {
    destroyToolStudio(container);
  },
};
`;

let harness: StudioHarness | undefined;

function studio(): StudioHarness {
  if (!harness) throw new Error('The 3D Studio harness did not start.');
  return harness;
}

async function withPage(run: (page: Page) => Promise<void>): Promise<void> {
  const page = await studio().open();
  try {
    await run(page);
  } finally {
    await page.close();
  }
}

const api = (page: Page) => ({
  mount: (values: StudioValues, extra: { interactive?: boolean; frameQuality?: 'preview' } = {}) =>
    page.evaluate(([values, extra]) => window.lifecycle!.mount(values, extra), [values, extra] as const),
  status: () => page.evaluate(() => window.lifecycle!.status()),
  begin: () => page.evaluate(() => window.lifecycle!.begin()),
  frame: (t: number, clipSec?: number, size?: { width: number; height: number }) =>
    page.evaluate(([t, clipSec, size]) => window.lifecycle!.frame(t, clipSec, size), [t, clipSec, size] as const),
  end: () => page.evaluate(() => window.lifecycle!.end()),
  png: () => page.evaluate(() => window.lifecycle!.png()),
  direct: (t: number, clipSec?: number, size?: { width: number; height: number }) =>
    page.evaluate(([t, clipSec, size]) => window.lifecycle!.direct(t, clipSec, size), [t, clipSec, size] as const),
  prepareError: () => page.evaluate(() => window.lifecycle!.prepareError()),
  captureError: () => page.evaluate(() => window.lifecycle!.captureError()),
  opaquePixels: () => page.evaluate(() => window.lifecycle!.opaquePixels()),
});

/** The counter changes between two statuses, plus the reads and shaper calls in between. */
function delta(from: LifecycleStatus, to: LifecycleStatus) {
  const a = from.counters!,
    b = to.counters!;
  return {
    reads: to.reads - from.reads,
    shaped: to.shaped - from.shaped,
    updates: b.updates - a.updates,
    sourceLoads: b.sourceLoads - a.sourceLoads,
    materialSets: b.materialSets - a.materialSets,
    stageBuilds: b.stageBuilds - a.stageBuilds,
    backdropBuilds: b.backdropBuilds - a.backdropBuilds,
    environmentBuilds: b.environmentBuilds - a.environmentBuilds,
    frames: b.frames - a.frames,
    captures: b.captures - a.captures,
    memory: b.memory,
  };
}

describe('3D Studio lifecycle', { skip: studioSkip }, () => {
  before(async () => {
    harness = await startStudioHarness({ size: 256, extraSource });
  });
  after(async () => {
    await harness?.close();
  });

  it('carries the clip length and size through every clocked call of a clip', async () => {
    await withPage(async (page) => {
      const l = api(page);
      const turntable = { source: 'primitive', motion: 'turntable', duration: 5, videoSamples: 8 };
      assert.equal((await l.mount(turntable)).state, 'ready');
      assert.equal(await l.begin(), true);
      // createFrameSource's order for a clip: two frames, the static-chrome probe's two
      // phases, then the repaint of frame 1. Only the first two name a length and size.
      const sizes = [
        await l.frame(0, 5, CLIP_SIZE),
        await l.frame(0.2, 5, CLIP_SIZE),
        await l.frame(0.37),
        await l.frame(0.71),
        await l.frame(0.2),
      ];
      const repainted = await l.png();
      await l.end();
      for (const [i, size] of sizes.entries()) assert.deepEqual(size, CLIP_SIZE, `call ${i + 1} renders at the clip size`);
      assert.equal(await l.begin(), true);
      await l.direct(0.5, 5, CLIP_SIZE);
      const direct = await l.direct(0.2, 5, CLIP_SIZE);
      await l.end();
      assert.equal(repainted, direct, 'the repaint is the clip frame at 0.2, not a still at the canvas size');
      await saveShot('lifecycle-clip-frame.png', repainted);
    });
  });

  it('holds the frame while a capture runs: previews, resizes, gestures and edits wait', async () => {
    await withPage(async (page) => {
      const l = api(page);
      const still = { source: 'primitive', primitive: 'sphere', videoSamples: 8 };
      assert.equal((await l.mount(still, { interactive: true })).state, 'ready');
      assert.equal(await l.begin(), true);
      await l.frame(0, 5, CLIP_SIZE);
      const snapshot = await l.png();
      const before = await l.status();
      const edited = { ...still, colorA: '#ff4060', camera: { azimuth: 90, elevation: 30 } };
      const during = await page.evaluate((values) => window.lifecycle!.remount(values), edited);
      assert.equal(during.state, 'ready', 'a mount during a capture leaves the marker alone');
      assert.equal(during.entry, 'ready');
      assert.equal(during.counters!.updates, before.counters!.updates, 'and does not start an update');
      await page.evaluate(() => window.lifecycle!.resizeMarker('180px'));
      const point = await page.evaluate(() => window.lifecycle!.canvasPoint());
      assert.ok(point, 'a point on the studio canvas can be pressed');
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      await page.mouse.move(point.x + 40, point.y + 12, { steps: 4 });
      await page.mouse.up();
      assert.ok((await page.evaluate(() => window.lifecycle!.edits())) > 0, 'the drag reached the studio controls');
      assert.equal(await l.frame(0, 5, CLIP_SIZE).then(() => l.png()), snapshot, 'the frame is unchanged');
      const held = await l.status();
      assert.equal(held.counters!.frames, before.counters!.frames, 'nothing invalidated the frame, so it was not redrawn');
      assert.equal(held.counters!.updates, before.counters!.updates);
      assert.equal(held.state, 'ready');
      await page.evaluate(() => window.lifecycle!.resizeMarker(''));
      await l.end();
      const settled = await page.evaluate(() => window.lifecycle!.settle());
      assert.equal(settled.state, 'ready', 'the deferred mount ran once the capture ended');
      assert.equal(settled.counters!.updates, before.counters!.updates + 1, 'exactly one deferred update ran');
      assert.equal(await l.prepareError(), null);
      const recoloured = await l.png();
      assert.notEqual(recoloured, snapshot);
      const fresh = await studio().render(page, edited);
      assert.equal(recoloured, fresh.png, 'the deferred mount shows the new colour and camera');
      await saveShot('lifecycle-held.png', snapshot);
      await saveShot('lifecycle-after-capture.png', recoloured);
    });
  });

  it('keeps a frozen renderer on its instances and camera until it is thawed', async () => {
    await withPage(async (page) => {
      const held = await page.evaluate(() => window.lifecycle!.heldUpdate());
      assert.equal(held.heldSets, held.firstSets, 'the held update has not swapped its instances in');
      assert.equal(held.held, held.first, 'the frame stays the first scene');
      assert.equal(held.viewed, held.first, 'a preview camera is ignored while frozen');
      assert.equal(held.releasedSets, held.firstSets + 1, 'the update completes after the thaw');
      assert.notEqual(held.released, held.first);
    });
  });

  it('still renders preview-quality clock frames while the capture flag is up', async () => {
    await withPage(async (page) => {
      const l = api(page);
      const turntable = { source: 'primitive', motion: 'turntable', duration: 5 };
      assert.equal((await l.mount(turntable, { frameQuality: 'preview' })).state, 'ready');
      await page.evaluate(() => window.studioTest!.frameDriven(true));
      const early = await l.direct(0.1, 5);
      const late = await l.direct(0.6, 5);
      await page.evaluate(() => window.studioTest!.frameDriven(false));
      assert.notEqual(early, late, 'a thumbnail capture of a turntable still moves');
    });
  });

  it('fails the capture when a frame fails, until the studio is mounted again', async () => {
    await withPage(async (page) => {
      const l = api(page);
      const values = { source: 'primitive', videoSamples: 8 };
      assert.equal((await l.mount(values)).state, 'ready');
      assert.equal(await l.captureError(), null);
      await page.evaluate(() => window.lifecycle!.failNextRender('Injected frame failure'));
      assert.equal(await l.begin(), true);
      // The clock logs a failed frame and carries on, as it does for every tool.
      await l.frame(0, 5, CLIP_SIZE);
      await l.frame(0.5, 5, CLIP_SIZE);
      await l.end();
      assert.equal(await l.captureError(), 'Injected frame failure');
      assert.equal(await l.prepareError(), 'Injected frame failure');
      assert.equal(await l.prepareError(), 'Injected frame failure', 'prepare keeps refusing');
      assert.equal((await l.status()).state, 'error');
      assert.equal((await l.mount(values)).state, 'ready');
      assert.equal(await l.prepareError(), null);
      assert.equal(await l.captureError(), null);
    });
  });

  it('re-reads a source only for what it consumes, and reports counters for each kind of edit', async () => {
    await withPage(async (page) => {
      const l = api(page);
      const sources: Record<string, StudioValues> = {
        badge: { source: 'primitive', primitive: 'badge' },
        duck: { source: 'model', modelAsset: { url: '/duck.glb', name: 'duck.glb' } },
        stl: { source: 'model', modelAsset: { url: '/binary.stl', name: 'binary.stl' } },
      };
      const edits: [string, StudioValues][] = [
        ['orbit', { camera: { azimuth: 70, elevation: 20 } }],
        ['light', { keyPosition: { x: 5, y: 2, z: -4 } }],
        ['colour', { colorA: '#ff4060' }],
        ['bevel', { shape: { depth: 0.25, bevel: 0.06, smoothness: 24 } }],
      ];
      const baseline: Record<string, Record<string, ReturnType<typeof delta>>> = {};
      for (const [name, base] of Object.entries(sources)) {
        let values = base;
        let last = await l.mount(values);
        assert.equal(last.state, 'ready', name);
        baseline[name] = {};
        for (const [edit, change] of edits) {
          values = { ...values, ...change };
          const next = await l.mount(values);
          assert.equal(next.state, 'ready', `${name} ${edit}`);
          baseline[name]![edit] = delta(last, next);
          if (name !== 'badge') assert.equal(next.reads, last.reads, `a ${edit} edit does not re-read the ${name} file`);
          last = next;
        }
      }
      console.log(`3D Studio invalidation baseline (milestone 2): ${JSON.stringify(baseline)}`);
      if (process.env.STUDIO_SHOTS) {
        await mkdir(process.env.STUDIO_SHOTS, { recursive: true });
        await writeFile(join(process.env.STUDIO_SHOTS, 'lifecycle-counters.json'), JSON.stringify(baseline, null, 2) + '\n');
      }
      // Artwork is extruded with the shared bevel, so a bevel edit reads its file again.
      const artwork = { source: 'artwork', artwork: { url: '/fixture.svg' } };
      const drawn = await l.mount(artwork);
      const bevelled = await l.mount({ ...artwork, shape: { depth: 0.25, bevel: 0.06, smoothness: 24 } });
      assert.equal(bevelled.reads, drawn.reads + 1, 'a bevel edit re-reads the artwork once');
      // Words keep their outlines across a colour edit; materials recolour them.
      const words = { source: 'text', words: 'AB', outputMode: 'object' };
      const shaped = await l.mount(words);
      const recoloured = await l.mount({ ...words, colorA: '#ff4060' });
      assert.equal(recoloured.shaped, shaped.shaped, 'a colour edit does not reshape the words');
      assert.equal(recoloured.counters!.sourceLoads, shaped.counters!.sourceLoads);
    });
  });

  it('returns GPU geometry and textures to their first counts after twenty model swaps', async () => {
    await withPage(async (page) => {
      const l = api(page);
      const duck = { source: 'model', modelAsset: { url: '/duck.glb', name: 'duck.glb' } };
      const stl = { source: 'model', modelAsset: { url: '/binary.stl', name: 'binary.stl' } };
      const first = await l.mount(duck);
      const counts = [first.counters!.memory];
      for (let swap = 1; swap <= 20; swap++) {
        const status = await l.mount(swap % 2 ? stl : duck);
        assert.equal(status.state, 'ready', `swap ${swap}`);
        counts.push(status.counters!.memory);
      }
      console.log(`3D Studio GPU memory across swaps: ${JSON.stringify(counts)}`);
      assert.deepEqual(counts[20], counts[0], 'the duck holds the same GPU resources after twenty swaps');
      assert.deepEqual(counts[19], counts[1], 'and so does the STL');
    });
  });

  it(
    'keeps GPU textures level across camera edits that rebuild the stage',
    {
      todo: 'stage.ts calls RectAreaLightUniformsLib.init() on every stage build, which makes a new pair of area-light tables each time and never frees the old pair; calling it once fixes this',
    },
    async () => {
      await withPage(async (page) => {
        const l = api(page);
        const badge = { source: 'primitive', primitive: 'badge' };
        const counts = [(await l.mount(badge)).counters!.memory];
        for (const azimuth of [30, 50, 70, 90]) {
          const status = await l.mount({ ...badge, camera: { azimuth } });
          assert.equal(status.counters!.stageBuilds, counts.length + 1, 'each camera edit rebuilds the stage');
          counts.push(status.counters!.memory);
        }
        console.log(`3D Studio GPU memory across stage rebuilds: ${JSON.stringify(counts)}`);
        for (const memory of counts) assert.deepEqual(memory, counts[0]);
      });
    }
  );

  it('reports a studio destroyed while loading as cancelled, and resolves its mount', async () => {
    await withPage(async (page) => {
      const cancelled = await page.evaluate(() => window.lifecycle!.cancelDuringLoad());
      assert.deepEqual(cancelled, {
        before: 'loading',
        after: 'cancelled',
        settled: 'cancelled',
        outcome: 'resolved',
        canvases: 0,
        prepare: 'The studio renderer is unavailable.',
        inspected: false,
      });
    });
  });

  it('exports a transparent frame whose subject is out of view, and refuses a blank one without breaking the studio', async () => {
    await withPage(async (page) => {
      const l = api(page);
      const sphere = {
        source: 'primitive',
        primitive: 'sphere',
        outputMode: 'object',
        rotation: { x: 0, y: 0, z: 0 },
        position: { x: 0, y: 0, z: 0 },
      };
      // The camera looks twenty units to the side of the subject.
      assert.equal((await l.mount({ ...sphere, camera: { azimuth: 0, elevation: 0, panX: 20 } })).state, 'ready');
      assert.equal(await l.prepareError(), null, 'no empty-frame error for a subject out of view');
      assert.equal(await l.opaquePixels(), 0, 'the frame is indeed empty');
      // An orthographic frame six units square whose lower left corner is at (1.3, 2.95):
      // the sphere's bounding box (x -1.625 to 1.625, y 0 to 3.25) reaches about 14 by 13
      // pixels into the frame, but the sphere itself stays below y 2.6 wherever x is 1.3 or
      // more, so nothing of it is in view. The ray check must see that.
      const corner = {
        ...sphere,
        projection: 'orthographic',
        camera: { azimuth: 0, elevation: 0, zoom: 1, panX: 4.3, panY: 4.35 },
      };
      assert.equal((await l.mount(corner)).state, 'ready');
      assert.equal(await l.prepareError(), null, 'a bounding box corner in view is not a subject in view');
      assert.equal(await l.opaquePixels(), 0);
      // A subject in view passes, and the same subject drawn blank is refused.
      assert.equal((await l.mount(sphere)).state, 'ready');
      assert.equal(await l.prepareError(), null);
      assert.ok((await l.opaquePixels()) > 1000);
      assert.equal((await l.mount({ ...sphere, colorA: '#ff4060' })).state, 'ready');
      await page.evaluate(() => window.lifecycle!.blankNextCapture());
      assert.equal(await l.prepareError(), EMPTY_FRAME);
      assert.equal(await l.captureError(), EMPTY_FRAME);
      // The refusal fails that export only, as its message says: the studio stays ready,
      // and exporting again draws and checks the frame again.
      assert.equal((await l.status()).state, 'ready');
      assert.equal(await l.prepareError(), null, 'exporting again draws the frame again');
      assert.equal(await l.captureError(), null);
      assert.ok((await l.opaquePixels()) > 1000);
      // A clip checks its first clock frame the same way, and the next export passes.
      await page.evaluate(() => window.lifecycle!.blankNextCapture());
      assert.equal(await l.begin(), true);
      await l.frame(0, 5, CLIP_SIZE);
      await l.frame(0.5, 5, CLIP_SIZE);
      await l.end();
      assert.equal(await l.captureError(), EMPTY_FRAME);
      assert.equal((await l.status()).state, 'ready');
      assert.equal(await l.prepareError(), null);
      assert.equal(await l.captureError(), null);
      // The scene output is never checked: its backplate covers every pixel.
      assert.equal((await l.mount({ ...sphere, outputMode: 'scene', colorA: '#30ba78' })).state, 'ready');
      await page.evaluate(() => window.lifecycle!.blankNextCapture());
      assert.equal(await l.prepareError(), null);
    });
  });

  it('marks the studio as failed when the browser drops its graphics context', async () => {
    await withPage(async (page) => {
      const l = api(page);
      assert.equal((await l.mount({ source: 'primitive' })).state, 'ready');
      const lost = await page.evaluate(() => window.lifecycle!.loseContext());
      assert.equal(lost.state, 'error');
      assert.equal(lost.entry, 'error');
      assert.equal(await l.captureError(), CONTEXT_LOST);
      assert.equal(await l.prepareError(), CONTEXT_LOST);
      await page.evaluate(() => window.lifecycle!.destroy());
    });
  });

  it('has no browser or shader errors', () => assert.deepEqual(studio().errors, []));
});
