// SPDX-License-Identifier: MPL-2.0
/** Set LOLLY_DESIGN_TOOL_TEST_URL to check the Design panels in a real browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';

const origin = process.env.LOLLY_DESIGN_TOOL_TEST_URL;
const skip = origin ? false : 'Serve the web shell and set LOLLY_DESIGN_TOOL_TEST_URL.';
const output = process.env.LOLLY_DESIGN_TOOL_TEST_OUTPUT || '/tmp/lolly-design-panels';
const browserType = process.env.LOLLY_DESIGN_TOOL_TEST_BROWSER === 'webkit' ? webkit : chromium;

test('artboard parents, overflowing tracks and the narrow inspector stay usable', { skip, timeout: 120_000 }, async () => {
  await mkdir(output, { recursive: true });
  const browser = await browserType.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(15_000);
    const boxes = [
      { id: 'first', kind: 'frame', name: 'Welcome', x: 0, y: 0, w: 1920, h: 1080 },
      { id: 'second', kind: 'frame', name: 'Next steps', x: 2060, y: 0, w: 1920, h: 1080 },
      ...Array.from({ length: 14 }, (_, i) => ({ id: `copy${i}`, name: `Message ${i + 1}`, kind: 'text', frame: 'first', text: `Course message ${i + 1}`, x: 120, y: 80 + i * 60, w: 1500, h: 70, start: 0, dur: 120, lane: 'overlay' })),
    ];
    await page.goto(`${origin}/t/design?boxes=${encodeURIComponent(JSON.stringify(boxes))}`);
    await page.locator('[data-jump-artboard="second"]').click();
    assert.equal(await page.locator('[data-jump-artboard="second"]').getAttribute('aria-current'), 'true');
    await page.locator('[data-jump-artboard="first"]').click();
    await page.locator('.fc-nav-layer[data-id="copy0"]').click();
    if (!await page.locator('.fc-insp').isVisible()) await page.getByRole('button', { name: 'Inspector', exact: true }).click();
    assert.equal(await page.locator('.fc-insp [data-sec]').first().getAttribute('data-sec'), 'text');
    const tracks = page.locator('.tl-tracks');
    if (!await tracks.isVisible()) await page.getByRole('button', { name: 'Timeline', exact: true }).click();
    await tracks.focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press('+');
    const size = await tracks.evaluate(el => ({ w: el.clientWidth, sw: el.scrollWidth, h: el.clientHeight, sh: el.scrollHeight }));
    assert.ok(size.sw > size.w && size.sh > size.h, 'both axes overflow in this sequence');
    await tracks.evaluate(el => { el.scrollLeft = 0; el.scrollTop = 0; });
    await tracks.hover(); await page.mouse.wheel(500, 300);
    await page.waitForFunction(() => {
      const el = document.querySelector('.tl-tracks')!;
      return el.scrollLeft > 0 && el.scrollTop > 0;
    });
    await page.screenshot({ path: `${output}/desktop.png` });
    for (const width of [640, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByRole('button', { name: 'More actions', exact: true }).click();
      await page.getByRole('menuitemcheckbox', { name: 'Inspector', exact: true }).click();
      const sheet = page.getByRole('dialog', { name: 'Inspector', exact: true });
      await sheet.waitFor();
      assert.equal(await page.getByRole('menuitemcheckbox', { name: 'Inspector', exact: true }).count(), 0, 'the launching menu closes');
      const sizes = await sheet.locator('.fc-insp').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
      assert.equal(sizes.scroll, sizes.width, 'inspector fields fit the sheet');
      await sheet.getByRole('button', { name: 'Align left', exact: true }).click();
      assert.equal(await sheet.getByRole('button', { name: 'Align left', exact: true }).getAttribute('aria-pressed'), 'true');
      await page.screenshot({ path: `${output}/inspector-${width}.png` });
      await page.keyboard.press('Escape');
      await sheet.waitFor({ state: 'detached' });
      assert.equal(await page.locator('.fc-nav-layer[data-id="copy0"]').getAttribute('aria-selected'), 'true', 'closing the sheet preserves selection');
    }
  } finally { await browser.close(); }
});
