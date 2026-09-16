// SPDX-License-Identifier: MPL-2.0
/**
 * `.lolly` project files: a folder tree and its sessions in one file.
 *
 * Builds a project with two tools' sessions, a nested folder, an upload one session
 * uses and a picture filed in a folder, then reads it back and opens it into an
 * in-memory device with the REAL folder store, so the round trip covers the same
 * code the Projects view and the drop router run. Pure and DOM-free.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { createFolderStore } from '../folders.ts';
import type { BeamAssetRecord, BeamPackHost, BeamSessionRow } from './beam-pack.ts';
import {
  buildLollyFile,
  readLollyFile,
  ingestLollyFile,
  projectShapeProblem,
  LOLLY_PROJECT_MIN_READER,
  LOLLY_PROJECT_TOOL_ID,
  type LollyProjectFolderSink,
  type LollyProjectInput,
} from './lolly-pack.ts';

function device() {
  const userStore = new Map<string, BeamAssetRecord>();
  const slots = new Map<string, { data: unknown; thumb?: string | null }>();
  let profile: Record<string, unknown> = {};
  const host: BeamPackHost = {
    state: {
      list: async (): Promise<BeamSessionRow[]> => [...slots.keys()].map(slot => ({ slot })),
      load: async (slot: string) => slots.get(slot)?.data ?? null,
      save: async (slot: string, data: unknown, thumb?: string | null) => { slots.set(slot, { data, thumb }); },
      delete: async (slot: string) => { slots.delete(slot); },
    },
    assets: {
      _exportUserAssets: async () => [...userStore.values()],
      _uploadUserAsset: async (rec: BeamAssetRecord) => { userStore.set(rec.id, rec); },
      _getUserRecord: async (id: string) => userStore.get(id) ?? null,
      _deleteUserAsset: async (id: string) => { userStore.delete(id); },
    },
  };
  const store = createFolderStore({
    profile: { get: async () => profile, set: async (p) => { profile = p as Record<string, unknown>; } },
    state: { list: async () => [...slots.keys()].map(slot => ({ slot })) },
    assets: { _listUserAssets: async () => [...userStore.values()].map(r => ({ id: r.id })) },
  });
  const sink: LollyProjectFolderSink = {
    instantiateSubtree: (tree, parentId, slotMap, assetMap) => store.instantiateSubtree(tree, parentId, slotMap, assetMap),
    removeSubtree: (id) => store.removeSubtree(id),
  };
  return { host, userStore, slots, store, sink };
}

const PNG = (tag: number) => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, tag, 0, 0]);
const THUMB = `data:image/png;base64,${btoa(String.fromCharCode(...PNG(9)))}`;
const upload = (id: string, tag: number): BeamAssetRecord => ({
  id, type: 'raster', format: 'png', blob: new Blob([PNG(tag)], { type: 'image/png' }), meta: { name: `${id.split('/').pop()}.png` },
});

function sampleProject(): LollyProjectInput {
  return {
    name: 'gartner-data',
    folders: [
      { id: 'root', name: 'gartner-data', parentId: null, items: [
        { type: 'session', ref: 'chart-1' },
        { type: 'session', ref: 'deck' },
        { type: 'image', ref: 'user/uploads/cover' },
      ], color: '#30ba78' },
      { id: 'appendix', name: 'Appendix', parentId: 'root', items: [{ type: 'session', ref: 'chart-2' }] },
    ],
    sessions: [
      { key: 'chart-1', toolId: 'chart', toolVersion: '1.25.0', label: 'q0001 Using AI', thumb: THUMB,
        data: { __toolId: 'chart', __label: 'q0001 Using AI', chartType: 'bar-horizontal', data: 'Response,Share\nYes,100\nNo,0' } },
      { key: 'chart-2', toolId: 'chart', label: 'q0002 Who you are',
        data: { __toolId: 'chart', chartType: 'bar-horizontal', logo: { id: 'user/uploads/logo', source: 'user' } } },
      { key: 'deck', toolId: 'deck-builder', label: 'Deck',
        data: { __toolId: 'deck-builder', deck: [{ layout: 'hero', media1: { id: 'https://lolly.tools/tool/chart.svg?ct=bar' } }] } },
    ],
  };
}

async function buildSample() {
  return buildLollyFile({
    kind: 'project', toolId: LOLLY_PROJECT_TOOL_ID, session: null, name: 'gartner-data',
    project: sampleProject(),
    userAssets: [upload('user/uploads/logo', 1), upload('user/uploads/cover', 2), upload('user/uploads/unused', 3)],
  });
}

test('a project file carries each session as its own part, the tree, and only the assets in use', async () => {
  const built = await buildSample();
  assert.equal(built.filename, 'gartner-data.lolly');
  assert.equal(built.manifest.kind, 'project');
  assert.equal(built.manifest.minReader, LOLLY_PROJECT_MIN_READER);
  assert.equal(built.manifest.tool.id, LOLLY_PROJECT_TOOL_ID);
  assert.equal(built.manifest.thumb, THUMB, 'the first tile doubles as the file thumbnail');
  const parts = Object.keys(unzipSync(new Uint8Array(await built.blob.arrayBuffer())));
  assert.ok(parts.includes('sessions/chart-1.json') && parts.includes('sessions/deck.json'));
  assert.ok(parts.includes('thumbs/chart-1.png'));
  assert.ok(!parts.includes('session.json'), 'a project has no single session part');
  // The logo (used by a session) and the cover (filed in a folder) travel; the unused upload does not.
  assert.deepEqual(built.manifest.assets.map(a => a.id).sort(), ['user/uploads/cover', 'user/uploads/logo']);
  for (const path of ['sessions/chart-1.json', 'sessions/chart-2.json', 'sessions/deck.json', 'thumbs/chart-1.png']) {
    assert.ok(built.manifest.integrity?.[path], `${path} is integrity-covered`);
  }

  const read = await readLollyFile(await built.blob.arrayBuffer());
  assert.equal(read.session, null);
  assert.equal(read.project?.name, 'gartner-data');
  assert.deepEqual(read.project?.sessions.map(s => s.key), ['chart-1', 'chart-2', 'deck']);
  assert.equal(read.project!.sessions[0]!.thumbUrl, THUMB);
  assert.equal(read.project!.sessions[1]!.thumbUrl, null);
  assert.equal(read.project!.sessions[0]!.data.data, 'Response,Share\nYes,100\nNo,0');
  assert.equal(read.project!.folders[1]!.parentId, 'root');
});

test('opening a project recreates its folders over new slots and re-keyed pictures', async () => {
  const built = await buildSample();
  const target = device();
  const existing = await target.store.create('Already here');
  const res = await ingestLollyFile(await built.blob.arrayBuffer(), target.host, { folders: target.sink });
  assert.equal(res.project?.slots.length, 3);
  assert.equal(res.project?.folderIds.length, 1);
  assert.equal(res.imported, 2);

  const folders = await target.store.list();
  assert.equal(folders.length, 3);
  const root = folders.find(f => f.id === res.project!.folderIds[0])!;
  assert.notEqual(root.id, 'root', 'ids are minted on this device');
  assert.equal(root.name, 'gartner-data');
  assert.equal(root.parentId, null);
  assert.equal(root.color, '#30ba78');
  const appendix = folders.find(f => f.parentId === root.id)!;
  assert.equal(appendix.name, 'Appendix');
  assert.ok(folders.some(f => f.id === existing.id), 'existing work is untouched');

  const [chartSlot, deckSlot] = root.items.filter(i => i.type === 'session').map(i => i.ref);
  assert.match(chartSlot!, /^chart:\d+/);
  assert.match(deckSlot!, /^deck-builder:\d+/);
  const chart = target.slots.get(chartSlot!)!;
  assert.equal(chart.thumb, THUMB);
  assert.equal((chart.data as Record<string, unknown>).__toolId, 'chart');
  const cover = root.items.find(i => i.type === 'image')!;
  assert.notEqual(cover.ref, 'user/uploads/cover', 'the filed picture points at its imported copy');
  assert.ok(target.userStore.has(cover.ref));

  const appendixSlot = appendix.items[0]!.ref;
  const logo = (target.slots.get(appendixSlot)!.data as { logo: { id: string; source: string } }).logo;
  assert.equal(logo.source, 'user');
  assert.ok(target.userStore.has(logo.id), 'the session ref follows its re-keyed upload');
  const deck = target.slots.get(deckSlot!)!.data as { deck: Array<{ media1: { id: string } }> };
  assert.equal(deck.deck[0]!.media1.id, 'https://lolly.tools/tool/chart.svg?ct=bar', 'a tool link travels as itself');
});

test('opening a project twice gives two independent copies', async () => {
  const built = await buildSample();
  const target = device();
  const bytes = await built.blob.arrayBuffer();
  const a = await ingestLollyFile(bytes, target.host, { folders: target.sink });
  const b = await ingestLollyFile(bytes, target.host, { folders: target.sink });
  assert.equal(new Set([...a.project!.slots, ...b.project!.slots]).size, 6);
  assert.notEqual(a.project!.folderIds[0], b.project!.folderIds[0]);
  assert.equal(b.imported, 0, 'the second copy reuses the pictures already here');
});

test('a failed folder step leaves no sessions, folders or pictures behind', async () => {
  const built = await buildSample();
  const target = device();
  const failing: LollyProjectFolderSink = {
    instantiateSubtree: async () => { throw new Error('profile store is full'); },
    removeSubtree: target.sink.removeSubtree,
  };
  await assert.rejects(ingestLollyFile(await built.blob.arrayBuffer(), target.host, { folders: failing }), /profile store is full/);
  assert.equal(target.slots.size, 0);
  assert.equal(target.userStore.size, 0);
  assert.equal((await target.store.list()).length, 0);
});

test('without a folder store the sessions still land, unfiled', async () => {
  const built = await buildSample();
  const target = device();
  const res = await ingestLollyFile(await built.blob.arrayBuffer(), target.host);
  assert.equal(res.project?.slots.length, 3);
  assert.deepEqual(res.project?.folderIds, []);
});

/** Rewrite a built file's manifest (and only it), keeping every part's bytes. */
async function withManifest(blob: Blob, edit: (m: Record<string, any>) => void): Promise<Uint8Array> {
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const manifest = JSON.parse(strFromU8(files['manifest.json']!));
  edit(manifest);
  files['manifest.json'] = strToU8(JSON.stringify(manifest));
  return zipSync(files);
}

