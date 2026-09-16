// SPDX-License-Identifier: MPL-2.0
/**
 * scripts/pack-project.ts (a project `.lolly` from a JSON spec) and the CLI's Tier-B
 * tool-link restore that lets a deck render the charts it embeds.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { specToProject, type ToolLookup } from '../scripts/pack-project.ts';
import { restoreToolLinks } from '../shells/cli/src/raster.ts';
import { buildLollyFile, readLollyFile, LOLLY_PROJECT_TOOL_ID } from '../shells/web/src/lib/lolly-pack.ts';

const lookup: ToolLookup = (id) => id === 'chart' ? { version: '1.26.0', inputs: ['chartType', 'data', 'heading'] } : null;
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

test('a spec without folders files every session, in order, in one folder named after the project', async () => {
  const { project, warnings } = specToProject({
    name: 'gartner-data',
    sessions: [
      { key: 'q1', toolId: 'chart', label: 'q0001', values: { chartType: 'bar-horizontal', data: 'a,1' }, thumb: 'q1.png' },
      { key: 'q2', toolId: 'chart', values: { chartType: 'bar', __label: 'From values' } },
    ],
  }, lookup, (ref) => ref === 'q1.png' ? PNG : null);
  assert.deepEqual(warnings, []);
  assert.equal(project.folders.length, 1);
  assert.equal(project.folders[0]!.name, 'gartner-data');
  assert.deepEqual(project.folders[0]!.items, [{ type: 'session', ref: 'q1' }, { type: 'session', ref: 'q2' }]);
  assert.equal(project.sessions[0]!.toolVersion, '1.26.0');
  assert.deepEqual(project.sessions[0]!.data, { chartType: 'bar-horizontal', data: 'a,1', __toolId: 'chart', __toolVersion: '1.26.0', __label: 'q0001' });
  assert.equal(project.sessions[1]!.label, 'From values');
  assert.equal(project.sessions[0]!.thumb, PNG);

  const built = await buildLollyFile({ kind: 'project', toolId: LOLLY_PROJECT_TOOL_ID, session: null, project, userAssets: [] });
  const read = await readLollyFile(await built.blob.arrayBuffer());
  assert.equal(read.project!.sessions.length, 2);
});

test('a spec reports tools and inputs the active profile does not declare', () => {
  const { warnings } = specToProject({
    name: 'p',
    sessions: [
      { key: 'a', toolId: 'chart', values: { chartTyp: 'bar', __export_format: 'svg' } },
      { key: 'b', toolId: 'deck-builder', values: {} },
      { key: 'c', toolId: 'chart', values: {}, thumb: 'missing.png' },
    ],
  }, lookup, () => null);
  assert.equal(warnings.length, 3);
  assert.match(warnings[0]!, /no input named "chartTyp"/);
  assert.match(warnings[1]!, /no tool "deck-builder"/);
  assert.match(warnings[2]!, /thumbnail "missing.png"/);
});

test('a spec whose folders do not hold together is refused', () => {
  assert.throws(() => specToProject({
    name: 'p',
    sessions: [{ key: 'a', toolId: 'chart', values: {} }],
    folders: [{ id: 'f', name: 'F', parentId: 'f', items: [] }],
  }, lookup, () => null), /parent/);
});

const LINK = 'https://lolly.tools/tool/chart.svg?ct=bar';

test('the browser tier gets back the tool links this process could not compose', () => {
  const model = [
    { id: 'hero', type: 'asset', value: null },
    { id: 'logo', type: 'asset', value: null },
    { id: 'deck', type: 'blocks', fields: [{ id: 'layout', type: 'select' }, { id: 'media1', type: 'asset' }],
      value: [{ layout: 'title', media1: null }, { layout: 'hero', media1: null }, { layout: 'hero', media1: { id: 'suse/logo', url: 'x' } }] },
  ];
  const initial = {
    hero: { id: LINK },
    logo: { id: 'user/uploads/gone' },
    deck: [{ layout: 'title' }, { layout: 'hero', media1: { id: LINK } }, { layout: 'hero', media1: { id: LINK } }],
  };
  const out = restoreToolLinks(model, initial);
  assert.deepEqual(out[0]!.value, { id: LINK }, 'an empty slot that was a tool link comes back');
  assert.equal(out[1]!.value, null, 'a missing upload stays empty');
  const deck = out[2]!.value as Array<Record<string, unknown>>;
  assert.equal(deck[0]!.media1, null);
  assert.deepEqual(deck[1]!.media1, { id: LINK });
  assert.deepEqual(deck[2]!.media1, { id: 'suse/logo', url: 'x' }, 'a resolved slot is left alone');
});

test('blocks whose count changed are left as the runtime has them', () => {
  const model = [{ id: 'deck', type: 'blocks', fields: [{ id: 'media1', type: 'asset' }], value: [{ media1: null }] }];
  const out = restoreToolLinks(model, { deck: [{ media1: { id: LINK } }, { media1: { id: LINK } }] });
  assert.equal(out[0], model[0]);
});

test('the Node reader names a project file and where it opens instead of asking for an update', async () => {
  const { project } = specToProject({ name: 'p', sessions: [{ key: 'a', toolId: 'chart', values: {} }, { key: 'b', toolId: 'chart', values: {} }] }, lookup, () => null);
  const built = await buildLollyFile({ kind: 'project', toolId: LOLLY_PROJECT_TOOL_ID, session: null, project, userAssets: [] });
  const { readLollyFile: readNode } = await import('@lolly-tools/node-shell/lolly-file');
  const bytes = new Uint8Array(await built.blob.arrayBuffer());
  assert.throws(() => readNode(bytes), /project folder with 2 saved sessions\. Open it in the Lolly app/);
});
