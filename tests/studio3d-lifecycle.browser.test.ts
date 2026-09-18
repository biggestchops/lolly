// SPDX-License-Identifier: MPL-2.0
/**
 * 3D Studio lifecycle in a real browser: the export clock, frame holds during a capture,
 * capture errors, source keys, lifecycle states, split invalidation and its counters, the
 * renderer pool, retained sources across a set, and the empty-frame check.
 *
 * Run with:
 *   node --import ./tests/css-stub.mjs --test tests/studio3d-lifecycle.browser.test.ts
 *
 * Uses the shared harness (tests/helpers/studio3d-browser.ts) at 256 px with 8 samples.
 *
 * The per-edit counters are a committed fixture, tests/fixtures/studio3d/lifecycle/
 * counters.json, keyed like the lighting baseline (`${platform}:${renderer}`) so a
 * measurement can be traced to the machine that made it. The counts themselves are
 * bookkeeping and do not vary by backend, so a machine with no entry of its own is
 * compared against the one that is recorded rather than skipped. STUDIO_WRITE_BASELINE=1
 * records this machine's entry; with STUDIO_SHOTS set the same table is written there too.
 */
import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { Page } from 'playwright';
import {
  type StudioHarness,
  type StudioRoute,
  type StudioValues,
  saveShot,
  startStudioHarness,
  studioSkip,
} from './helpers/studio3d-browser.ts';

const EMPTY_FRAME =
  'The studio frame came out empty. Export again, or reload the studio if it happens again.';
const CONTEXT_LOST = 'The graphics context was lost. Reload the studio and try a smaller output.';
const CLIP_SIZE = { width: 320, height: 240 };
const COUNTERS = join(
  import.meta.dirname,
  'fixtures',
  'studio3d',
  'lifecycle',
  'counters.json'
);
/** Sources the counter table is measured on: an extruded primitive, a GLB and an STL. */
const COUNTER_SOURCES: Record<string, StudioValues> = {
  badge: { source: 'primitive', primitive: 'badge' },
  duck: { source: 'model', modelAsset: { url: '/duck.glb', name: 'duck.glb' } },
  stl: { source: 'model', modelAsset: { url: '/binary.stl', name: 'binary.stl' } },
};
/** The edits, applied one after another on top of each other. */
const COUNTER_EDITS: [string, StudioValues][] = [
  ['orbit', { camera: { azimuth: 70, elevation: 20 } }],
  ['light', { keyPosition: { x: 5, y: 2, z: -4 } }],
  ['colour', { colorA: '#ff4060' }],
  ['finish', { finishA: 'matte' }],
  ['bevel', { shape: { depth: 0.25, bevel: 0.06, smoothness: 24 } }],
  ['depth', { shape: { depth: 0.4, bevel: 0.06, smoothness: 24 } }],
];

interface Counters {
  updates: number;
  sourceLoads: number;
  sourceAborts: number;
  materialSets: number;
  instances: number;
  stageBuilds: number;
  rigBuilds: number;
  backdropBuilds: number;
  environmentBuilds: number;
  frames: number;
  captures: number;
  memory: { geometries: number; textures: number };
}

