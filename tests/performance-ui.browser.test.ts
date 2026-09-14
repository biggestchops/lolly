// SPDX-License-Identifier: MPL-2.0
/** LOLLY_GALLERY_TEST_URL=http://127.0.0.1:5187 node --test tests/performance-ui.browser.test.ts */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium, type Page } from 'playwright';

const origin = process.env.LOLLY_GALLERY_TEST_URL;
const buildOrigin = process.env.LOLLY_PERF_BUILD_URL;
const options = { skip: origin ? false : 'set LOLLY_GALLERY_TEST_URL to a local Vite shell', timeout: 120_000 };
async function fixture(page: Page, base = origin): Promise<void> {
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base!).hostname));
  await page.route('**/__perf-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head></head><body></body></html>' }));
  await page.goto(`${base}/__perf-fixture`);
}

async function checkCssCascade(built: boolean): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await fixture(page, built ? buildOrigin : origin);
    if (built) {
      const response = await page.request.get(buildOrigin!);
      assert.equal(response.ok(), true);
      const sheets = await page.evaluate(html => [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('link[rel="stylesheet"]')].map(el => el.getAttribute('href')!), await response.text());
      assert.ok(sheets.length, 'the production HTML links to its emitted CSS');
      for (const href of sheets) await page.addStyleTag({ url: new URL(href, buildOrigin).href });
    } else {
      await page.evaluate(async () => { const cssPath = '/src/styles/app.css'; await import(cssPath); });
    }
    // Import the actual app sheet first, then simulate styles arriving in lazy chunks.
    const effects = 'backdrop-filter: blur(7px) !important; box-shadow: 0 0 7px red !important; mix-blend-mode: multiply !important; background-blend-mode: screen !important;';
    await page.addStyleTag({ content: `
      ${['vendor', 'chrome', 'views', 'a11y'].map(layer => `@layer ${layer} { .probe-${layer}, .probe-${layer}::before, .probe-${layer}::after { content: ''; ${effects} } }`).join('\n')}
      .probe-unlayered, .probe-unlayered::before, .probe-unlayered::after { content: ''; ${effects} }
      @layer views {
        .creation, .creation *, .creation::before, .creation::after, .creation *::before, .creation *::after { content: ''; ${effects} }
        #keyboard:focus-visible, #keyboard:focus-visible *, #keyboard:focus-visible::before, #keyboard:focus-visible::after { content: ''; box-shadow: 0 0 0 3px blue !important; }
      }
    ` });
    await page.locator('body').evaluate(body => {
      body.innerHTML = `
        <button id="keyboard"><span>Keyboard focus</span></button>
        <input class="field-input" aria-label="Field focus">
        ${['vendor', 'chrome', 'views', 'a11y', 'unlayered'].map(layer => `<div class="probe-${layer}">Chrome</div>`).join('')}
        <div id="tool-canvas" class="creation"><span>Tool</span></div>
        <div class="tool-canvas creation"><span>Tool class</span></div>
        <div id="tool-content" class="creation"><span>Content</span></div>
        <div class="pro-export-canvas creation"><span>Export</span></div>`;
    });
    const snapshot = () => page.evaluate(() => {
      const styles = (selector: string) => [...document.querySelectorAll(selector)].flatMap(el =>
        [null, '::before', '::after'].map(pseudo => {
          const css = getComputedStyle(el, pseudo);
          return { blur: css.backdropFilter, shadow: css.boxShadow, mix: css.mixBlendMode, background: css.backgroundBlendMode };
        }));
      return { chrome: styles('[class^="probe-"]'), creations: styles('.creation, .creation *'), focus: styles('#keyboard, #keyboard span') };
    });
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('#keyboard').evaluate(el => el.matches(':focus-visible')), true);
    const off = await snapshot();
    assert.ok(off.chrome.every(css => css.blur === 'blur(7px)' && css.shadow !== 'none'));
    assert.ok(off.creations.every(css => css.blur === 'blur(7px)' && css.shadow !== 'none'));
    assert.notEqual(off.focus[0]!.shadow, 'none');
    await page.evaluate(() => document.documentElement.setAttribute('data-perf-ui', ''));
    const on = await snapshot();
    assert.ok(on.chrome.every(css => css.blur === 'none' && css.shadow === 'none' && css.mix === 'normal' && css.background === 'normal'), JSON.stringify(on.chrome));
    assert.deepEqual(on.creations, off.creations, 'roots, descendants and pseudo-elements retain authored output');
    assert.deepEqual(on.focus, off.focus, 'focus shadow survives on the control, its children and pseudo-elements');
    await page.keyboard.press('Tab');
    const outline = await page.locator('.field-input').evaluate(el => {
      const css = getComputedStyle(el);
      return { visible: el.matches(':focus-visible'), style: css.outlineStyle, width: css.outlineWidth };
    });
    assert.deepEqual(outline, { visible: true, style: 'solid', width: '2px' });
    await page.keyboard.press('Shift+Tab');
    await page.evaluate(() => document.documentElement.removeAttribute('data-perf-ui'));
    assert.deepEqual(await snapshot(), off, 'turning the flag off restores every computed effect');
  } finally { await browser.close(); }
}

