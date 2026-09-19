// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { getBrowser, closeBrowser } from '../packages/node-shell/src/browsers.ts';

const origin = process.env.LOLLY_EXPORT_TEST_URL;
test('programme editor preserves a 500-row import, cell edits, identities and atomic undo', {
  skip: !origin,
  timeout: 120000,
}, async () => {
  const browser = await getBrowser({ graphics: 'auto' });
  try {
    const context = await browser.newContext({
      serviceWorkers: 'block',
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    await page.addInitScript(() => localStorage.setItem('lolly-guide-seen', 'agenda'));
    await page.goto(`${origin}/t/agenda?template=conference-day`);
    await page.getByRole('button', { name: 'Edit programme', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit programme', exact: true });
    await dialog.getByRole('button', { name: 'Import programme', exact: true }).click();
    const text = [
      'Title\tRoom\tDate\tStart\tEnd\tCustom',
      ...Array.from(
        { length: 500 },
        (_, i) => `Session ${i + 1}\tRoom ${i + 1}\t2026-10-14\t10:00\t11:00\tKeep ${i + 1}`
      ),
    ].join('\n');
    await dialog.getByRole('textbox', { name: 'Paste spreadsheet data' }).fill(text);
    await dialog.getByRole('button', { name: 'Review import' }).click();
    await dialog.getByRole('button', { name: 'Replace programme', exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector('.tw-grid')?.getAttribute('aria-rowcount') === '501'
    );
    assert.ok((await dialog.locator('.dg-row').count()) < 50, 'the grid stays virtual');
    const first = dialog.locator('.dg-cell[data-row="0"][data-col="3"]');
    await first.click();
    for (let i = 0; i < 50; i++) await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-row')), '50');
    await page.keyboard.press('Enter');
    await dialog.locator('.dg-editor').fill('Edited session 51');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() =>
      document.querySelector('.tw-grid')?.textContent?.includes('Edited session 51')
    );
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-row') === '51');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-row')), '51');
    await dialog.getByRole('button', { name: 'Undo table edit' }).click();
    await page.waitForFunction(
      () => !document.querySelector('.tw-grid')?.textContent?.includes('Edited session 51')
    );
    await dialog.getByRole('button', { name: 'All columns' }).click();
    assert.match((await dialog.locator('.dg-header').textContent()) ?? '', /Custom/);
    const identity = dialog
      .locator('.tw-form label')
      .filter({ hasText: /^Session ID/ })
      .locator('textarea');
    assert.match(await identity.inputValue(), /^session-/);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await page.waitForSelector('.table-workbench', { state: 'detached' });
    await context.close();
  } finally {
    await closeBrowser();
  }
});

test('phone programme form keeps date controls and Done reachable', {
  skip: !origin,
  timeout: 60000,
}, async () => {
  const browser = await getBrowser({ graphics: 'auto' });
  try {
    const context = await browser.newContext({
      serviceWorkers: 'block',
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    const page = await context.newPage();
    await page.addInitScript(() => localStorage.setItem('lolly-guide-seen', 'agenda'));
    await page.goto(`${origin}/t/agenda?template=conference-day`);
    await page.getByRole('button', { name: 'Edit programme', exact: true }).click();
    const root = page.locator('.table-workbench');
    assert.equal(await root.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true);
    assert.ok((await root.locator('input[type=date]').count()) > 0);
    const done = (await root.getByRole('button', { name: 'Done', exact: true }).boundingBox())!;
    assert.ok(done.y >= 0 && done.y + done.height <= 844 && done.height >= 44);
    await context.close();
  } finally {
    await closeBrowser();
  }
});