test('the reader refuses a project whose tree does not hold together', async () => {
  const built = await buildSample();
  const cases: Array<[string, (m: Record<string, any>) => void, RegExp]> = [
    ['a folder inside itself', m => { m.project.folders[0].parentId = 'appendix'; }, /inside itself/],
    ['a session filed twice', m => { m.project.folders[1].items.push({ type: 'session', ref: 'chart-1' }); }, /filed twice/],
    ['a parent from elsewhere', m => { m.project.folders[1].parentId = 'nowhere'; }, /parent that is not in this project/],
    ['a repeated key', m => { m.project.sessions[1].key = 'chart-1'; m.project.sessions[1].path = 'sessions/chart-1.json'; }, /repeated key/],
    ['a part the manifest does not cover', m => { m.project.sessions[0].path = 'session.json'; }, /missing the session/],
    ['an old reader gate', m => { m.minReader = 1; }, /invalid payload/],
  ];
  for (const [label, edit, expected] of cases) {
    await assert.rejects(readLollyFile(await withManifest(built.blob, edit)), expected, label);
  }
});

test('the reader keeps only a plain hex folder colour and short tags', async () => {
  const built = await buildSample();
  const bytes = await withManifest(built.blob, m => {
    m.project.folders[0].color = 'red;background:url(https://example.com/x)';
    m.project.folders[1].tags = ['ok', 'x'.repeat(200), 42];
  });
  const read = await readLollyFile(bytes);
  assert.equal(read.project!.folders[0]!.color, undefined);
  assert.deepEqual(read.project!.folders[1]!.tags, ['ok']);
});

test('projectShapeProblem accepts a flat list of sessions and rejects an empty project', () => {
  assert.equal(projectShapeProblem('loose', [], [{ key: 'a', toolId: 'chart' }]), null);
  assert.match(projectShapeProblem('empty', [], [])!, /empty/);
  assert.match(projectShapeProblem('', [], [{ key: 'a', toolId: 'chart' }])!, /no name/);
  assert.match(projectShapeProblem('bad', [], [{ key: '../x', toolId: 'chart' }])!, /key/);
});

test('the builder refuses a project it could not read back', async () => {
  const project = sampleProject();
  project.folders[1]!.parentId = 'appendix';
  await assert.rejects(buildLollyFile({ kind: 'project', toolId: LOLLY_PROJECT_TOOL_ID, session: null, project, userAssets: [] }), /parent/);
});
