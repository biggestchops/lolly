// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import type { CanvasCommitEl } from '../shells/web/src/lib/canvas-commit.ts';
import { getBrowser, closeBrowser } from '../packages/node-shell/src/browsers.ts';
import { journeyDiagnostics } from './helpers/journey-diagnostics.ts';
const origin = process.env.LOLLY_EXPORT_TEST_URL;
test('zoomed Design reaches every canvas corner and keeps wheel, middle and space panning free', { skip: origin ? false : 'set LOLLY_EXPORT_TEST_URL', timeout: 120000 }, async () => {
  const browser = await getBrowser(), context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage(), diagnose = journeyDiagnostics(context, 'design-pan-edges');
  page.setDefaultTimeout(15000);
  const boxes = [[0, 0], [1576, 0], [0, 976], [1576, 976]].map(([x, y], index) => ({ id: `corner-${index}`, kind: 'box', x, y, w: 24, h: 24, bg: '#118855' }));
  try {
    await page.goto(`${origin}/design?${new URLSearchParams({ width: '1600', height: '1000', boxes: JSON.stringify(boxes), c2pa: '0', imprint: '0' })}`);
    await page.locator('#tool-canvas [data-box-id="corner-0"]').waitFor();
    // Both side panels remain present: the centre must be in the usable canvas band.
    const centre = await page.locator('#tool-stage').evaluate(stage => {
      const element = stage as HTMLElement, rect = element.getBoundingClientRect();
      const reserve = (side: string) => parseFloat(element.style.getPropertyValue(`--stage-reserve-${side}`)) || 0;
      return { x: (rect.left + reserve('left') + rect.right - reserve('right')) / 2, y: (rect.top + reserve('top') + rect.bottom - reserve('bottom')) / 2 };
    });
    await page.locator('#tool-canvas').focus();await page.keyboard.press('1');
    for (let step = 0; step < 6; step++) await page.keyboard.press('=');
    for (const box of boxes) {
      const target = page.locator(`#tool-canvas [data-box-id="${box.id}"]`);
      const rect = await target.boundingBox();assert.ok(rect);assert.ok(rect.width > 80, 'canvas is zoomed above 300%');
      await page.mouse.move(centre.x, centre.y);await page.mouse.wheel(rect.x + rect.width / 2 - centre.x, rect.y + rect.height / 2 - centre.y);
      await page.waitForFunction(({ id, centre }) => { const rect = document.querySelector(`#tool-canvas [data-box-id="${id}"]`)!.getBoundingClientRect();return Math.abs(rect.x + rect.width / 2 - centre.x) < 2 && Math.abs(rect.y + rect.height / 2 - centre.y) < 2; }, { id: box.id, centre });
      await page.mouse.click(centre.x, centre.y);await page.waitForFunction(id=>document.querySelector(`#tool-canvas [data-box-id="${id}"]`)?.getAttribute('aria-pressed')==='true',box.id);
    }
    const last = page.locator('#tool-canvas [data-box-id="corner-3"]');
    const before = await last.boundingBox();assert.ok(before);
    await page.mouse.move(centre.x, centre.y);await page.mouse.down({ button: 'middle' });await page.mouse.move(centre.x + 120, centre.y + 80, { steps: 8 });await page.mouse.up({ button: 'middle' });
    const middle = await last.boundingBox();assert.ok(middle);assert.ok(Math.abs(middle.x - before.x - 120) < 2);assert.ok(Math.abs(middle.y - before.y - 80) < 2);
    await page.locator('#tool-canvas').focus();await page.keyboard.down('Space');await page.mouse.move(centre.x, centre.y);await page.mouse.down();await page.mouse.move(centre.x - 120, centre.y - 80, { steps: 8 });await page.mouse.up();await page.keyboard.up('Space');
    const after = await last.boundingBox();assert.ok(after);assert.ok(Math.abs(after.x - before.x) < 2, JSON.stringify({before,middle,after}));assert.ok(Math.abs(after.y - before.y) < 2);
    const saved = await page.evaluate(() => (document.getElementById('tool-canvas') as CanvasCommitEl).__lollyModel!().find(input => input.id === 'boxes')!.value as Array<Record<string, unknown>>);
    for (const box of boxes) { const actual = saved.find(item => item.id === box.id)!;assert.equal(actual.x, box.x);assert.equal(actual.y, box.y); }
    await page.locator('#tool-canvas').focus();await page.keyboard.press('0');
    for (const box of boxes) { const rect = await page.locator(`#tool-canvas [data-box-id="${box.id}"]`).boundingBox();assert.ok(rect && rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 1440 && rect.y + rect.height <= 1000, 'Fit recovers every corner'); }
  } catch (error) { await diagnose(error);throw error; } finally { await context.close();await closeBrowser(); }
});


test('RTL Design fits the full physical canvas on desktop and compact screens', { skip: origin ? false : 'set LOLLY_EXPORT_TEST_URL', timeout: 90000 }, async () => {
  const browser = await getBrowser();
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
      const page = await context.newPage(), diagnose = journeyDiagnostics(context, `design-pan-rtl-${width}`);
      try {
        const boxes = [[0, 0], [1576, 0], [0, 976], [1576, 976]].map(([x, y], index) => ({ id: `corner-${index}`, kind: 'box', x, y, w: 24, h: 24, bg: '#118855' }));
        await page.goto(`${origin}/design?${new URLSearchParams({ lang: 'ar', width: '1600', height: '1000', boxes: JSON.stringify(boxes), c2pa: '0', imprint: '0' })}`);
        await page.locator('#tool-canvas [data-box-id="corner-0"]').waitFor();
        await page.locator('#tool-canvas').focus();await page.keyboard.press('0');
        await page.waitForFunction(width => [...document.querySelectorAll('#tool-canvas [data-box-id]')].every(element => {
          const rect = element.getBoundingClientRect();return rect.width > 0 && rect.left >= 0 && rect.right <= width && rect.top >= 0 && rect.bottom <= 844;
        }), width);
        assert.equal(await page.locator('#tool-canvas').evaluate(element => getComputedStyle(element).direction), 'rtl');
        await page.locator('#tool-canvas [data-box-id="corner-0"]').click();
        assert.equal(await page.locator('#tool-canvas [data-box-id="corner-0"]').getAttribute('aria-pressed'), 'true');
      } catch (error) { await diagnose(error);throw error; } finally { await context.close(); }
    }
  } finally { await closeBrowser(); }
});