test('Performance UI wins the real CSS cascade while focus and creation surfaces keep their effects', options, () => checkCssCascade(false));
test('the minified production CSS preserves the same performance policy and exclusions', {
  skip: buildOrigin ? false : 'set LOLLY_PERF_BUILD_URL to a local production build', timeout: 120_000,
}, () => checkCssCascade(true));

test('existing Jelly controls stop physics, remain usable, and restore the saved preference', options, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await fixture(page);
    const result = await page.evaluate(async () => {
      const flagPath = '/src/feature-flags.ts', jellyPath = '/src/lib/jelly.ts';
      const flags = await import(flagPath), jelly = await import(jellyPath);
      const delay = () => new Promise(resolve => setTimeout(resolve, 150));
      let frames = 0;
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = cb => raf(time => { frames++; cb(time); });
      flags.setFlagMirror('jelly-effects', true);
      await jelly.ensureJelly();
      const sw = document.createElement('jelly-switch') as HTMLElement & { checked: boolean; centerPop(n: number): void };
      document.body.append(sw);
      await delay();
      sw.centerPop(1);
      const moving = frames; await delay();
      const activeFrames = frames - moving;
      flags.setFlagMirror('perf-ui', true); flags.applyPerfUi(true);
      await delay(); const resting = frames; await delay();
      const idleFrames = frames - resting;
      sw.checked = true;
      await delay(); const checked = sw.checked;
      const gated = !jelly.jellyEnabled() && !await jelly.ensureJelly(true);
      flags.setFlagMirror('perf-ui', false); flags.applyPerfUi(false);
      const restored = jelly.jellyEnabled();
      sw.centerPop(1); const resumed = frames; await delay();
      return { activeFrames, idleFrames, checked, gated, restored, resumedFrames: frames - resumed };
    });
    assert.ok(result.activeFrames > 1);
    assert.equal(result.idleFrames, 0);
    assert.equal(result.checked, true);
    assert.equal(result.gated, true);
    assert.equal(result.restored, true);
    assert.ok(result.resumedFrames > 1);
  } finally { await browser.close(); }
});

test('the dock destroys active and late-arriving visualizers without disabling the saved setting', options, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await fixture(page);
    await page.route('**/src/lib/viz-support.ts*', route => route.fulfill({ contentType: 'text/javascript', body: 'export const vizSupported = () => true; export const vizPossible = () => true;' }));
    await page.route('**/src/lib/viz-stock.ts*', route => route.fulfill({ contentType: 'text/javascript', body: 'export const stockPresetIndex = async () => []; export const loadStockPreset = async () => null; export const readBrandTint = () => "strong";' }));
    await page.route('**/src/lib/butterchurn-viz.ts*', route => route.fulfill({ contentType: 'text/javascript', body: `
      export let destroyed = 0, mounts = 0, entered;
      let wait, release, signal;
      export function hold() { wait = new Promise(r => release = r); entered = new Promise(r => signal = r); }
      export function finish() { release(); wait = null; }
      export async function mountViz() {
        mounts++; signal?.(); if (wait) await wait;
        return { destroy() { destroyed++; }, running: () => true, resize() {}, setPalette() {} };
      }
    ` }));
    const result = await page.evaluate(async () => {
      const flagPath = '/src/feature-flags.ts', hostPath = '/src/lib/neurospicy-dock-host.ts', vizPath = '/src/lib/butterchurn-viz.ts';
      const flags = await import(flagPath), module = await import(hostPath), stub = await import(vizPath);
      const dock = module.createNeurospicyDockHost({});
      const canvas = document.createElement('canvas'); document.body.append(canvas);
      await dock.host.viz.mount(canvas);
      flags.setFlagMirror('perf-ui', true); flags.applyPerfUi(true);
      const activeDestroyed = stub.destroyed;
      flags.setFlagMirror('perf-ui', false); flags.applyPerfUi(false);
      stub.hold();
      const pending = dock.host.viz.mount(canvas);
      await stub.entered;
      flags.setFlagMirror('perf-ui', true); flags.applyPerfUi(true);
      stub.finish(); await pending;
      const lateDestroyed = stub.destroyed, savedEnabled = dock.host.viz.enabled();
      flags.setFlagMirror('perf-ui', false); flags.applyPerfUi(false);
      await dock.host.viz.mount(canvas);
      const mounts = stub.mounts;
      dock.destroy();
      return { activeDestroyed, lateDestroyed, savedEnabled, mounts, destroyed: stub.destroyed };
    });
    assert.deepEqual(result, { activeDestroyed: 1, lateDestroyed: 2, savedEnabled: true, mounts: 3, destroyed: 3 });
  } finally { await browser.close(); }
});

