// SPDX-License-Identifier: MPL-2.0
/** Exercise the actual Vite worker and PDF walker, including default lazy loading. */
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const base = process.env.LOLLY_COLLAB_TEST_URL ?? 'http://127.0.0.1:5198';
const directory = resolve(process.argv.find(arg => arg.startsWith('--out='))?.slice(6) ?? '/tmp/lolly-skera-browser');
mkdirSync(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  let phase = 'boot';
  const requests: { phase: string; url: string }[] = [], errors: string[] = [];
  await page.exposeFunction('subsetPhase', (name: string) => { phase = name; });
  page.on('request', request => { if (/skera|font-subset/.test(request.url())) requests.push({ phase, url: request.url() }); });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => console.log(message.text()));
  await page.route('**/pdf-embedding-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
  await page.goto(`${base}/pdf-embedding-test`);
  const report = await page.evaluate(async () => {
    const exportPath = '/src/bridge/export.ts', textPath = '/src/bridge/text.ts';
    const exporter = await import(exportPath), text = await import(textPath);
    exporter.createExportAPI({ text: text.createTextAPI(), log(...values: unknown[]) { console.log(...values); } });
    const face = new FontFace('Outfit', 'url(/fonts/Outfit[wght].ttf)', { weight: '100 900' });
    document.fonts.add(await face.load());
    const node = document.createElement('div');
    node.style.cssText = 'width:400px;height:100px;background:white;font-family:Outfit;font-weight:100;font-size:24px;line-height:40px';
    node.textContent = 'Hi Aé 123'; document.body.append(node);
    const outputs = [];
    for (const { mode, convertPaths, weight } of [
      { mode: 'outline', convertPaths: true, weight: 100 },
      { mode: 'embed-cold', convertPaths: false, weight: 100 },
      { mode: 'embed-warm', convertPaths: false, weight: 100 },
      { mode: 'nondefault-outline', convertPaths: false, weight: 400 },
    ]) {
      await (window as unknown as { subsetPhase(name: string): Promise<void> }).subsetPhase(mode);
      node.style.fontWeight = String(weight);
      const start = performance.now();
      const pdf = await exporter.renderPdf(node, { convertPaths, width: 400, height: 100 });
      const elapsedMs = performance.now() - start;
      const bytes = Array.from(new Uint8Array(await pdf.arrayBuffer()));
      const resources = performance.getEntriesByType('resource').map(entry => entry.name).filter(url => /font-subset|skera/.test(url));
      outputs.push({ mode, elapsedMs, bytes, resources });
    }
    return outputs;
  });
  assert.equal(requests.filter(row => row.phase === 'outline' || row.phase === 'boot').length, 0, 'outline mode must not import the subset runtime');
  assert.equal(requests.filter(row => row.phase === 'nondefault-outline').length, 0, 'nondefault instance stays outlined');
  for (const [index, output] of report.entries()) {
    const path = resolve(directory, `${index}-${output.mode}.pdf`);
    writeFileSync(path, new Uint8Array(output.bytes));
    const extracted = execFileSync('pdftotext', [path, '-'], { encoding: 'utf8' }).trim();
    assert.equal(extracted, output.mode.startsWith('embed') ? 'Hi Aé 123' : '');
  }
  assert.ok(requests.some(row => row.phase === 'embed-cold' && /skera.*wasm/.test(row.url)), 'embedded PDF actually loads the worker WASM');
  assert.equal(errors.length, 0, errors.join('\n'));
  const result = { browser: browser.version(), outputs: report.map(({ bytes, ...rest }) => ({ ...rest, pdfBytes: bytes.length })), requests, errors };
  writeFileSync(resolve(directory, 'report.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