/** One backend's recorded table: every source, every edit, every counter. */
interface CounterFile {
  [backend: string]: {
    recorded: string;
    size: number;
    samples: number;
    scenes: Record<string, Record<string, Record<string, number>>>;
  };
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
    heldLoads: number;
    firstLoads: number;
    viewed: string;
    released: string;
    releasedSets: number;
  }>;
  loseContext(): Promise<LifecycleStatus>;
  expireCapture(ms: number): Promise<{
    raised: boolean;
    cleared: boolean;
    state: string;
    updates: number;
    deferredRan: boolean;
    prepare: string | null;
  }>;
  retainSet(urls: string[], retain: boolean): Promise<{
    loadsFirstPass: number;
    loadsSecondPass: number;
    geometriesAfterFirst: number;
    geometriesAfterSecond: number;
    geometriesAfterRelease: number;
    loadsAfterRelease: number;
    pool: { size: number; busy: number; waiting: number; created: number };
  }>;
  poolRuns(count: number): Promise<{ created: number; size: number; busy: number }>;
  poolConcurrent(): Promise<{ contexts: number; waiting: number; third: boolean }>;
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
import { StudioRenderer as LifecycleRenderer, studioAssetKeys } from './shells/web/src/lib/studio3d/renderer.ts';
import { StudioCapture as LifecycleCapture } from './shells/web/src/lib/studio3d/capture.ts';
import { inspectToolStudio, studioCaptureError, STUDIO_CAPTURE_BUDGET } from './shells/web/src/lib/studio3d/mount.ts';
import { acquireStudioRenderer, drainStudioPool, studioPoolState } from './shells/web/src/lib/studio3d/pool.ts';
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
      const firstLoads = renderer.inspect().sourceLoads;
      renderer.freeze(true);
      const update = renderer.update(scene({ source: 'primitive', primitive: 'torus', colorA: '#ff4060' }), countedRead);
      // The hold is reached once the new source has finished loading, so the test waits
      // for that count rather than for a stretch of wall-clock time.
      const deadline = Date.now() + 20000;
      while (renderer.inspect().sourceLoads === firstLoads && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 10));
      const heldLoads = renderer.inspect().sourceLoads;
      const heldSets = renderer.inspect().materialSets;
      renderer.render(96, 96, 'export');
      const held = canvas.toDataURL();
      renderer.view({ azimuth: 120 });
      renderer.render(96, 96, 'export');
      const viewed = canvas.toDataURL();
      renderer.freeze(false);
      await update;
      renderer.render(96, 96, 'export');
      return { first, held, heldSets, firstSets, heldLoads, firstLoads, viewed, released: canvas.toDataURL(), releasedSets: renderer.inspect().materialSets };
    } finally {
      renderer.dispose();
    }
  },
  async expireCapture(ms) {
    const was = STUDIO_CAPTURE_BUDGET.ms;
    STUDIO_CAPTURE_BUDGET.ms = ms;
    try {
      const canvas = studioCanvas();
      const before = statusNow().counters.updates;
      canvas.__lollyFrameDriven = true;
      const raised = canvas.__lollyFrameDriven === true;
      // A mount arriving during a capture is deferred; clearing the flag must run it.
      markerNow().dataset.lollyStudio = JSON.stringify({ version: 1, values: { ...studioDefaults, source: 'primitive', primitive: 'sphere', colorA: '#ff4060' } });
      const deferred = mountToolStudio(container, lifecycleOptions);
      const deadline = Date.now() + 20000;
      while (canvas.__lollyFrameDriven === true && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 10));
      await deferred;
      await nextFrame();
      const now = statusNow();
      return {
        raised,
        cleared: canvas.__lollyFrameDriven !== true,
        state: now.state,
        updates: now.counters.updates - before,
        deferredRan: now.counters.updates > before,
        prepare: messageOf(() => prepareToolStudio(container)),
      };
    } finally {
      STUDIO_CAPTURE_BUDGET.ms = was;
    }
  },
  async retainSet(urls, retain) {
    const scene = (url) => lifecycleScene({ version: 1, values: { ...studioDefaults, source: 'artwork', artwork: { url }, outputMode: 'object' } });
    const recipes = urls.map(scene);
    const keys = retain ? recipes.flatMap(studioAssetKeys) : undefined;
    const lease = await acquireStudioRenderer('sheet');
    const pass = async () => {
      const before = lease.renderer.inspect().sourceLoads;
      for (const recipe of recipes) {
        await lease.renderer.update(recipe, countedRead, shapeText, keys ? { retain: keys } : undefined);
        lease.renderer.render(96, 96, 'export');
      }
      return lease.renderer.inspect().sourceLoads - before;
    };
    let result;
    try {
      const loadsFirstPass = await pass();
      const geometriesAfterFirst = lease.renderer.inspect().memory.geometries;
      const loadsSecondPass = await pass();
      const geometriesAfterSecond = lease.renderer.inspect().memory.geometries;
      result = { loadsFirstPass, loadsSecondPass, geometriesAfterFirst, geometriesAfterSecond };
    } finally {
      lease.release();
    }
    // The renderer is warm and idle: what it still holds is one document's worth.
    const geometriesAfterRelease = lease.renderer.inspect().memory.geometries;
    const loadsAfterRelease = lease.renderer.inspect().sourceLoads;
    const pool = studioPoolState();
    drainStudioPool();
    return { ...result, geometriesAfterRelease, loadsAfterRelease, pool };
  },
  async poolRuns(count) {
    const start = studioPoolState().created;
    for (let i = 0; i < count; i++) {
      const lease = await acquireStudioRenderer('batch');
      lease.canvas.width = 32;
      lease.release();
    }
    const state = studioPoolState();
    drainStudioPool();
    return { created: state.created - start, size: state.size, busy: state.busy };
  },
  async poolConcurrent() {
    const start = studioPoolState().created;
    const first = await acquireStudioRenderer('batch');
    const second = await acquireStudioRenderer('sheet');
    let third = false;
    const pending = acquireStudioRenderer('batch').then((lease) => {
      third = true;
      return lease;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const held = studioPoolState();
    const waiting = held.waiting;
    const settled = third;
    first.release();
    const granted = await pending;
    const contexts = studioPoolState().created - start;
    granted.release();
    second.release();
    drainStudioPool();
    return { contexts, waiting, third: settled };
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
let iconUrls: string[] = [];
let backend = 'unknown';

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
  expireCapture: (ms: number) => page.evaluate((ms) => window.lifecycle!.expireCapture(ms), ms),
  retainSet: (urls: string[], retain: boolean) =>
    page.evaluate(([urls, retain]) => window.lifecycle!.retainSet(urls, retain), [urls, retain] as const),
});

/** The counter changes between two statuses, plus the reads and shaper calls in between. */
function delta(from: LifecycleStatus, to: LifecycleStatus): Record<string, number> {
  const a = from.counters!,
    b = to.counters!;
  return {
    reads: to.reads - from.reads,
    shaped: to.shaped - from.shaped,
    updates: b.updates - a.updates,
    sourceLoads: b.sourceLoads - a.sourceLoads,
    sourceAborts: b.sourceAborts - a.sourceAborts,
    materialSets: b.materialSets - a.materialSets,
    instances: b.instances - a.instances,
    stageBuilds: b.stageBuilds - a.stageBuilds,
    rigBuilds: b.rigBuilds - a.rigBuilds,
    backdropBuilds: b.backdropBuilds - a.backdropBuilds,
    environmentBuilds: b.environmentBuilds - a.environmentBuilds,
    frames: b.frames - a.frames,
    captures: b.captures - a.captures,
  };
}

/**
 * Twelve two-colour icons for the retained-source set: lane T0's public icon fixtures when
 * they are in the tree, otherwise twelve of the geometry fixtures, which are the same kind
 * of file. `degenerate.svg` is left out; it is a fixture about refusing a shape.
 */
async function iconSet(): Promise<{ path: string; body: string }[]> {
  const dirs = [
    join(import.meta.dirname, 'fixtures', 'studio3d', 'icons'),
    join(import.meta.dirname, 'fixtures', 'studio3d', 'geometry'),
  ];
  for (const dir of dirs) {
    const names = (await readdir(dir))
      .filter((name) => name.endsWith('.svg') && name !== 'degenerate.svg')
      .sort()
      .slice(0, 12);
    if (names.length === 12)
      return Promise.all(
        names.map(async (name) => ({
          path: `/set/${name}`,
          body: await readFile(join(dir, name), 'utf8'),
        }))
      );
  }
  throw new Error('No twelve SVG fixtures were found for the retained-source set.');
}

/**
 * A GLB of one flat card whose only material is a nearly clear blend: it passes a ray test
 * and draws almost nothing. Written here rather than committed, because the whole point is
 * the one number in it.
 */
function clearCardGlb(): Uint8Array {
  const positions = new Float32Array([-1.5, 0, 0, 1.5, 0, 0, 1.5, 3, 0, -1.5, 3, 0]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
  const bin = new Uint8Array(positions.byteLength + 16);
  bin.set(new Uint8Array(positions.buffer), 0);
  bin.set(new Uint8Array(indices.buffer), positions.byteLength);
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [
      {
        name: 'card',
        pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 0.01], metallicFactor: 0, roughnessFactor: 1 },
        alphaMode: 'BLEND',
        doubleSided: true,
      },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [-1.5, 0, 0], max: [1.5, 3, 0] },
      { bufferView: 1, componentType: 5123, count: 6, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength },
    ],
    buffers: [{ byteLength: bin.length }],
  };
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonChunk = new Uint8Array(Math.ceil(text.length / 4) * 4).fill(0x20);
  jsonChunk.set(text);
  const out = new Uint8Array(12 + 8 + jsonChunk.length + 8 + bin.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, jsonChunk.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(jsonChunk, 20);
  view.setUint32(20 + jsonChunk.length, bin.length, true);
  view.setUint32(24 + jsonChunk.length, 0x004e4942, true);
  out.set(bin, 28 + jsonChunk.length);
  return out;
}