test('gallery searching preserves tile order and identity while sort still reorders', options, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
    await fixture(page);
    await page.evaluate(async () => {
      const bridgePath = '/src/bridge/index.ts';
      const host = await (await import(bridgePath)).createBridge();
      const profile = await host.profile.get();
      await host.profile.set({ ...profile, featureFlags: { ...profile.featureFlags, 'perf-ui': true } });
      for (const key of ['lolly-welcome-dismissed', 'lolly-tips-dismissed', 'lolly-privacy-ack']) localStorage.setItem(key, '1');
    });
    const engineRequests: string[] = [];
    page.on('request', request => { if (request.url().includes('/src/lib/mount-runtime.ts')) engineRequests.push(request.url()); });
    // Wait for the full gallery itself, not for unrelated offline/background traffic.
    await page.route('**/catalog/tools/index.slim.json', route => route.abort());
    await page.goto(`${origin}/#/`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');
    await page.waitForTimeout(600); // let the first catalog/locale refresh finish its view fade
    await page.locator('.view-fade').waitFor({ state: 'detached' });
    await page.locator('#view .tool-masonry .gtile').first().waitFor();
    assert.equal(await page.locator('html').getAttribute('data-perf-ui'), '');
    assert.deepEqual(engineRequests, [], 'performance mode does not idle-warm the engine');
    const engine = page.waitForRequest(request => request.url().includes('/src/lib/mount-runtime.ts'));
    await page.locator('a[href*="/tool/design"]').first().hover();
    await engine;
    await page.mouse.move(0, 0);
    const result = await page.evaluate(async () => {
      const grid = document.querySelector('#view .tool-masonry')!;
      const original = [...grid.querySelectorAll<HTMLElement>('.gtile')];
      let moves = 0;
      const observer = new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) {
          if (original.includes(node as HTMLElement)) moves++;
        }
      });
      observer.observe(grid, { childList: true });
      const input = document.querySelector<HTMLInputElement>('.gallery-search')!;
      input.value = 'qr'; input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 500));
      const sameNodes = [...grid.querySelectorAll('.gtile')].every((node, i) => node === original[i]);
      const filtered = original.filter(tile => !tile.classList.contains('is-filtered')).length;
      input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 500));
      const restored = original.filter(tile => !tile.classList.contains('is-filtered')).length;
      observer.disconnect();
      return { moves, sameNodes, filtered, restored, total: original.length };
    });
    assert.equal(result.moves, 0);
    assert.equal(result.sameNodes, true);
    assert.ok(result.filtered > 0 && result.filtered < result.restored, JSON.stringify(result));
    await page.locator('.gallery-sort').selectOption('az', { force: true });
    const names = await page.locator('.tool-masonry .gtile:not(.is-hidden-tool) .gtile-name').allTextContents();
    assert.ok(names.length > 1);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })));
  } finally { await browser.close(); }
});

test('template previews reject hover in performance mode and cancel a pending mount on toggle', options, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await fixture(page);
    await page.route('**/src/pro/render-export.ts*', route => route.fulfill({ contentType: 'text/javascript', body: `
      export const stats = globalThis.__lollyPerfTemplateStats ??= { mounts: 0, destroys: 0 };
      export async function mountTemplateMotion() {
        stats.mounts++;
        const stage = document.createElement('div'), canvas = document.createElement('div');
        stage.append(canvas);
        return { stage, canvas, width: 100, height: 100, seek() {}, destroy() { stats.destroys++; stage.remove(); } };
      }
    ` }));
    const result = await page.evaluate(async () => {
      const flagPath = '/src/feature-flags.ts', motionPath = '/src/lib/template-motion-preview.ts', renderPath = '/src/pro/render-export.ts';
      const flags = await import(flagPath), motion = await import(motionPath), stub = await import(renderPath);
      const root = document.createElement('div');
      root.innerHTML = '<article data-template="demo"><div class="media" style="width:200px;height:200px"></div><button data-motion-play>Preview animation</button></article>';
      document.body.append(root);
      const card = root.querySelector<HTMLElement>('article')!, button = root.querySelector('button')!;
      const entry = { values: {}, motion: { durationMs: 1000 } };
      let loads = 0, release: (() => void) | undefined;
      let delayed = false;
      const destroy = motion.armTemplateMotion(root, {
        host: {}, toolId: 'design', card: '[data-template]', media: '.media', id: () => 'demo',
        load: async () => { loads++; if (delayed) await new Promise<void>(resolve => { release = resolve; }); return entry; },
      });
      const settle = () => new Promise(resolve => setTimeout(resolve, 80));
      flags.setFlagMirror('perf-ui', true); flags.applyPerfUi(true);
      card.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      await settle(); const hoverLoads = loads;
      button.click();
      for (let i = 0; i < 40 && !card.hasAttribute('data-motion-playing'); i++) await settle();
      const played = stub.stats.mounts;
      flags.applyPerfUi(true); const stopped = stub.stats.destroys;
      flags.setFlagMirror('perf-ui', false); flags.applyPerfUi(false);
      delayed = true;
      card.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      flags.setFlagMirror('perf-ui', true); flags.applyPerfUi(true);
      release?.(); await settle();
      const afterPending = stub.stats.mounts;
      destroy();
      return { hoverLoads, played, stopped, afterPending };
    });
    assert.deepEqual(result, { hoverLoads: 0, played: 1, stopped: 1, afterPending: 1 });
  } finally { await browser.close(); }
});
