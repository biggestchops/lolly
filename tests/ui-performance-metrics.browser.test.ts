// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { installUiMetrics, summarizeUiTimings } from '../scripts/lib/ui-performance.ts';

test('lab observers detect a slow real click and discard work from the previous phase', { timeout: 30_000 }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<button>Slow action</button>');
    await page.evaluate(installUiMetrics);
    await page.evaluate(() => {
      document.querySelector('button')!.onclick = () => {
        const start = performance.now();
        while (performance.now() - start < 120) { /* intentional regression fixture */ }
        document.body.dataset.clicked = 'true';
      };
      window.__lollyUiMetrics.begin();
    });
    await page.getByRole('button').click();
    await page.waitForTimeout(250);
    const slow = summarizeUiTimings(await page.evaluate(() => window.__lollyUiMetrics.read()));
    assert.ok(slow.longTaskCount >= 1);
    assert.ok(slow.longTaskBlockingMs >= 60);
    assert.ok(slow.interactionMs !== null && slow.interactionMs >= 112, JSON.stringify(slow));
    assert.ok(slow.observedInteractions >= 1);
    await page.evaluate(() => window.__lollyUiMetrics.begin());
    await page.waitForTimeout(100);
    const quiet = summarizeUiTimings(await page.evaluate(() => window.__lollyUiMetrics.read()));
    assert.equal(quiet.longTaskCount, 0);
    assert.equal(quiet.interactionMs, null);
  } finally { await browser.close(); }
});
