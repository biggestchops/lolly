// SPDX-License-Identifier: MPL-2.0
/** Run against a served build with LOLLY_MOBILE_TEST_URL, and optionally LOLLY_MOBILE_TEST_BROWSER=webkit. */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium, devices, type Page, webkit } from 'playwright';

const origin = process.env.LOLLY_MOBILE_TEST_URL;
const skip = origin ? false : 'Set LOLLY_MOBILE_TEST_URL to a served web build.';
const browserType = process.env.LOLLY_MOBILE_TEST_BROWSER === 'webkit' ? webkit : chromium;
const output = process.env.LOLLY_MOBILE_TEST_OUTPUT || '/tmp/lolly-mobile-web';

async function fitsPhone(page: Page): Promise<void> {
  const viewport = await page.evaluate(() => ({
    width: innerWidth,
    screen: screen.width,
    scale: visualViewport?.scale,
    scroll: document.documentElement.scrollWidth,
  }));
  assert.equal(viewport.width, viewport.screen, 'the page uses the device width');
  assert.equal(viewport.scale, 1, 'the browser does not shrink the page');
  assert.ok(viewport.scroll <= viewport.width + 1, 'the document has no horizontal overflow');
}

for (const device of ['iPhone 13', 'iPad Mini']) {
  test(`mobile gallery and course authoring on ${device}`, { skip, timeout: 180_000 }, async () => {
    await mkdir(output, { recursive: true });
    const profile = await mkdtemp(join(tmpdir(), 'lolly-mobile-browser-'));
    // A persistent test profile exercises saved files as well as page layout.
    const context = await browserType.launchPersistentContext(profile, {
      ...devices[device],
      serviceWorkers: 'block',
    });
    let page: Page | undefined;
    try {
      page = await context.newPage();
      page.setDefaultTimeout(30_000);
      await page.goto(origin!);
      await page.locator('.gtile').first().waitFor();
      await fitsPhone(page);
      await page.screenshot({ path: `${output}/${device}-gallery.png` });
      await page.close();
      page = await context.newPage();
      page.setDefaultTimeout(30_000);
      await page.goto(`${origin}/#/learning`);
      await page.getByRole('heading', { name: 'Course editor', exact: true }).waitFor();
      await fitsPhone(page);
      await page.getByLabel('Course title', { exact: true }).fill('Mobile course');
      const outline = page.locator('.learning-outline-disclosure');
      if (!(await outline.evaluate((el) => (el as HTMLDetailsElement).open)))
        await outline.locator('summary').tap();
      await page.getByRole('button', { name: 'Add lesson', exact: true }).tap();
      await page.getByLabel('Lesson title', { exact: true }).fill('Welcome');
      await page.getByRole('button', { name: 'Add text', exact: true }).tap();
      await page
        .getByRole('textbox', { name: 'Lesson text', exact: true })
        .fill('Welcome to the course.');
      await page.getByRole('button', { name: 'Add quiz', exact: true }).tap();
      await page
        .getByRole('textbox', { name: 'Question', exact: true })
        .fill('Where can this course run?');
      await page.getByRole('textbox', { name: 'Answer 1', exact: true }).fill('On a website');
      await page
        .getByRole('textbox', { name: 'Answer 2', exact: true })
        .fill('Only inside the editor');
      await page.getByRole('button', { name: 'Export course', exact: true }).tap();
      const delivery = page.getByRole('dialog', { name: 'Export course', exact: true });
      await delivery.locator('[data-delivery-target]').selectOption('static');
      await delivery.getByRole('button', { name: 'Review course', exact: true }).tap();
      await delivery.getByRole('button', { name: 'Check and prepare package', exact: true }).tap();
      const save = delivery.getByRole('button', {
        name: 'Save version and download ZIP',
        exact: true,
      });
      await save.waitFor();
      const bounds = await delivery.boundingBox();
      assert.ok(
        bounds && bounds.x >= 0 && bounds.x + bounds.width <= page.viewportSize()!.width + 1,
        'the export dialog fits the device'
      );
      await page.screenshot({ path: `${output}/${device}-export.png` });
      const download = page.waitForEvent('download');
      await save.tap();
      const file = await download;
      assert.equal(await file.failure(), null);
      assert.match(file.suggestedFilename(), /\.zip$/);
      await delivery.getByRole('button', { name: 'Done', exact: true }).tap();
      await page.getByRole('button', { name: 'Preview as learner', exact: true }).tap();
      await page.locator('.learning-preview iframe').waitFor();
      const preview = page.frameLocator('.learning-preview iframe');
      await preview.getByText('Welcome to the course.', { exact: true }).waitFor();
      await preview.getByRole('radio', { name: 'On a website', exact: true }).tap();
      await preview.getByRole('button', { name: 'Check answer', exact: true }).tap();
      await preview.getByText('Correct.', { exact: true }).waitFor();
      await preview.getByRole('button', { name: 'Complete lesson', exact: true }).tap();
      await preview.getByText('1 of 1 required lessons complete', { exact: true }).waitFor();
      await page.screenshot({ path: `${output}/${device}-learner.png` });
      await page.getByRole('button', { name: 'Close preview', exact: true }).tap();
      await fitsPhone(page);
    } catch (error) {
      if (page) {
        await page.screenshot({ path: `${output}/${device}-failure.png` });
        await writeFile(
          `${output}/${device}-failure.txt`,
          await page.locator('body').ariaSnapshot()
        );
      }
      throw error;
    } finally {
      await context.close();
      await rm(profile, { recursive: true, force: true });
    }
  });
}
