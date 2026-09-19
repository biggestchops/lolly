// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { extractSavedPage, readPageFiles, PAGE_MAX_BYTES, PAGE_MAX_FILES } from './saved-page.ts';

test('snapshot ordering and line endings are canonical, and content changes alter the hash', async () => {
  const html = { name: 'index.html', text: '<title>Example</title>\r\n<style>h1{color:#e54b34}</style>' };
  const css = { name: 'base.css', text: 'body{background:#ffffff;color:#123456;font-family:Example}' };
  const a = await extractSavedPage([html, css]);
  const b = await extractSavedPage([css, { ...html, text: html.text.replaceAll('\r\n', '\n') }]);
  assert.deepEqual(a, b);
  assert.match(a.sha256, /^[a-f0-9]{64}$/);
  assert.notEqual(a.sha256, (await extractSavedPage([{ ...css, text: css.text + 'h2{color:#555}' }])).sha256);
  assert.equal(a.census.name, 'Example');
});

test('file limits fail before reading any file', async () => {
  let reads = 0;
  const file = (name: string, size = 12) => ({ name, size, text: async () => { reads++; return 'body{color:red}'; } });
  await assert.rejects(readPageFiles([file('a.html', PAGE_MAX_BYTES + 1)]), /size/);
  await assert.rejects(readPageFiles(Array.from({ length: PAGE_MAX_FILES + 1 }, () => file('a.css'))), /count/);
  await assert.rejects(readPageFiles([file('a.html'), file('b.html')]), /pages/);
  await assert.rejects(readPageFiles([file('a.mhtml')]), /format/);
  assert.equal(reads, 0);
  assert.equal((await readPageFiles([file('a.css')])).length, 1);
  await assert.rejects(readPageFiles([{ name: 'a.css', size: 1, text: async () => { throw new Error('unreadable'); } }]), /unreadable/);
});

test('worker boundary rechecks byte limits, formats and empty source', async () => {
  await assert.rejects(extractSavedPage([{ name: 'a.css', text: 'é'.repeat(PAGE_MAX_BYTES / 2 + 1) }]), /size/);
  await assert.rejects(extractSavedPage([{ name: 'a.html', text: ' ' }]), /empty/);
  await assert.rejects(extractSavedPage([{ name: 'a.js', text: 'alert(1)' }]), /format/);
});

test('script content and linked resources cannot contribute invented observations', async () => {
  const { census } = await extractSavedPage([{ name: 'a.html', text: '<script>throw new Error("EXECUTED"); const css="body{color:#dead00}"</script><link rel="stylesheet" href="https://example.invalid/private.css"><img onerror="alert(1)" src="https://example.invalid/logo.png"><style>body{color:#123456}</style>' }]);
  assert.deepEqual(census.colors.map(c => c.hex), ['#123456']);
});
