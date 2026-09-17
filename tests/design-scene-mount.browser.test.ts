// SPDX-License-Identifier: MPL-2.0
/**
 * Scene boxes in a Design document, in a real browser (plan 265 milestone 3, lane B).
 *
 * Run with:
 *   node --import ./tests/css-stub.mjs --test tests/design-scene-mount.browser.test.ts
 *
 * The page is the shared studio harness (tests/helpers/studio3d-browser.ts) with the
 * Design enhancer added to its bundle. Most of it runs over two hand-written `.lolly-box`
 * elements, each holding the marker the Design hook emits for a `kind: '3d'` box, at sizes
 * chosen to make the poster arithmetic readable; one case paints the whole `still` fixture
 * document as the shipped community/design tool renders it, with that tool's own
 * stylesheet, so the markup this enhancer reads is the markup Design actually writes.
 *
 * What it pins: every box gets a poster at its own pixel size, drawn through one pooled
 * context rather than one context per box; selecting a box makes it the single live
 * renderer; deselecting it puts back a poster that is the frame that was on screen; and a
 * renderer that refuses to start leaves the poster and a status line rather than a blank.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { Page } from 'playwright';

import { loadTool } from '../engine/src/loader.ts';
import { designSceneDocumentHtml, designSceneStill, sceneMarkers } from './helpers/design-scene.ts';
import { type StudioHarness, startStudioHarness, studioSkip } from './helpers/studio3d-browser.ts';

const root = resolve(import.meta.dirname, '..');
/** Eight samples, as every studio suite uses: the default 64 is minutes under software WebGL. */
const SAMPLES = 'samples=8';
/** The still fixture's own scene query, which is what lane A writes into a `scene` field. */
const HERO_SCENE = `${designSceneStill.scenes[0]!.scene}&${SAMPLES}`;
const BADGE_SCENE = `source=primitive&primitive=badge&motion=turntable&${SAMPLES}`;

interface SceneBox {
  id: string;
  scene: string;
  width: number;
  height: number;
}

const BOXES: SceneBox[] = [
  { id: 'hero', scene: HERO_SCENE, width: 240, height: 180 },
  { id: 'badge', scene: BADGE_SCENE, width: 320, height: 320 },
];

/** What the page reports about one scene box. */
interface SceneBoxState {
  boxId: string;
  /** The marker's data-scene-state: `poster` or `live`. */
  sceneState: string;
  /** The marker's data-studio-state while a renderer holds it, or ''. */
  studioState: string;
  /** The recipe's clip length, from data-scene-seconds. */
  seconds: string;
  /** The poster's src, and the pixel size of the picture behind it. */
  poster: { src: string; width: number; height: number } | null;
  /** True while the calm fill is on screen. */
  waiting: boolean;
  status: string;
  canvases: number;
}

interface ScenePageApi {
  paint(boxes: SceneBox[]): Promise<SceneBoxState[]>;
  /** Paint a whole Design document, as the tool renders it, with the tool's own styles. */
  paintDocument(html: string): Promise<SceneBoxState[]>;
  posters(count: number, timeoutMs: number): Promise<SceneBoxState[]>;
  state(): SceneBoxState[];
  select(ids: string[]): Promise<SceneBoxState[]>;
  /** inspectToolStudio for one box: its lifecycle state, or null when nothing is mounted. */
  inspect(boxId: string): string | null;
  /** Draw the live canvas at time zero and return it as a data URL. */
  lastFrame(boxId: string): string;
  pool(): { size: number; busy: number; waiting: number; created: number };
  /** Make the next renderer update throw, as a device with no float context does. */
  failNextUpdate(message: string): void;
  /** Make the next frame throw, which is a poster that cannot be drawn. */
  failNextRender(message: string): void;
  destroy(): void;
}

declare global {
  interface Window {
    /** The Design scene page API (this suite). */
    sceneTest?: ScenePageApi;
  }
}

/**
 * Page code appended to the harness bundle. It shares the harness page's own names
 * (container, nextFrame) and adds window.sceneTest.
 */
