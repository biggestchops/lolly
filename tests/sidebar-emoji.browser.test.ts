// SPDX-License-Identifier: MPL-2.0
/** Exercises the shared input picker against real tools and the shipped emoji catalog. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { getBrowser, closeBrowser } from '../packages/node-shell/src/browsers.ts';

const origin = process.env.LOLLY_IMPORT_TEST_URL;
test('tool sidebars choose an emoji set once, insert at the caret, and preserve document choices', {
  skip: origin ? false : 'set LOLLY_IMPORT_TEST_URL to a local Vite shell', timeout: 120_000,
}, async () => {
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin!).hostname));
  const browser = await getBrowser();
  const context = await browser.newContext({ viewport: { width: 1360, height: 950 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => {
    for (const key of ['lolly-welcome-dismissed', 'lolly-tips-dismissed', 'lolly-privacy-ack']) localStorage.setItem(key, '1');
  });
  const page = await context.newPage();
  const emoji = '\u{1f600}';
  const chosenSet = 'community/emoji/twemoji/color@17.0.3';
  const choose = async () => {
    const select = page.locator('.emoji-choice [data-emoji-set]');
    await select.waitFor();
    assert.equal(await page.locator('.emoji-pop unicode-emoji-picker').count(), 0);
    await select.selectOption(chosenSet);
    await page.locator('.emoji-choice').getByRole('button', { name: 'Continue', exact: true }).click();
    await page.locator('.emoji-pop unicode-emoji-picker').waitFor();
  };
  const pick = async () => {
    const cell = page.locator('.emoji-pop unicode-emoji-picker .emojis .emoji').filter({ hasText: emoji }).first();
    await cell.click();
    await page.locator('.emoji-pop').waitFor({ state: 'detached' });
  };
  try {
    await page.goto(`${origin}/#/tool/jump`, { waitUntil: 'networkidle' });
    const heading = page.locator('input[data-input-id="heading"]');
    await heading.fill('Hello friend');
    await heading.evaluate((field: HTMLInputElement) => { field.focus(); field.setSelectionRange(6, 12); });
    const insert = heading.locator('..').getByRole('button', { name: 'Insert emoji', exact: true });
    await insert.click();
    await page.locator('.emoji-choice [data-emoji-set]').waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await heading.inputValue(), 'Hello friend');
    assert.equal(new URL(page.url()).searchParams.has('emoji'), false);
    await insert.click();
    await choose();
    await pick();
    assert.equal(await heading.inputValue(), `Hello ${emoji}`);
    await page.waitForURL(url => url.searchParams.get('emoji') === chosenSet);
    assert.equal(await heading.evaluate((field: HTMLInputElement) => field.selectionStart), 8);
    // An existing emoji table cell uses the same chooser and replaces just that cell.
    const tableCell = page.locator('[data-emoji-cell]').first();
    await tableCell.click();
    await page.locator('.emoji-pop unicode-emoji-picker').waitFor();
    assert.equal(await page.locator('.emoji-choice').count(), 0);
    await pick();
    assert.equal(await page.locator('[data-emoji-cell]').first().evaluate((cell: HTMLButtonElement) => cell.value), emoji);
    await page.locator('#tool-canvas .lolly-emoji svg').first().waitFor();

    // The profile choice seeds a fresh tool; textarea insertion also uses native edits.
    await page.goto(`${origin}/#/tool/snippet`, { waitUntil: 'networkidle' });
    await page.waitForURL(url => url.searchParams.get('emoji') === chosenSet);
    const code = page.locator('textarea[data-input-id="code"]');
    await code.fill('const hello = "";');
    await code.evaluate((field: HTMLTextAreaElement) => { field.focus(); field.setSelectionRange(15, 15); });
    await code.locator('..').getByRole('button', { name: 'Insert emoji', exact: true }).click();
    await page.locator('.emoji-pop unicode-emoji-picker').waitFor();
    await pick();
    assert.equal(await code.inputValue(), `const hello = "${emoji}";`);
    assert.deepEqual(await page.locator('#tool-inputs .input-section-summary').allTextContents(), ['Text', 'Title bar', 'Look', 'Callouts']);
    assert.equal(await page.locator('#tool-inputs .input-section-icon svg').count(), 4);

    // Block fields use qualified row identities and retain the other cards.
    await page.goto(`${origin}/#/tool/diagram-builder`, { waitUntil: 'networkidle' });
    await page.locator('.block-item').first().locator('.block-collapse').click();
    const card = page.locator('input[data-field-id="nodes:0:label"]');
    const sibling = page.locator('input[data-field-id="nodes:1:label"]');
    const other = await sibling.inputValue();
    await card.fill('Chief');
    await card.evaluate((field: HTMLInputElement) => { field.focus(); field.setSelectionRange(5, 5); });
    await card.locator('..').getByRole('button', { name: 'Insert emoji', exact: true }).click();
    await page.locator('.emoji-pop unicode-emoji-picker').waitFor();
    await pick();
    assert.equal(await card.inputValue(), `Chief${emoji}`);
    assert.equal(await sibling.inputValue(), other);

    // A link's set beats the remembered set, including a narrow, large-text display.
    await page.setViewportSize({ width: 390, height: 844 });
    const linkedSet = 'community/emoji/openmoji/black@17.0.0';
    await page.goto(`${origin}/#/tool/jump?emoji=${encodeURIComponent(linkedSet)}&heading=Hi`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.documentElement.dataset.a11yText = 'large');
    const toolInputs = page.locator('#tool-inputs');
    await toolInputs.waitFor({ state: 'attached' });
    if (!await toolInputs.isVisible()) await page.getByRole('button', { name: 'Drag to resize controls, tap to expand' }).click();
    await page.locator('[data-emoji-cell]').first().click();
    await page.locator('.emoji-pop unicode-emoji-picker').waitFor();
    await page.locator('.emoji-pop').getByRole('button', { name: 'Change emoji set', exact: true }).click();
    await page.locator('.emoji-choice [data-emoji-set]').waitFor();
    assert.equal(await page.locator('.emoji-choice [data-emoji-set]').inputValue(), linkedSet);
    const box = await page.locator('.emoji-pop').boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 391 && box.y >= 0 && box.y + box.height <= 845);
    await page.locator('.emoji-choice').getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(new URL(page.url()).searchParams.get('emoji'), linkedSet);
    await page.keyboard.press('Escape');
  } finally { await context.close(); await closeBrowser(); }
});
