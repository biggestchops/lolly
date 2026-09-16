// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadTool } from '../engine/src/loader.ts';
import { createRuntime } from '../engine/src/runtime.ts';
import { buildStudioScene } from '../engine/src/studio3d.ts';
import { parseUrlState, serializeUrlState } from '../engine/src/url-mode.ts';
import { baseHost } from './helpers/host.ts';

test('words become a text source with the shared brand type settings', () => {
  const scene = buildStudioScene({
    version: 1,
    values: {
      source: 'text',
      words: '  Hello \r\n  world  \n',
      wordFont: 'display',
      wordWeight: 640,
      wordTracking: 0.05,
      wordLineHeight: 1.3,
      wordAlign: 'right',
    },
  });
  assert.equal(scene.source.kind, 'text');
  assert.deepEqual(scene.source.text, {
    text: 'Hello\nworld',
    font: 'display',
    weight: 600,
    tracking: 0.05,
    lineHeight: 1.3,
    align: 'right',
  });
  const family = buildStudioScene({
    version: 1,
    values: { source: 'text', words: 'Go', wordFont: "Space Grotesk'; url(x)" },
  });
  assert.equal(family.source.text?.font, 'Space Grotesk urlx', 'punctuation is stripped, letters stay');
  assert.equal(buildStudioScene({ version: 1, values: { source: 'text', words: 'Go' } }).source.text?.font, 'sans');
  assert.throws(() => buildStudioScene({ version: 1, values: { source: 'text', words: '   ' } }), /Type the words/);
  assert.equal(
    buildStudioScene({ version: 1, values: { source: 'text', words: 'x'.repeat(300) } }).source.text?.text.length,
    200
  );
});

test('arrangement rows can be words; an empty row waits and the type settings are shared', () => {
  const scene = buildStudioScene({
    version: 1,
    values: {
      source: 'arrangement',
      wordFont: 'mono',
      wordWeight: 500,
      objects: [
        { name: 'Title', kind: 'text', text: 'SUSE', scale: 0.8 },
        { kind: 'text' },
        { kind: 'primitive', primitive: 'sphere' },
      ],
    },
  });
  assert.equal(scene.objects![0]!.source.kind, 'text');
  assert.equal(scene.objects![0]!.source.text?.text, 'SUSE');
  assert.equal(scene.objects![0]!.source.text?.font, 'mono');
  assert.equal(scene.objects![0]!.source.text?.weight, 500);
  assert.equal(scene.objects![0]!.pending, undefined);
  assert.equal(scene.objects![1]!.pending, true, 'no words yet');
  assert.equal(scene.source.kind, 'text', 'the first ready object is mirrored');
});

test('the real tool names a text row after its words and carries words through URL mode', async () => {
  const tool = await loadTool('3d-studio', (p) => readFile(join('community', p), 'utf8'));
  const host = baseHost();
  const runtime = await createRuntime(tool, host, {
    source: 'arrangement',
    objects: [{ kind: 'text', text: 'Open\nSource' }, { kind: 'primitive', primitive: 'box' }],
  });
  const rows = runtime.getModel().find((i) => i.id === 'objects')!.value as Record<string, unknown>[];
  assert.equal(rows[0]!.name, 'Open');
  const single = await createRuntime(tool, host, { source: 'text', words: 'Brand', wordWeight: 800 });
  const parsed = parseUrlState(serializeUrlState(single.getModel()), tool.manifest);
  const reopened = await createRuntime(tool, host, parsed.values);
  const values = Object.fromEntries(reopened.getModel().map((i) => [i.id, i.value]));
  const scene = buildStudioScene({ version: 1, values });
  assert.equal(scene.source.text?.text, 'Brand');
  assert.equal(scene.source.text?.weight, 800);
  runtime.destroy();
  single.destroy();
  reopened.destroy();
});

test('words face the camera by default and take the scene pose on request', () => {
  const front = buildStudioScene({ version: 1, values: { source: 'text', words: 'Go', rotation: { x: -6, y: -16, z: -7 } } });
  assert.deepEqual(front.transform.rotation, [0, 0, 0]);
  const posed = buildStudioScene({ version: 1, values: { source: 'text', words: 'Go', wordPose: 'scene' } });
  assert.deepEqual(posed.transform.rotation, [-6, -16, -7]);
  const badge = buildStudioScene({ version: 1, values: { source: 'primitive' } });
  assert.deepEqual(badge.transform.rotation, [-6, -16, -7], 'objects keep the studio pose');
});
