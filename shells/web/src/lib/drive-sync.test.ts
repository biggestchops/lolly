// SPDX-License-Identifier: MPL-2.0
/**
 * lib/google-drive.ts `driveSyncRemote` (plans/138 B1). drive.file scope → the
 * snapshot is a well-known-named file found via files.list and created/updated in
 * place; `rev` is headRevisionId. Mock-fetch coverage of find-then-create vs
 * find-then-update, head/get, 404→null, canSyncSilently (web session token), plus
 * an end-to-end engine run against a stateful fake Drive.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { driveSyncRemote, seedDriveTokenForTests, resetDriveToken } from './google-drive.ts';
import { pushSnapshot, checkForNewer, pullAndApply, INITIAL_SYNC_STATE } from './sync-engine.ts';
import { runSyncRemoteConformance, OAUTH_LIVE_SKIP } from './sync-remote-conformance.ts';

/** The pushed half of a push result, or a failed assertion. */
function pushed<T extends { status: string }>(result: T): Extract<T, { status: 'pushed' }> {
  assert.equal(result.status, 'pushed');
  return result as Extract<T, { status: 'pushed' }>;
}

interface Call { url: string; method: string }
function mockFetch(handler: (call: Call) => Response): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = { url: String(input), method: init?.method ?? 'GET' };
    calls.push(call);
    return handler(call);
  }) as unknown as typeof fetch;
  return { fetch: fn, calls };
}
const isList = (c: Call) => c.method === 'GET' && c.url.includes('/drive/v3/files?q=');

test('canSyncSilently is false without a session token, true once seeded (web)', async () => {
  resetDriveToken();
  const remote = driveSyncRemote(mockFetch(() => new Response('{}')).fetch);
  assert.equal(await remote.canSyncSilently!(), false);
  seedDriveTokenForTests('tok');
  assert.equal(await remote.canSyncSilently!(), true);
});

test('put CREATES via multipart when no file exists, returning headRevisionId as rev', async () => {
  seedDriveTokenForTests('tok');
  const { fetch, calls } = mockFetch((c) =>
    isList(c) ? new Response(JSON.stringify({ files: [] }))
    : new Response(JSON.stringify({ id: 'f1', headRevisionId: 'h1', size: '3' })));
  const meta = await driveSyncRemote(fetch).put(new Uint8Array([1, 2, 3]));

  assert.ok(isList(calls[0]!), 'looks the file up first');
  assert.match(calls[0]!.url, /name%3D'lolly-sync\.lolly'|name='lolly-sync\.lolly'/);
  assert.equal(calls[1]!.method, 'POST');
  assert.match(calls[1]!.url, /uploadType=multipart/);
  assert.equal(meta.rev, 'h1');
});

test('put UPDATES via media PATCH when the file already exists', async () => {
  seedDriveTokenForTests('tok');
  const { fetch, calls } = mockFetch((c) =>
    isList(c) ? new Response(JSON.stringify({ files: [{ id: 'f9', headRevisionId: 'old' }] }))
    : new Response(JSON.stringify({ id: 'f9', headRevisionId: 'new' })));
  const meta = await driveSyncRemote(fetch).put(new Uint8Array([9]));

  assert.equal(calls[1]!.method, 'PATCH');
  assert.match(calls[1]!.url, /\/files\/f9\?uploadType=media/);
  assert.equal(meta.rev, 'new');
});

test('head: no file → null, file → meta; get downloads media', async () => {
  seedDriveTokenForTests('tok');
  assert.equal(await driveSyncRemote(mockFetch(() => new Response(JSON.stringify({ files: [] }))).fetch).head(), null);

  const body = new Uint8Array([7, 7]);
  const remote = driveSyncRemote(mockFetch((c) =>
    isList(c) ? new Response(JSON.stringify({ files: [{ id: 'f1', headRevisionId: 'h2', size: '2', modifiedTime: '2025-01-01T00:00:00Z' }] }))
    : new Response(body as unknown as BodyInit)).fetch);
  const meta = await remote.head();
  assert.equal(meta!.rev, 'h2');
  const got = await remote.get();
  assert.deepEqual([...got!.bytes], [7, 7]);
  assert.equal(got!.meta.rev, 'h2');
});

// Split a multipart/related create body the way real Drive does: the JSON
// metadata part and the octet-stream content part. Offsets are found in a TRUE
// Latin-1 string (String.fromCharCode is 1:1 for bytes 0-255; TextDecoder('latin1')
// is windows-1252 and mangles 0x80-0x9F), so string offsets are byte offsets and
// the content is sliced from the bytes unchanged. The content ends before the
// closing delimiter, found from the end, so body bytes can never cut it short.
function multipartParts(body: Uint8Array): { metadata: { name?: string }; content: Uint8Array } {
  let s = '';
  for (let i = 0; i < body.length; i += 8192) s += String.fromCharCode(...body.subarray(i, i + 8192));
  const boundary = s.slice(2, s.indexOf('\r\n'));        // leading "--<boundary>"
  const delimiter = `\r\n--${boundary}`;
  const jsonStart = s.indexOf('\r\n\r\n') + 4;
  const jsonEnd = s.indexOf(delimiter, jsonStart);
  const contentStart = s.indexOf('\r\n\r\n', jsonEnd) + 4;
  const contentEnd = s.lastIndexOf(`${delimiter}--`);
  return {
    metadata: JSON.parse(new TextDecoder().decode(body.subarray(jsonStart, jsonEnd))) as { name?: string },
    content: body.slice(contentStart, contentEnd),
  };
}