const extraSource = `
import {
  designScenesSettled,
  destroyDesignScenes,
  mountDesignScenes,
  setSelectedScenes,
} from './shells/web/src/lib/design-scene-mount.ts';
import { inspectToolStudio } from './shells/web/src/lib/studio3d/mount.ts';
import { studioPoolState } from './shells/web/src/lib/studio3d/pool.ts';
import { StudioRenderer as SceneRenderer } from './shells/web/src/lib/studio3d/renderer.ts';

container.style.position = 'relative';
// studioShaperFor reads the brand face off the document, so the page names one.
document.documentElement.style.setProperty('--font-brand', 'Harness Sans');

let sceneManifest = null;
const sceneHost = {
  assets: {
    async get(id) {
      throw new Error('No asset named ' + id);
    },
    async bytes(target) {
      const url = typeof target === 'string' ? target : target.url;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Fixture missing: ' + url);
      return new Uint8Array(await res.arrayBuffer());
    },
  },
  // A stand-in for the host's HarfBuzz shaper: every letter is a box, as the harness's own.
  text: {
    async fontUrl() {
      return { url: '/harness.ttf' };
    },
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
const sceneOptions = {
  host: sceneHost,
  manifest: async () => {
    if (!sceneManifest) sceneManifest = await fetch('/3d-studio.json').then((r) => r.json());
    return sceneManifest;
  },
};
const esc = (value) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const markerOf = (boxId) =>
  container.querySelector('.lolly-box[data-box-id="' + boxId + '"] [data-lolly-scene]');
const stateOf = (marker) => {
  const box = marker.closest('.lolly-box');
  const img = marker.querySelector('img.lolly-scene-poster');
  const wait = marker.querySelector('div.lolly-scene-wait');
  const status = marker.querySelector('p.lolly-scene-status');
  return {
    boxId: box.getAttribute('data-box-id'),
    sceneState: marker.dataset.sceneState || '',
    studioState: marker.dataset.studioState || '',
    seconds: marker.dataset.sceneSeconds || '',
    poster: img && !img.hidden && img.src
      ? { src: img.src, width: img.naturalWidth, height: img.naturalHeight }
      : null,
    waiting: Boolean(wait && !wait.hidden),
    status: status && !status.hidden ? status.textContent || '' : '',
    canvases: marker.querySelectorAll('canvas').length,
  };
};
const allStates = () =>
  [...container.querySelectorAll('[data-lolly-scene]')].map(stateOf);
const canvasOf = (boxId) => {
  const canvas = markerOf(boxId).querySelector('canvas');
  if (!canvas) throw new Error('No live canvas in ' + boxId);
  return canvas;
};

window.sceneTest = {
  async paint(boxes) {
    container.innerHTML = boxes
      .map(
        (b) =>
          '<div class="lolly-box" data-box-id="' + b.id + '" style="position:absolute;left:0;top:0;width:' +
          b.width + 'px;height:' + b.height + 'px;">' +
          '<div class="lolly-box-img lolly-box-scene" data-lolly-scene="' + esc(b.scene) +
          '" data-scene-state="poster" style="position:absolute;inset:0;width:100%;height:100%;"></div></div>'
      )
      .join('');
    await mountDesignScenes(container, sceneOptions);
    await nextFrame();
    return allStates();
  },
  async paintDocument(html) {
    if (!document.getElementById('design-css')) {
      const css = await fetch('/design.css').then((r) => r.text());
      const style = document.createElement('style');
      style.id = 'design-css';
      style.textContent = css;
      document.head.appendChild(style);
    }
    container.innerHTML = html;
    await mountDesignScenes(container, sceneOptions);
    await nextFrame();
    return allStates();
  },
  async posters(count, timeoutMs) {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const states = allStates();
      const ready = states.filter((s) => s.poster && s.poster.width > 0);
      if (ready.length >= count) return states;
      if (Date.now() > until) return states;
      await new Promise((done) => setTimeout(done, 100));
    }
  },
  state: allStates,
  async select(ids) {
    setSelectedScenes(ids);
    await designScenesSettled();
    await nextFrame();
    await nextFrame();
    return allStates();
  },
  inspect(boxId) {
    const box = container.querySelector('.lolly-box[data-box-id="' + boxId + '"]');
    const seen = inspectToolStudio(box);
    return seen ? seen.state : null;
  },
  lastFrame(boxId) {
    const canvas = canvasOf(boxId);
    canvas.__lollyFrameRender(0);
    return canvas.toDataURL();
  },
  pool: () => studioPoolState(),
  failNextUpdate(message) {
    const original = SceneRenderer.prototype.update;
    SceneRenderer.prototype.update = function () {
      SceneRenderer.prototype.update = original;
      return Promise.reject(new Error(message));
    };
  },
  failNextRender(message) {
    const original = SceneRenderer.prototype.render;
    SceneRenderer.prototype.render = function () {
      SceneRenderer.prototype.render = original;
      throw new Error(message);
    };
  },
  destroy() {
    destroyDesignScenes();
  },
};
`;

