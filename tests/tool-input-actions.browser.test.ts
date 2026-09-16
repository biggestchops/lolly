// SPDX-License-Identifier: MPL-2.0
/** LOLLY_GALLERY_TEST_URL=http://127.0.0.1:5173 node --test tests/tool-input-actions.browser.test.ts */
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin = process.env.LOLLY_GALLERY_TEST_URL;
test('Charts data actions sit above the textarea and remain clickable with larger text', {
  skip: origin ? false : 'set LOLLY_GALLERY_TEST_URL to a local Vite shell', timeout: 180_000,
}, async (t) => {
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin!).hostname));
  const browser = await chromium.launch({ headless: true });
  try {
    for (const large of [false, true]) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce', hasTouch: large });
      const page = await context.newPage();
      await page.addInitScript(() => {
        for (const key of ['lolly-welcome-dismissed', 'lolly-tips-dismissed', 'lolly-privacy-ack']) localStorage.setItem(key, '1');
      });
      await page.goto(`${origin}/#/tool/chart?template=brand-bars`, { waitUntil: 'domcontentloaded' });
      t.diagnostic(`Opening chart, large text: ${large}`);
      const field = page.locator('textarea[data-input-id="data"]');
      await field.waitFor({ timeout: 60_000 });
      if (large) await page.evaluate(() => document.documentElement.setAttribute('data-a11y-text', 'large'));
      const row = page.locator('.input-row').filter({ has: field });
      await row.scrollIntoViewIfNeeded();
      const labelBox = await row.locator('.input-label').boundingBox();
      const inputBox = await field.boundingBox();
      assert.ok(labelBox && inputBox && labelBox.y + labelBox.height + 6 <= inputBox.y);
      for (const selector of ['.help-tip-btn', '.input-data-src']) {
        const button = row.locator(selector);
        const target = await button.evaluate(b => {
          const rect = b.getBoundingClientRect();
          return { width: rect.width, height: rect.height, hit: b.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)) };
        });
        assert.ok(target.width >= 32 && target.height >= 32 && target.hit);
      }
      await row.locator('.help-tip-btn').click();
      assert.equal(await row.locator('.help-tip-btn').getAttribute('aria-expanded'), 'true');
      await page.keyboard.press('Escape');
      assert.equal(await row.locator('.help-tip-btn').getAttribute('aria-expanded'), 'false');
      t.diagnostic('Help and pointer targets passed; opening data source');
      const chooser = page.waitForEvent('filechooser');
      await row.locator('.input-data-src').click();
      const dialog = page.getByRole('dialog').filter({ hasText: 'Where should the data come from?' });
      const source = await Promise.race([chooser.then(() => 'file'), dialog.waitFor({ state: 'visible' }).then(() => 'dialog')]);
      if (source === 'dialog') await dialog.getByRole('button', { name: 'Choose a file', exact: true }).click();
      await (await chooser).setFiles({ name: 'sample.csv', mimeType: 'text/csv', buffer: Buffer.from('Category,Value\nFirst,42\nSecond,68') });
      await page.waitForFunction(() => document.querySelector<HTMLTextAreaElement>('textarea[data-input-id="data"]')?.value.includes('Second'));
      t.diagnostic('File data reached the textarea');
      await context.close();
    }
  } finally { await browser.close(); }
});
