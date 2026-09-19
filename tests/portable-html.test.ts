// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTool } from '../engine/src/loader.ts';
import { createRuntime } from '../engine/src/runtime.ts';
import { portableHtml } from '../engine/src/portable-html.ts';
import type { ExportOpts } from '@lolly-tools/core/host-v1';
import { baseHost } from './helpers/host.ts';

const manifest = { id: 'portable-test', name: 'Portable test', version: '1.0.0', engineVersion: '^1.0.0', status: 'community', inputs: [], render: { width: 800, height: 600, formats: ['html'], portable: true } };
const files: Record<string, string> = {
  'portable-test/tool.json': JSON.stringify(manifest),
  'portable-test/template.html': '<main>Readable without scripts</main>',
  'portable-test/presentation.js': 'document.body.dataset.ready = "yes";',
};
const fetchFile = async (path: string) => { if (!(path in files)) throw new Error('Missing ' + path); return files[path]!; };

test('a portable tool loads its declared runtime and passes it through normal export', async () => {
  const tool = await loadTool('portable-test', fetchFile);
  const host = baseHost({ export: {} });
  host.export.render = async (_node: unknown, _format: string, opts?: ExportOpts) => new Blob([portableHtml(opts!.portableDocument!)]);
  const runtime = await createRuntime(tool, host);
  assert.match(runtime.getHydrated(), /data-tool-presentation/);
  const html = await (await runtime.export({} as Element, 'html')).text();
  assert.match(html, /<!doctype html>/);
  assert.match(html, /Readable without scripts/);
  assert.match(html, /dataset.ready/);
});
test('missing declared runtime fails rather than exporting an inert page', async () => {
  await assert.rejects(loadTool('portable-test', async p => { if (p.endsWith('presentation.js')) throw new Error('Missing presentation'); return fetchFile(p); }), /Missing presentation/);
});
test('portable output retains JSON data but removes undeclared executable scripts', () => {
  const html = portableHtml({ markup: '<script src="evil.js"></script><script>bad()</script><script type="application/json">{"ok":true}</script><p>Full text</p>', script: 'trusted()', styles: '', title: '<Title>', lang: 'en' });
  assert.doesNotMatch(html, /evil.js|bad\(\)/);
  assert.match(html, /application\/json/);
  assert.match(html, /trusted\(\)/);
  assert.match(html, /&lt;Title>/);
});
test('untrusted tools cannot turn their runtime into a standalone executable export', async () => {
  const tool = await loadTool('portable-test', fetchFile, { trustClass: 'remote-untrusted' });
  const runtime = await createRuntime(tool, baseHost());
  await assert.rejects(runtime.export({} as Element, 'html'), /trusted installed tool/);
});
