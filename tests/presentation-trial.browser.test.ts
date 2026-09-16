// SPDX-License-Identifier: MPL-2.0
/** Normal file import and presentation against a built shell; no private module imports. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';

const origin = process.env.LOLLY_PRESENT_TEST_URL;
const fixture = process.env.LOLLY_PRESENT_TRIAL_FILE;
const output = process.env.LOLLY_PRESENT_TEST_OUTPUT ?? '/tmp/lolly-presentation-260/m1-acceptance';

test('a portable presentation retains its logo, saved scenes and private control lifecycle', {
  skip: origin && fixture ? false : 'set LOLLY_PRESENT_TEST_URL and LOLLY_PRESENT_TRIAL_FILE from build-presentation-trial.ts',
  timeout: 90_000,
}, async ctx => {
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin!).hostname));
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let controls: Page | undefined;
  try {
    await page.goto(`${origin}/#/p`);
    await page.getByRole('heading', { name: 'Projects', exact: true }).waitFor();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Open a file - import a .lolly, design or image' }).click();
    await (await chooser).setFiles(fixture!);
    await page.getByRole('button', { name: 'Open shared design', exact: true }).click();
    await page.getByRole('button', { name: 'Present options', exact: true }).click();
    const popup = page.waitForEvent('popup');
    await page.getByRole('menuitem', { name: 'Present with camera', exact: true }).click();
    controls = await popup;
    await controls.getByRole('heading', { name: 'Presentation', exact: true }).waitFor();
    await controls.getByRole('button', { name: 'Start camera', exact: true }).waitFor();
    assert.equal(await controls.locator('.pr-sp-notes').textContent(),
      'PRIVATE NOTES 1: This sentence must appear only in Speaker view.');
    assert.equal(await page.locator('.pr-program').getByText(/PRIVATE NOTES/).count(), 0);
    assert.equal(await page.locator('.pr-program').locator('button,input').count(), 0);
    await controls.getByRole('button', { name: 'Apply prepared scene', exact: true }).click();
    await controls.getByRole('status').filter({ hasText: 'Scene applied.' }).waitFor();
    assert.equal(await page.locator('.pr-program-logo').evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), true);
    await controls.getByRole('button', { name: 'Start camera', exact: true }).click();
    await controls.getByRole('status').filter({ hasText: 'Camera ready.' }).waitFor();
    await controls.getByRole('button', { name: 'Show lower third', exact: true }).click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.pr-program-lower')!).opacity === '1');
    for (let slide = 1; slide <= 3; slide++) {
      await page.screenshot({ path: `${output}/trial-slide-${slide}.png`, animations: 'disabled' });
      if (slide < 3) {
        await controls.getByRole('button', { name: 'Next', exact: true }).click();
        await controls.locator('.pr-sp-notes').filter({ hasText: `PRIVATE NOTES ${slide + 1}:` }).waitFor();
      }
    }
    await controls.getByText('Saved scenes', { exact: true }).click();
    await controls.getByLabel('Saved scene', { exact: true }).selectOption('conversation');
    await controls.getByRole('status').filter({ hasText: 'Scene prepared. Apply to show it.' }).waitFor();
    assert.equal(await page.locator('.pr-program-camera').evaluate((el: HTMLElement) => el.style.width), '304px');
    await controls.getByRole('button', { name: 'Apply prepared scene', exact: true }).click();
    await page.waitForFunction(() => document.querySelector<HTMLElement>('.pr-program-camera')!.style.width === '1280px');
    await controls.getByLabel('Saved scene', { exact: true }).selectOption('slides');
    await controls.getByRole('button', { name: 'Apply prepared scene', exact: true }).click();
    await page.waitForFunction(() => document.querySelector<HTMLElement>('.pr-program-camera')!.style.width === '304px');
    await controls.getByText('Saved scenes', { exact: true }).click();
    await controls.screenshot({ path: `${output}/trial-controls.png`, animations: 'disabled' });
    await controls.close();
    await page.locator('.pr-program-holding').waitFor({ state: 'visible' });
    const reopened = page.waitForEvent('popup'); await page.keyboard.press('s'); controls = await reopened;
    await controls.getByRole('button', { name: 'Start camera', exact: true }).waitFor();
    assert.equal(await controls.getByRole('button', { name: 'Stop camera', exact: true }).count(), 0);
    await controls.getByRole('button', { name: 'End presentation', exact: true }).click();
    await page.getByRole('button', { name: 'Present options', exact: true }).waitFor();
    assert.deepEqual(errors, []);
    await writeFile(`${output}/fixture-browser-result.json`, JSON.stringify({ passed: true,
      source: 'generated camera in isolated headless Chromium', browser: browser.version(),
      checks: ['normal .lolly import', 'three slides and private notes', 'embedded logo readback', 'explicit camera start',
        'animated lower third', 'saved scenes remain private until Apply', 'controls close holds black',
        'reopen keeps camera off', 'End returns to editor'], errors }, null, 2));
  } catch (error) {
    ctx.diagnostic(JSON.stringify({ url: page.url(), errors,
      status: controls && !controls.isClosed() ? await controls.getByRole('status').allTextContents() : [] }));
    await page.screenshot({ path: `${output}/trial-failure.png` });
    throw error;
  } finally { await browser.close(); }
});
