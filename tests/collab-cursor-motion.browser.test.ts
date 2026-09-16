// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const origin = process.env.LOLLY_PRESENT_TEST_URL;
const output = process.env.LOLLY_PRESENT_TEST_OUTPUT ?? '/tmp/lolly-presentation-260';
test('cursor tips stay anchored while labels swing and reduced motion clears the decoration', {
  skip: origin ? false : 'LOLLY_PRESENT_TEST_URL not set', timeout: 30_000,
}, async () => {
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1000, height: 640 }, recordVideo: { dir: `${output}/cursor-video`, size: { width: 1000, height: 640 } } });
    const page = await context.newPage();
    await context.route(`${origin}/cursor-motion`, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><style>
      :root{--a11y-fs:1;--card:0 0% 100%;--primary:155 50% 45%}body{margin:0;background:#eef1ee;font-family:system-ui}
      main{position:relative;width:880px;height:520px;margin:60px;background:#fff;border-radius:16px}
      #art{height:100%;box-sizing:border-box;padding:60px;color:#103c33}h1{font-size:54px;letter-spacing:-2px;width:540px;margin:60px 0 20px}p{color:#61746c;font-size:20px}
      </style><main><div id="art"><small>LOLLY / SHARED WORKSPACE</small><h1>A little room<br>for play.</h1><p>Make something together.</p></div></main>` }));
    await page.goto(`${origin}/cursor-motion`);
    await page.evaluate(async () => {
      const path = '/src/components/collab-overlay.ts';
      const { createCollabCursors } = await import(path);
      const cursors = createCollabCursors({ stage: document.querySelector('#art') });
      const peers = [{ id: 'alex', name: 'Alex', color: '#91c9ba', cursor: { x: 0.55, y: 0.68 } }, { id: 'jo', name: 'Jo', color: '#cab0df', cursor: { x: 0.24, y: 0.31 } }];
      cursors.setPeers(peers);
      (window as any).demo = { cursors, peers };
    });
    for (let i = 0; i < 50; i++) {
      await page.evaluate(i => {
        const { cursors, peers } = (window as any).demo;
        peers[0].cursor = { x: 0.55 + Math.sin(i / 7) * 0.13, y: 0.68 + Math.sin(i / 9) * 0.06 };
        peers[1].cursor = { x: 0.24 + Math.sin(i / 8) * 0.09, y: 0.31 + Math.cos(i / 6) * 0.08 };
        cursors.setPeers(peers);
      }, i);
      await page.waitForTimeout(50);
    }
    await page.screenshot({ path: `${output}/collaborator-cursor-swing.png` });
    const pivots = await page.locator('.collab-cursor-body').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).transformOrigin));
    assert.deepEqual(pivots, ['0px 0px', '0px 0px']);
    await page.waitForFunction(() => !(window as any).demo.cursors.stats().ticking);
    const position = await page.locator('[data-client-id="alex"]').evaluate(el => {
      const matrix = new DOMMatrix(getComputedStyle(el).transform); return { x: matrix.m41, y: matrix.m42 };
    });
    const expected = await page.evaluate(() => { const { cursor } = (window as any).demo.peers[0]; return { x: cursor.x * 880, y: cursor.y * 520 }; });
    assert.ok(Math.abs(position.x - expected.x) < 0.001 && Math.abs(position.y - expected.y) < 0.001);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.querySelectorAll('.collab-cursor--still').length === 2);
    await page.evaluate(() => { const { cursors, peers } = (window as any).demo; peers[0].cursor.x = 0.7; cursors.setPeers(peers); });
    assert.equal(await page.locator('.collab-cursor--still').count(), 2);
    assert.equal(await page.evaluate(() => (window as any).demo.cursors.stats().ticking), false);
    await page.evaluate(() => (window as any).demo.cursors.dispose());
    await context.close();
  } finally { await browser.close(); }
});
