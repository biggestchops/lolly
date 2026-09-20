// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';
import type { Browser } from 'playwright-core';
import type { TextLayoutRequestV1 } from '@lolly-tools/core';
import { getBrowser, closeBrowser, browserInstalled } from '../packages/node-shell/src/browsers.ts';
import { createTextStory } from '../engine/src/text-story-document.ts';
import { composeText } from '../engine/src/text-layout.ts';
import { createPinnedTextShaper } from '../packages/node-shell/src/text-fonts.ts';
import type { TextProof } from './helpers/text-native-harness.ts';
const selected = process.env.LOLLY_TEXT_BROWSER ?? 'chromium';
const family = '👨‍👩‍👧‍👦';
const paths = { latin: 'shells/web/public/fonts/SUSE[wght].ttf', cjk: 'tests/fixtures/text-composition/fonts/notosanssc/NotoSansSC-test.ttf',
  arabic: 'tests/fixtures/text-composition/fonts/notosansarabic/NotoSansArabic[wdth,wght].ttf',
  hebrew: 'tests/fixtures/text-composition/fonts/notosanshebrew/NotoSansHebrew[wdth,wght].ttf',
  indic: 'tests/fixtures/text-composition/fonts/notosansdevanagari/NotoSansDevanagari[wdth,wght].ttf' };