// Stateful fake Drive. Files are stored by id and found by name, as drive.file
// does: files.list by name, create (multipart), and update (media PATCH) and
// media download by id, so two names are two separate files. Every content write
// gets a new headRevisionId. It keeps no write precondition, because Drive v3 has
// none; the adapter compares a fresh list instead.
function fakeDrive(): typeof fetch {
  const files = new Map<string, { id: string; name: string; rev: number; bytes: Uint8Array; modified: string }>();
  let ids = 0;
  let revs = 0;
  const meta = (f: { id: string; rev: number; bytes: Uint8Array; modified: string }) =>
    ({ id: f.id, headRevisionId: `h${f.rev}`, size: String(f.bytes.length), modifiedTime: f.modified });
  const stamp = (): string => new Date(Date.UTC(2025, 0, 1, 0, 0, revs)).toISOString();
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input)); const method = init?.method ?? 'GET';
    if (method === 'GET' && url.pathname === '/drive/v3/files') {
      const name = /^name='([^']*)'/.exec(url.searchParams.get('q') ?? '')?.[1];
      return new Response(JSON.stringify({ files: [...files.values()].filter((f) => f.name === name).map(meta) }));
    }
    const id = decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf('/') + 1));
    if (method === 'GET' && url.searchParams.get('alt') === 'media') {
      const f = files.get(id);
      return f ? new Response(f.bytes as unknown as BodyInit) : new Response(null, { status: 404 });
    }
    if (method === 'POST' && url.pathname === '/upload/drive/v3/files') {
      const { metadata, content } = multipartParts(new Uint8Array(init!.body as Uint8Array));
      const f = { id: `f${++ids}`, name: metadata.name ?? '', rev: ++revs, bytes: content, modified: stamp() };
      files.set(f.id, f);
      return new Response(JSON.stringify(meta(f)));
    }
    if (method === 'PATCH') {
      const f = files.get(id);
      if (!f) return new Response(null, { status: 404 });
      Object.assign(f, { rev: ++revs, bytes: new Uint8Array(init!.body as Uint8Array), modified: stamp() });
      return new Response(JSON.stringify(meta(f)));
    }
    return new Response(null, { status: 404 });
  }) as unknown as typeof fetch;
}

function makeHost(sessions: Record<string, unknown> = {}) {
  const sess = new Map<string, { data: unknown }>(Object.entries(sessions).map(([k, v]) => [k, { data: v }]));
  const store = new Map<string, string>();
  const host = {
    profile: { async get() { return {}; }, async set() {} },
    state: { async list() { return [...sess.keys()].map((slot) => ({ slot })); }, async load(s: string) { return sess.get(s)?.data ?? null; }, async save(s: string, d: unknown) { sess.set(s, { data: d }); } },
    assets: { async _exportUserAssets() { return []; }, async _importUserAsset() {} },
    log() {},
  };
  return { deps: { host: host as never, storage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } } }, sess };
}

test('end-to-end: engine push→detect→pull through driveSyncRemote against a fake Drive', async () => {
  seedDriveTokenForTests('tok');
  const fetch = fakeDrive();
  const a = makeHost({ 's1': { v: 1 } });
  const b = makeHost();

  const { state: aState } = pushed(await pushSnapshot(a.deps, driveSyncRemote(fetch), { state: INITIAL_SYNC_STATE }));
  assert.equal((await checkForNewer(driveSyncRemote(fetch), INITIAL_SYNC_STATE)).hasNewer, true);
  const { summary } = await pullAndApply(b.deps, driveSyncRemote(fetch));
  assert.equal(summary.sessions, 1);
  assert.deepEqual(b.sess.get('s1')!.data, { v: 1 });

  assert.equal((await checkForNewer(driveSyncRemote(fetch), aState)).hasNewer, false);
  pushed(await pushSnapshot(a.deps, driveSyncRemote(fetch), { state: aState }));   // update → new headRevisionId
  assert.equal((await checkForNewer(driveSyncRemote(fetch), aState)).hasNewer, true, 'a second push bumps the rev');
});

// ── Conditional writes (plans/138 Tier D, WP-S1) ────────────────────────────────

test('put with ifRev compares against a fresh lookup and uploads nothing on a mismatch', async () => {
  seedDriveTokenForTests('tok');
  const { fetch, calls } = mockFetch((c) =>
    isList(c) ? new Response(JSON.stringify({ files: [{ id: 'f9', headRevisionId: 'h2' }] }))
    : new Response(JSON.stringify({ id: 'f9', headRevisionId: 'h3' })));
  const remote = driveSyncRemote(fetch);

  await assert.rejects(() => remote.put(new Uint8Array([1]), { ifRev: 'h1' }), { name: 'SyncConflictError' });
  await assert.rejects(() => remote.put(new Uint8Array([1]), { ifRev: null }), { name: 'SyncConflictError' });
  assert.equal(calls.filter((c) => !isList(c)).length, 0, 'no upload after a failed condition');

  const meta = await remote.put(new Uint8Array([1]), { ifRev: 'h2' });
  assert.equal(meta.rev, 'h3');
});

// ── Conformance (plans/138 Tier D, WP-S6) ───────────────────────────────────────

/** A slot path as sync-service.ts names it for Drive: drive.file has no folders,
 *  so the name is flat. */
const driveName = (path?: string): string | undefined => path?.replace('/', '-');

let conformanceDrive = fakeDrive();
runSyncRemoteConformance('driveSyncRemote conformance (fake Drive)', (path) => driveSyncRemote(conformanceDrive, driveName(path)), {
  preconditions: 'read-compare',
  silent: true,
  setup: () => { seedDriveTokenForTests('tok'); conformanceDrive = fakeDrive(); },
});

runSyncRemoteConformance('driveSyncRemote conformance (live Drive)', (path) => driveSyncRemote(undefined, driveName(path)), {
  preconditions: 'read-compare',
  skip: `live Google Drive run: ${OAUTH_LIVE_SKIP}`,
});
