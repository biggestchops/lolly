// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { chromium } from 'playwright';

const origin = process.env.LOLLY_IMPORT_TEST_URL;
const options = { skip: origin ? false : 'set LOLLY_IMPORT_TEST_URL to a local Vite shell', timeout: 120_000 };
test('cold brand discovery shares a slow asset sync without a second index request', options, async () => {
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin!).hostname));
  const browser = await chromium.launch({ headless: true, channel: process.env.LOLLY_BROWSER_CHANNEL });
  try {
    const page = await browser.newPage();
    let reads = 0;
    await page.route('**/catalog/assets/index.json', async route => {
      reads++;
      await new Promise<void>(resolve => setTimeout(resolve, 750));
      await route.continue();
    });
    await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
    assert.equal(reads, 1);
  } finally { await browser.close(); }
});

test('local looks compare without writes, apply through recovery, and retain search tags', options, async () => {
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin!).hostname));
  const browser = await chromium.launch({ headless: true, channel: process.env.LOLLY_BROWSER_CHANNEL });
  try {
    const context = await browser.newContext({ viewport: { width: 1024, height: 1000 }, hasTouch: true, reducedMotion: 'reduce' });
    await context.addInitScript(() => { for (const key of ['lolly-welcome-dismissed', 'lolly-tips-dismissed', 'lolly-privacy-ack']) localStorage.setItem(key, '1'); });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/#/start`, { waitUntil: 'networkidle' });
    const read = () => page.evaluate(async () => { const p = '/src/bridge/index.ts'; return (await (await import(p)).createBridge()).tokens.raw(); });
    const before = await read();
    await page.getByRole('button', { name: 'Find a look', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Find a look', exact: true });
    await dialog.locator('[data-look-select="example:sunroom"]').check();
    await dialog.locator('[data-look-select="example:orchard"]').check();
    assert.equal(await dialog.locator('[data-look-detail]').count(), 2);
    await dialog.locator('[data-look-select="example:playroom"]').click();
    assert.equal(await dialog.locator('[data-look-select="example:playroom"]').isChecked(), false);
    assert.deepEqual(await read(), before);
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.screenshot({ path: '/tmp/lolly-brand-looks-tablet.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { document.documentElement.dataset.a11yText = 'large'; });
    assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
    await dialog.locator('[data-look-detail="example:sunroom"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: '/tmp/lolly-brand-looks-phone.png', fullPage: true });
    await dialog.locator('[data-look-use="example:sunroom"]').click();
    await dialog.waitFor({ state: 'detached' });
    assert.notDeepEqual(await read(), before);
    await page.getByRole('button', { name: 'Find a look', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Find a look', exact: true });
    const saved = dialog.locator('[data-look-select]:not([data-look-select^="example:"])').last();
    await saved.check();
    const detail = dialog.locator('[data-look-detail]:not([data-look-detail^="example:"])');
    await detail.locator('summary').click();
    await detail.locator('[data-look-tags]').fill('School, Summer');
    await detail.getByRole('button', { name: 'Save tags', exact: true }).click();
    await dialog.getByText('Tags saved.', { exact: true }).waitFor();
    const savedId = await saved.getAttribute('data-look-select');
    const hostileLabel = '<img src=x onerror="throw new Error(\'unsafe brand label\')">';
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.evaluate(async ({ id, label }) => {
      const path = '/src/bridge/index.ts';
      const host = await (await import(path)).createBridge();
      const record = await host.designSystems.get(id);
      await host.designSystems.put({ ...record, label });
    }, { id: savedId, label: hostileLabel });
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Find a look', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Find a look', exact: true });
    await dialog.locator('[data-looks-search]').fill('school');
    assert.equal(await dialog.locator('[data-look-select]').count(), 1);
    await dialog.locator('[data-look-select]').check();
    assert.equal(await dialog.locator('h4').textContent(), hostileLabel);
    assert.equal(await dialog.locator('img[src="x"]').count(), 0);
    await dialog.locator('summary').click();
    const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Download design context', exact: true }).click()]);
    const report = JSON.parse(await readFile((await download.path())!, 'utf8'));
    assert.equal(report.format, 'lolly-design-context');
    assert.equal(report.name, hostileLabel);
    assert.ok(report.tokens && report.colors.length);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('the real extension collector measures bounded styles without carrying page text', options, async () => {
  const source = await readFile(new URL('../shells/chrome-extension/background.js', import.meta.url), 'utf8');
  const capsSource = source.match(/const SITE_CAPS = (\{[\s\S]*?\n\});/)?.[1];
  assert.ok(capsSource);
  const caps = vm.runInNewContext(`(${capsSource})`);
  const collector = source.slice(source.indexOf('async function collectSite(caps)'));
  const browser = await chromium.launch({ headless: true, channel: process.env.LOLLY_BROWSER_CHANNEL });
  try {
    const page = await browser.newPage();
    await page.route(`${origin}/brand-capture-fixture`, route => route.fulfill({ contentType: 'text/html', body: '<style>p { font-size:24px; padding-left:16px; border-radius:12px }</style>' + '<p>Private words</p>'.repeat(250) }));
    await page.goto(`${origin}/brand-capture-fixture`);
    const result = await page.evaluate(async ({ collector, caps }) => {
      const collect = new Function(`return (${collector})`)();
      return (await collect(caps)).styles;
    }, { collector, caps });
    assert.equal(result.mode, 'computed');
    assert.equal(result.sampled, 200);
    assert.equal(result.truncated, true);
    assert.ok(result.values.some((v: { property: string; value: string }) => v.property === 'font-size' && v.value === '24px'));
    assert.ok(!JSON.stringify(result).includes('Private words'));
  } finally { await browser.close(); }
});

test('export offers an individual brand fix and ordinary Undo restores the original colour', options, async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.LOLLY_BROWSER_CHANNEL });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce' });
    await page.addInitScript(() => { for (const key of ['lolly-welcome-dismissed', 'lolly-tips-dismissed', 'lolly-privacy-ack']) localStorage.setItem(key, '1'); });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const boxes = [{ id: 'brand-test', kind: 'text', name: 'Greeting', text: 'Hello', x: 30, y: 30, w: 200, h: 100, fg: '#ed1234', font: 'sans' }];
    await page.goto(`${origin}/#/tool/design?boxes=${encodeURIComponent(JSON.stringify(boxes))}`, { waitUntil: 'networkidle' });
    const text = page.locator('.lolly-box[data-box-id="brand-test"] .lolly-box-text').first();
    const color = () => text.evaluate(el => getComputedStyle(el).color);
    const before = await color();
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await page.locator('[data-action="preflight-open"]').click();
    const dialog = page.locator('.preflight-modal');
    const fix = dialog.locator('[data-preflight-fix]').first();
    await fix.waitFor();
    assert.equal(await fix.evaluate(el => el.getBoundingClientRect().height >= 44), true);
    await fix.click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.lolly-box[data-box-id="brand-test"] .lolly-box-text')!).color !== 'rgb(237, 18, 52)');
    assert.notEqual(await color(), before);
    await dialog.locator('[data-preflight-close]').click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.lolly-box[data-box-id="brand-test"] .lolly-box-text')!).color === 'rgb(237, 18, 52)');
    assert.equal(await color(), before);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