function fixture(): TextLayoutRequestV1 {
  const story = createTextStory('story', `Office e\u0301 العربية 123 עִבְרִית क्षेत्र ${family}!\nLine two 日本`, index => `p${index}`);
  story.frameIds = ['frame']; story.defaultStyle = 'body';
  story.spans = [{ start: 0, end: 6, character: { weight: 700, color: '#a03040' } }];
  const at = story.source.indexOf(family);
  return {
    storyId: story.id,
    document: { version: 1, stories: [story], styles: [{ id: 'body', name: 'Body', kind: 'paragraph', paragraph: { character: { font: 'latin', fallbackFonts: ['arabic', 'hebrew', 'indic', 'cjk'], size: 32, weight: 400 } } }],
      fonts: Object.entries(paths).map(([id, path]) => ({ id, family: id, faceIndex: 0, sha256: createHash('sha256').update(readFileSync(path)).digest('hex'), source: { kind: 'bundled', path: `/fonts/${id}.ttf` } })) },
    frames: [{ id: 'frame', storyId: story.id, width: 420, height: 300, mode: 'auto-height', inset: { top: 10, right: 10, bottom: 10, left: 10 }, columns: { count: 1, gutter: 0, balance: false }, verticalAlign: 'top' }],
    artwork: [{ start: at, end: at + family.length, id: 'fixture-family', sha256: 'a'.repeat(64), width: 32, ascent: 28, descent: 4, svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0H1V1H0Z"/></svg>' }],
  };
}
test('composed native input preserves source, IME, accessibility and transformed caret geometry', {
  skip: selected === 'chromium' && !browserInstalled() ? 'No browser installed; set LOLLY_BROWSER_CHANNEL=chrome.' : false,
  timeout: 90000,
}, async context => {
  const bundle = await build({ entryPoints: ['tests/helpers/text-native-harness.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', external: ['module'], logLevel: 'silent' });
  const require = createRequire(new URL('../packages/node-shell/package.json', import.meta.url));
  const wasm = readFileSync(join(dirname(require.resolve('harfbuzzjs')), 'harfbuzz.wasm'));
  const server = createServer((req, res) => {
    const font = Object.entries(paths).find(([id]) => req.url === `/fonts/${id}.ttf`);
    if (font) { res.setHeader('content-type', 'font/ttf'); res.end(readFileSync(font[1])); return; }
    if (req.url === '/harness.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle.outputFiles[0]!.text); return; }
    if (req.url === '/harfbuzz.wasm') { res.setHeader('content-type', 'application/wasm'); res.end(wasm); return; }
    if (req.url !== '/') { res.writeHead(404); res.end(); return; }
    res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html lang="en"><head><title>Text input proof</title></head><body></body></html>');
  });
  let browser: Browser | undefined;
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    if (selected === 'chromium') browser = await getBrowser();
    else {
      const { webkit, firefox } = await import('playwright');
      if (selected !== 'webkit' && selected !== 'firefox') throw new Error(`Unknown text test browser: ${selected}`);
      browser = await ({ webkit, firefox })[selected].launch();
    }
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } }), errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) context.diagnostic(`${response.status()} ${response.url()}`); });
    await page.goto(`http://127.0.0.1:${port}/`);
    const request = fixture();
    const nodeLayout = await composeText(request, createPinnedTextShaper(async font => readFileSync(paths[font.id as keyof typeof paths])));
    await page.evaluate(async request => {
      const modulePath = '/harness.js';
      const { startTextProof } = await import(/* @vite-ignore */ modulePath);
      window.textProof = await startTextProof(request) as TextProof;
    }, request);
    assert.deepEqual(await page.evaluate(() => window.textProof.layout()), nodeLayout);
    const lineCarets = await page.evaluate(() => {
      const proof = window.textProof, layout = proof.layout();
      return layout.lines.map((line, index) => {
        const caret = line.carets[0]!; proof.surface.select(caret.offset, caret.offset, { ...caret, line: index });
        const selected = document.getSelection()!, holder = selected.focusNode!.parentElement!.closest<HTMLElement>('[data-text-start]')!;
        return { expected: caret.y, actual: Number(holder.dataset.textY), collapsed: selected.isCollapsed };
      });
    });
    assert.ok(lineCarets.every(caret => caret.actual === caret.expected && caret.collapsed), 'wrap and bidi affinity place a collapsed native caret on the chosen line');
    for (const [scale, angle] of [[1, 0], [2, 0], [1.5, 23]]) {
      const geometry = await page.evaluate(({ scale, angle }) => {
        document.querySelector<HTMLElement>('#stage')!.style.transform = `scale(${scale}) rotate(${angle}deg)`;
        const ink = document.querySelector<HTMLElement>('[data-text-ink]')!, node = ink.firstChild!;
        const range = document.createRange();
        const point = (offset: number) => { range.setStart(node, offset); range.collapse(true); const r = range.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; };
        return { a: point(0), b: point(node.textContent!.length), advance: Number(ink.parentElement!.dataset.textAdvance) };
      }, { scale: scale!, angle: angle! });
      const radians = angle! * Math.PI / 180;
      assert.ok(Math.abs(geometry.b[0]! - geometry.a[0]! - geometry.advance * scale! * Math.cos(radians)) < 1, `${selected}: transformed caret x`);
      assert.ok(Math.abs(geometry.b[1]! - geometry.a[1]! - geometry.advance * scale! * Math.sin(radians)) < 1, `${selected}: transformed caret y`);
    }
    await page.evaluate(() => { document.querySelector<HTMLElement>('#stage')!.style.transform = ''; });
    await page.locator('#editor [data-text-ink]').first().dblclick();
    assert.equal(await page.evaluate(() => document.getSelection()!.toString()), 'Office', `${selected}: native double-click word selection`);
    const state = () => page.evaluate(() => window.textProof.state());
    const settle = () => page.waitForFunction(() => { const state = window.textProof.state(); return state.errors.length || state.painted === state.revision; });
    await page.evaluate(() => window.textProof.select(0, 6)); await page.keyboard.insertText('Heading'); await settle();
    assert.equal((await state()).source, request.document.stories[0]!.source.replace('Office', 'Heading'));
    await page.evaluate(family => { const proof = window.textProof; proof.select(proof.state().source.indexOf(family) + family.length); }, family);
    await page.keyboard.press('Backspace'); await settle(); assert.ok(!(await state()).source.includes('👨'));
    await page.keyboard.press('Control+z'); await settle(); assert.ok((await state()).source.includes(family));
    await page.keyboard.press('Control+Shift+z'); await settle(); assert.ok(!(await state()).source.includes(family));
    await page.evaluate(() => window.textProof.select(0)); await page.keyboard.press('Shift+Enter'); await settle();
    await page.keyboard.press('Enter'); await settle(); assert.ok((await state()).source.startsWith('\u2028\n'));
    await page.evaluate(() => { const proof = window.textProof; proof.select(proof.state().source.length); });
    if (selected === 'chromium') {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.imeSetComposition', { text: 'にほ', selectionStart: 2, selectionEnd: 2 });
      assert.ok(await page.evaluate(async () => { const proof = window.textProof, node = document.getSelection()!.focusNode; await proof.draw(); return node === document.getSelection()!.focusNode && proof.surface.composing; }));
      await cdp.send('Input.insertText', { text: '日本' }); await settle(); assert.ok((await state()).source.endsWith('日本日本'));
      const ax = await cdp.send('Accessibility.getFullAXTree');
      const box = ax.nodes.find(node => node.role?.value === 'textbox' && node.name?.value === 'Authored text');
      assert.ok(box?.value?.value.includes('Heading')); await cdp.detach();
      context.diagnostic('Native Chromium Japanese composition and accessible textbox value verified.');
    } else {
      assert.ok(await page.evaluate(async () => {
        const proof = window.textProof, node = document.getSelection()!.focusNode;
        proof.editor.dispatchEvent(new CompositionEvent('compositionstart', { data: '' })); await proof.draw();
        const stable = node === document.getSelection()!.focusNode;
        proof.editor.dispatchEvent(new CompositionEvent('compositionend', { data: '' })); return stable;
      }));
      context.diagnostic(`${selected}: synthetic composition lifecycle only; no physical IME claim.`);
    }
    await settle(); assert.deepEqual((await state()).errors, []); assert.deepEqual(errors, []);
    await page.evaluate(() => { const proof = window.textProof; proof.select(proof.state().source.length); });
    await page.keyboard.press('Enter'); await settle();
    const blank = await page.evaluate(() => {
      const proof = window.textProof, line = proof.layout().lines.at(-1)!, stop = line.carets[0]!;
      proof.surface.select(stop.offset, stop.offset, { ...stop, line: proof.layout().lines.length - 1 });
      const selection = document.getSelection()!, holder = selection.focusNode!.parentElement!.closest<HTMLElement>('[data-text-start]')!;
      const range = selection.getRangeAt(0), rect = range.getBoundingClientRect();
      return { start: line.start, end: line.end, length: proof.state().source.length, y: Number(holder.dataset.textY), expected: line.y, height: rect.height, holder: holder.getBoundingClientRect().toJSON(), br: holder.querySelector('br')?.getBoundingClientRect().toJSON() };
    });
    await page.screenshot({ path: '/tmp/lolly-271-empty-caret.png', caret: 'initial' });
    assert.equal(blank.start, blank.length); assert.equal(blank.end, blank.length); assert.equal(blank.y, blank.expected);
    assert.ok(blank.br.height > 0, `${selected}: empty paragraph retains its native editable BR`);
    assert.ok(Math.abs(blank.holder.y - 40 - blank.expected) < 1, `${selected}: empty paragraph follows its composed line`);
    // Native BR rectangles include the platform font's leading inside the line box.
    const caretMiddle = blank.br.y + blank.br.height / 2;
    assert.ok(caretMiddle >= blank.holder.y && caretMiddle <= blank.holder.y + blank.holder.height,
      `${selected}: empty caret belongs to its composed line: ${JSON.stringify(blank)}`);
    await page.keyboard.insertText('End'); await settle(); assert.ok((await state()).source.endsWith('\nEnd'));
    await page.evaluate(() => { const proof = window.textProof; proof.select(0, proof.state().source.length); });
    await page.keyboard.press('Backspace'); await settle(); assert.equal((await state()).source, '');
    await page.keyboard.insertText('First'); await settle(); assert.equal((await state()).source, 'First');
    await page.close();
  } finally {
    if (selected === 'chromium') await closeBrowser(); else await browser?.close();
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