describe('Design scene boxes', { skip: studioSkip, concurrency: 1 }, () => {
  let harness: StudioHarness;
  let page: Page;

  before(async () => {
    const read = (path: string) => readFile(join(root, 'community', path), 'utf8');
    const tool = await loadTool('3d-studio', read);
    const design = await loadTool('design', read);
    harness = await startStudioHarness({
      size: 420,
      extraSource,
      routes: {
        '/3d-studio.json': JSON.stringify(tool.manifest),
        '/design.css': design.styles ?? '',
      },
    });
    page = await harness.open();
    await page.waitForFunction(() => Boolean(window.sceneTest));
  });

  after(async () => {
    await harness?.close();
  });

  it('draws a poster for every scene box, at the box size, through one pooled context', async () => {
    const painted = await page.evaluate((boxes) => window.sceneTest!.paint(boxes), BOXES);
    assert.deepEqual(
      painted.map((s) => s.boxId),
      ['hero', 'badge']
    );
    // The clip length the playhead divides by (lane C reads it off the marker).
    assert.deepEqual(
      painted.map((s) => s.seconds),
      ['5', '5'],
      'each marker is stamped with the recipe motion length'
    );
    assert.ok(
      painted.every((s) => s.waiting),
      'a box with no poster yet shows the calm fill, never a blank'
    );

    const settled = await page.evaluate(() => window.sceneTest!.posters(2, 120_000));
    assert.deepEqual(
      settled.map((s) => s.poster && [s.poster.width, s.poster.height]),
      [
        [240, 180],
        [320, 320],
      ],
      'each poster is drawn at its own box size times the device pixel ratio'
    );
    assert.ok(
      settled.every((s) => !s.waiting && s.status === '' && s.canvases === 0),
      'the fill is gone, nothing is in error and no box holds a renderer yet'
    );
    const pool = await page.evaluate(() => window.sceneTest!.pool());
    assert.equal(pool.created, 1, 'both posters were drawn through one leased context');
    assert.equal(pool.busy, 0, 'and the lease was given back');
  });

  it('reads the marker the Design tool itself paints', async () => {
    // The fixture document rendered by the shipped community/design tool, so what this
    // enhancer reads is the marker lane A emits rather than markup written here. Eight
    // samples, as everywhere else: the studio's default of 64 is minutes under SwiftShader.
    const html = (await designSceneDocumentHtml(designSceneStill)).replace(
      /data-lolly-scene="([^"]*)"/g,
      (_all, scene: string) => `data-lolly-scene="${scene}&amp;${SAMPLES}"`
    );
    const authored = sceneMarkers(html);
    assert.equal(authored.length, 1, 'the still fixture has one scene box');
    assert.equal(authored[0]!.boxId, 'hero');

    const painted = await page.evaluate((doc) => window.sceneTest!.paintDocument(doc), html);
    assert.deepEqual(
      painted.map((s) => ({ boxId: s.boxId, seconds: s.seconds, waiting: s.waiting })),
      [{ boxId: 'hero', seconds: '5', waiting: true }],
      'the box id comes off the .lolly-box the tool wrote, and the clip length off the recipe'
    );
    const settled = await page.evaluate(() => window.sceneTest!.posters(1, 180_000));
    assert.deepEqual(
      settled.map((s) => s.poster && [s.poster.width, s.poster.height]),
      [[640, 640]],
      "the poster is the box's own 640 by 640, which the tool's stylesheet gives the marker"
    );
    assert.equal(settled[0]!.status, '', 'and nothing went wrong on the way');
    await page.evaluate((boxes) => window.sceneTest!.paint(boxes), BOXES);
    await page.evaluate(() => window.sceneTest!.posters(2, 120_000));
  });

  it('makes exactly one selected box live, and only that box', async () => {
    const live = await page.evaluate(() => window.sceneTest!.select(['badge']));
    const badge = live.find((s) => s.boxId === 'badge')!;
    const hero = live.find((s) => s.boxId === 'hero')!;
    assert.equal(badge.sceneState, 'live');
    assert.equal(badge.studioState, 'ready');
    assert.equal(badge.canvases, 1, 'the selected box holds the renderer');
    assert.equal(badge.poster, null, 'and its poster is out of the way');
    assert.equal(hero.sceneState, 'poster');
    assert.equal(hero.canvases, 0, 'the other box stays a poster');
    assert.ok(hero.poster, 'and keeps the picture it had');
    assert.equal(await page.evaluate(() => window.sceneTest!.inspect('badge')), 'ready');
    assert.equal(await page.evaluate(() => window.sceneTest!.inspect('hero')), null);
    const pool = await page.evaluate(() => window.sceneTest!.pool());
    assert.equal(pool.created, 1, 'the live renderer is a context of its own, not a lease');
    assert.equal(pool.busy, 0);
  });

  it('two selected scene boxes leave nothing live', async () => {
    const both = await page.evaluate(() => window.sceneTest!.select(['hero', 'badge']));
    assert.deepEqual(
      both.map((s) => s.sceneState),
      ['poster', 'poster'],
      'a selection of two scene boxes is not a live scene'
    );
    assert.equal(
      both.reduce((n, s) => n + s.canvases, 0),
      0,
      'and no renderer is left standing'
    );
  });

  it('deselecting puts back a poster that is the frame that was on screen', async () => {
    await page.evaluate(() => window.sceneTest!.select(['hero']));
    const frame = await page.evaluate(() => window.sceneTest!.lastFrame('hero'));
    const after = await page.evaluate(() => window.sceneTest!.select([]));
    const hero = after.find((s) => s.boxId === 'hero')!;
    assert.equal(hero.sceneState, 'poster');
    assert.equal(hero.canvases, 0, 'the renderer was handed back');
    assert.ok(hero.poster, 'and the box has a picture');
    assert.equal(hero.poster!.src, frame, 'which is the last frame, pixel for pixel');
    assert.equal(await page.evaluate(() => window.sceneTest!.inspect('hero')), null);
  });

  it('a renderer that refuses to start keeps the poster and says why', async () => {
    const message = 'The graphics context could not be opened.';
    await page.evaluate((text) => window.sceneTest!.failNextUpdate(text), message);
    const failed = await page.evaluate(() => window.sceneTest!.select(['hero']));
    const hero = failed.find((s) => s.boxId === 'hero')!;
    assert.equal(hero.studioState, 'error');
    assert.equal(hero.status, message, "the studio's own words, in the box");
    assert.ok(hero.poster, 'and the poster is still on screen, never a blank');
    await page.evaluate(() => window.sceneTest!.select([]));
  });

  it('a poster that cannot be drawn says so and leaves the canvas alone', async () => {
    const message = 'This frame came out empty.';
    await page.evaluate(() => window.sceneTest!.destroy());
    await page.evaluate((text) => window.sceneTest!.failNextRender(text), message);
    await page.evaluate((boxes) => window.sceneTest!.paint(boxes), [BOXES[0]!]);
    const settled = await page.evaluate(async () => {
      const until = Date.now() + 60_000;
      for (;;) {
        const states = window.sceneTest!.state();
        if (states[0]?.status) return states;
        if (Date.now() > until) return states;
        await new Promise((done) => setTimeout(done, 100));
      }
    });
    assert.equal(settled[0]!.status, 'This scene could not be drawn.');
    assert.equal(settled[0]!.canvases, 0, 'a failed poster never opens a renderer');
  });
});