describe('3D Studio lifecycle', { skip: studioSkip }, () => {
  before(async () => {
    const icons = await iconSet();
    iconUrls = icons.map((icon) => icon.path);
    const routes: Record<string, StudioRoute> = { '/clear-card.glb': clearCardGlb() };
    for (const icon of icons) routes[icon.path] = icon.body;
    harness = await startStudioHarness({ size: 256, extraSource, routes });
    const page = await harness.open();
    try {
      backend = `${process.platform}:${await harness.rendererName(page)}`;
    } finally {
      await page.close();
    }
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
      assert.equal(held.heldLoads, held.firstLoads + 1, 'the held update finished its load, so the hold was reached');
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

  it('rebuilds only what an edit changed, against the committed counter table', async () => {
    await withPage(async (page) => {
      const l = api(page);
      const scenes: Record<string, Record<string, Record<string, number>>> = {};
      for (const [name, base] of Object.entries(COUNTER_SOURCES)) {
        let values = base;
        let last = await l.mount(values);
        assert.equal(last.state, 'ready', name);
        scenes[name] = {};
        for (const [edit, change] of COUNTER_EDITS) {
          values = { ...values, ...change };
          const next = await l.mount(values);
          assert.equal(next.state, 'ready', `${name} ${edit}`);
          scenes[name]![edit] = delta(last, next);
          if (name !== 'badge')
            assert.equal(next.reads, last.reads, `a ${edit} edit does not re-read the ${name} file`);
          last = next;
        }
      }
      const recorded: CounterFile = JSON.parse(await readFile(COUNTERS, 'utf8')) as CounterFile;
      const entry = { recorded: new Date().toISOString().slice(0, 10), size: 256, samples: 8, scenes };
      console.log(`3D Studio invalidation counters: ${JSON.stringify({ [backend]: entry })}`);
      if (process.env.STUDIO_WRITE_BASELINE) {
        recorded[backend] = entry;
        await writeFile(COUNTERS, JSON.stringify(recorded, null, 2) + '\n');
      }
      if (process.env.STUDIO_SHOTS) {
        await mkdir(process.env.STUDIO_SHOTS, { recursive: true });
        await writeFile(
          join(process.env.STUDIO_SHOTS, 'lifecycle-counters.json'),
          JSON.stringify({ [backend]: entry }, null, 2) + '\n'
        );
      }
      // What the split is for, stated as the edits themselves rather than as a table.
      for (const name of Object.keys(COUNTER_SOURCES)) {
        for (const edit of ['orbit', 'light']) {
          const measured = scenes[name]![edit]!;
          assert.equal(measured.materialSets, 0, `a ${edit} edit applies no material to the ${name}`);
          assert.equal(measured.instances, 0, `a ${edit} edit re-instantiates no ${name}`);
          assert.equal(measured.sourceLoads, 0, `a ${edit} edit loads no ${name} source`);
          assert.equal(measured.frames, 1, `a ${edit} edit draws one frame of the ${name}`);
        }
        assert.equal(scenes[name]!.orbit!.rigBuilds, 0, `an orbit keeps the ${name}'s light rig`);
        assert.equal(scenes[name]!.light!.rigBuilds, 1, `a light move rebuilds the ${name}'s rig`);
        assert.equal(scenes[name]!.light!.stageBuilds, 0, 'and nothing around it');
      }
      for (const name of ['duck', 'stl']) {
        const colour = scenes[name]!.colour!;
        assert.equal(colour.materialSets, 1, `a colour edit re-applies the ${name}'s materials`);
        assert.equal(colour.instances, 0, `and re-instantiates no ${name}`);
        assert.equal(colour.sourceLoads, 0);
        assert.equal(colour.stageBuilds, 0, 'and leaves the floor and backplate alone');
        // The engine writes the hemisphere fill from colour A, so a colour edit is a light
        // edit as well. The rig is the cheap half: no floor, no backplate, no depth forms.
        assert.equal(colour.rigBuilds, 1, 'the fill is tied to colour A, so the rig follows it');
        const finish = scenes[name]!.finish!;
        assert.equal(finish.materialSets, 1, `and so does a finish edit on the ${name}`);
        assert.equal(finish.instances, 0);
        assert.equal(finish.rigBuilds, 0, 'a finish reaches no light');
        assert.equal(finish.stageBuilds, 0);
        for (const edit of ['bevel', 'depth']) {
          assert.equal(scenes[name]![edit]!.sourceLoads, 0, `a ${edit} edit does not re-read the ${name}`);
          assert.equal(scenes[name]![edit]!.instances, 0, `or re-instantiate it`);
        }
      }
      // The badge is extruded with the shared shape and baked with the colour pair, so
      // both a shape edit and a colour edit make it a different source.
      for (const edit of ['colour', 'bevel', 'depth']) {
        assert.equal(scenes.badge![edit]!.sourceLoads, 1, `a ${edit} edit re-reads the badge once`);
        assert.equal(scenes.badge![edit]!.instances, 1, `and instantiates it once`);
      }
      // The counts are bookkeeping, not pixels, so a machine with no entry of its own is
      // held to the one that is recorded rather than left unchecked.
      const against = recorded[backend] ?? Object.values(recorded)[0];
      assert.ok(against, 'counters.json records at least one backend');
      assert.deepEqual(scenes, against.scenes, `counter deltas against ${recorded[backend] ? backend : 'the recorded backend'}`);
    });
  });

  it('re-reads a source only for what it consumes', async () => {
    await withPage(async (page) => {
      const l = api(page);
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
      assert.equal(recoloured.counters!.sourceAborts, shaped.counters!.sourceAborts, 'and nothing was abandoned');
    });
  });

  it('rebuilds nothing at all when a cut-out output orbits', async () => {
    await withPage(async (page) => {
      const l = api(page);
      const sphere = { source: 'primitive', primitive: 'sphere', outputMode: 'object' };
      const first = await l.mount(sphere);
      assert.equal(first.state, 'ready');
      const orbited = await l.mount({ ...sphere, camera: { azimuth: 70, elevation: 20 } });
      assert.deepEqual(
        delta(first, orbited),
        {
          reads: 0,
          shaped: 0,
          updates: 1,
          sourceLoads: 0,
          sourceAborts: 0,
          materialSets: 0,
          instances: 0,
          stageBuilds: 0,
          rigBuilds: 0,
          backdropBuilds: 0,
          environmentBuilds: 0,
          frames: 1,
          captures: 0,
        },
        'an orbit with no backplate in the frame draws one frame and rebuilds nothing'
      );
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

  // stage.ts used to call RectAreaLightUniformsLib.init() on every stage build, which made
  // a new pair of area-light tables each time and never freed the old pair (two textures
  // per camera, light or colour edit). The tables are now made once, and the lights are
  // rebuilt on their own, so both kinds of rebuild are measured here.
  it('keeps GPU textures level across stage and rig rebuilds', async () => {
    await withPage(async (page) => {
      const l = api(page);
      const badge = { source: 'primitive', primitive: 'badge' };
      const first = await l.mount(badge);
      const counts = [first.counters!.memory];
      let stageBuilds = first.counters!.stageBuilds;
      // A scene output paints a backplate square to the camera, so an orbit rebuilds it.
      for (const azimuth of [30, 50, 70, 90]) {
        const status = await l.mount({ ...badge, camera: { azimuth } });
        assert.equal(status.counters!.stageBuilds, ++stageBuilds, 'each camera edit rebuilds the backplate');
        assert.equal(status.counters!.rigBuilds, first.counters!.rigBuilds, 'and leaves the rig alone');
        counts.push(status.counters!.memory);
      }
      let rigBuilds = first.counters!.rigBuilds;
      for (const x of [-3, -2, -1, 0]) {
        const status = await l.mount({ ...badge, camera: { azimuth: 90 }, keyPosition: { x, y: 6.8, z: 4 } });
        assert.equal(status.counters!.rigBuilds, ++rigBuilds, 'each light move rebuilds the rig');
        assert.equal(status.counters!.stageBuilds, stageBuilds, 'and nothing around it');
        counts.push(status.counters!.memory);
      }
      console.log(`3D Studio GPU memory across stage and rig rebuilds: ${JSON.stringify(counts)}`);
      for (const memory of counts) assert.deepEqual(memory, counts[0]);
    });
  });

  it('clears a capture flag its export never lowered, and runs what was waiting', async () => {
    await withPage(async (page) => {
      const l = api(page);
      assert.equal((await l.mount({ source: 'primitive', primitive: 'sphere' })).state, 'ready');
      const expired = await l.expireCapture(250);
      assert.equal(expired.raised, true, 'the flag went up');
      assert.equal(expired.cleared, true, 'and came down on its own');
      assert.equal(expired.state, 'ready');
      assert.equal(expired.deferredRan, true, 'the mount that was waiting ran');
      assert.equal(expired.updates, 1, 'exactly once');
      assert.equal(expired.prepare, null, 'and the studio exports again');
    });
  });

  it('refuses a frame whose only subject is drawn nearly clear', async () => {
    await withPage(async (page) => {
      const l = api(page);
      const card = {
        source: 'model',
        modelAsset: { url: '/clear-card.glb', name: 'clear-card.glb' },
        materialMode: 'source',
        outputMode: 'object',
      };
      assert.equal((await l.mount(card)).state, 'ready', 'the card loads and is in frame');
      // A ray meets the card at every probe, so the old check called it drawn. The frame
      // holds about three units of alpha out of 255 there, which is not a picture of it.
      assert.equal(await l.prepareError(), EMPTY_FRAME);
      assert.equal((await l.status()).state, 'ready', 'the refusal fails the export, not the studio');
    });
  });

  it('keeps a whole set of sources through one pooled renderer, and gives them back on release', async () => {
    await withPage(async (page) => {
      const l = api(page);
      assert.equal(iconUrls.length, 12, 'twelve icons make the set');
      const retained = await l.retainSet(iconUrls, true);
      assert.equal(retained.loadsFirstPass, 12, 'the first pass reads each icon once');
      assert.equal(retained.loadsSecondPass, 0, 'and the second pass reads none of them again');
      assert.equal(
        retained.geometriesAfterSecond,
        retained.geometriesAfterFirst,
        'so the geometry count is flat across the set'
      );
      assert.ok(
        retained.geometriesAfterRelease < retained.geometriesAfterFirst,
        `release returns the set's geometry (${retained.geometriesAfterRelease} against ${retained.geometriesAfterFirst})`
      );
      assert.equal(retained.loadsAfterRelease, 12, 'and reads nothing to do it');
      assert.equal(retained.pool.created, 1, 'the whole sheet ran on one context');
      assert.equal(retained.pool.busy, 0, 'which was handed back');
    });
  });

  it('reads every item again without retain, which is what retain is for', async () => {
    await withPage(async (page) => {
      const l = api(page);
      const plain = await l.retainSet(iconUrls, false);
      assert.equal(plain.loadsFirstPass, 12);
      assert.equal(plain.loadsSecondPass, 12, 'each item evicts the last, so the set is read again');
    });
  });

  it('lends two contexts and no more, however many rows ask', async () => {
    await withPage(async (page) => {
      const serial = await page.evaluate(() => window.lifecycle!.poolRuns(24));
      assert.equal(serial.created, 1, 'twenty-four rows one after another share one context');
      assert.equal(serial.busy, 0);
      const concurrent = await page.evaluate(() => window.lifecycle!.poolConcurrent());
      assert.equal(concurrent.third, false, 'a third caller waits rather than opening a context');
      assert.equal(concurrent.waiting, 1);
      assert.equal(concurrent.contexts, 2, 'and is served by the first one released');
    });
  });

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

  it('draws one frame per phase of an animated loop and keeps a repeated phase', async () => {
    await withPage(async (page) => {
      const l = api(page);
      const hover = { source: 'primitive', motion: 'hover', duration: 5, videoSamples: 8 };
      assert.equal((await l.mount(hover)).state, 'ready');
      assert.equal(await l.begin(), true);
      await l.frame(0, 5, CLIP_SIZE);
      const first = (await l.status()).counters!.frames;
      for (const phase of [0.25, 0.5, 0.75]) await l.frame(phase, 5, CLIP_SIZE);
      const drawn = (await l.status()).counters!.frames;
      assert.equal(drawn, first + 3, 'each phase of the loop is a frame of its own');
      await l.frame(0.75, 5, CLIP_SIZE);
      assert.equal(
        (await l.status()).counters!.frames,
        drawn,
        'the same phase again is the frame that is already drawn'
      );
      await l.end();
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
