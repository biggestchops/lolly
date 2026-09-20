// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { createTextStory } from '../engine/src/text-story-document.ts';
import { defaultTextFrameSettings } from '../engine/src/text-design.ts';
import { runToolCli } from '../shells/cli/src/run.ts';
import { createCliBridge } from '../shells/cli/src/bridge.ts';
import { mountTool, exportToFile, currentQuery } from '../shells/tui/src/engine-render.ts';
import { callTool } from '../services/mcp/src/tools.ts';
import { closeBrowser } from '../packages/node-shell/src/browsers.ts';
import { closeWebShell, closeBrowser as closeMcpBrowser } from '../services/mcp/src/render.ts';

const origin = process.env.LOLLY_EXPORT_TEST_URL;
if (origin) { process.env.LOLLY_WEB_BASE = origin; }
test('CLI, TUI and MCP retain the same authored story and composed glyph geometry', { skip: origin ? false : 'set LOLLY_EXPORT_TEST_URL', timeout: 120000 }, async () => {
  const story = createTextStory('story', 'Office e\u0301\u00a0literal **copy**\r\nSecond line\n', i => `p${i}`);
  story.frameIds = ['text']; story.defaultStyle = 'body';
  const bytes = await readFile('shells/web/public/fonts/SUSE[wght].ttf');
  const document = { version: 1, stories: [story], styles: [{ id: 'body', kind: 'paragraph', name: 'Body', paragraph: { character: { font: 'font', size: 24, color: '#225577' } } }], fonts: [{ id: 'font', family: 'SUSE', faceIndex: 0, sha256: createHash('sha256').update(bytes).digest('hex'), source: { kind: 'bundled', path: '/fonts/SUSE[wght].ttf' } }] };
  const boxes = [{ id: 'text', kind: 'text', text: '', textStory: 'story', textFrame: JSON.stringify(defaultTextFrameSettings('fixed')), x: 40, y: 40, w: 500, h: 250 }];
  const values = { textDocument: JSON.stringify(document), boxes };
  const params = { ...values, boxes: JSON.stringify(boxes), c2pa: '0', imprint: '0', width: '640', height: '360', 'no-provenance': '1' };
  const dir = await mkdtemp(join(tmpdir(), 'lolly-text-shells-')), dom = new JSDOM('<main id="canvas"></main>');
  let runtime: Awaited<ReturnType<typeof mountTool>>['runtime'] | undefined;
  const geometry = (html: string) => {
    const parsed = new JSDOM(html), node = parsed.window.document.querySelector('[data-composed-text="story"]');
    assert.ok(node); assert.ok(node.querySelectorAll('path[data-text-start]').length > 20);
    const result = JSON.stringify([...node.querySelectorAll('path')].map(path => [path.getAttribute('d'), path.getAttribute('transform'), path.parentElement?.getAttribute('transform')])); parsed.window.close(); return result;
  };
  try {
    await runToolCli({ toolId: 'design', params, format: 'svg', outputPath: join(dir, 'cli.svg') });
    const host = await createCliBridge({ dom, aiEnabled: false });
    const mounted = await mountTool('design', host, new URLSearchParams(params).toString()); runtime = mounted.runtime;
    assert.deepEqual(runtime.hookErrors, []);
    await exportToFile(runtime, dom, mounted.manifest, 'svg', join(dir, 'tui.svg'));

    const reopened = await mountTool('design', host, currentQuery(runtime));
    try { assert.equal(reopened.runtime.getModel().find(input => input.id === 'textDocument')!.value, values.textDocument); } finally { reopened.runtime.destroy(); }
    const mcp = await callTool('lolly_render', { toolId: 'design', inputs: values, format: 'svg', width: 640, height: 360, c2pa: false, imprint: false, link: false });
    assert.ok(!mcp.isError, JSON.stringify(mcp));
    const resource = mcp.content.find(item => item.type === 'resource');
    assert.ok(resource?.type === 'resource' && 'text' in resource.resource);
    const [cli, tui] = await Promise.all([readFile(join(dir, 'cli.svg'), 'utf8'), readFile(join(dir, 'tui.svg'), 'utf8')]);
    assert.equal(geometry(cli), geometry(tui)); assert.equal(geometry(cli), geometry(resource.resource.text!));
  } finally { runtime?.destroy(); dom.window.close(); await rm(dir, { recursive: true, force: true }); await closeWebShell(); await closeBrowser(); await closeMcpBrowser(); }
});
