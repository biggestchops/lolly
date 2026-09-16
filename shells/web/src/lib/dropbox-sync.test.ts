// SPDX-License-Identifier: MPL-2.0
/**
 * lib/dropbox-send.ts `dropboxSyncRemote` (plans/138 B1). One fixed app-folder
 * path, mode:overwrite uploads, `rev` = Dropbox's own file rev, 409→null.
 * Mock-fetch coverage of request shape, head/get/put, and an end-to-end engine
 * run against a stateful fake Dropbox.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dropboxSyncRemote } from './dropbox-send.ts';
import { cacheToken, resetConnectionsForTests } from './provider-connections.ts';
import { pushSnapshot, checkForNewer, pullAndApply, INITIAL_SYNC_STATE } from './sync-engine.ts';
import { runSyncRemoteConformance, OAUTH_LIVE_SKIP } from './sync-remote-conformance.ts';

/** The pushed half of a push result, or a failed assertion. */
function pushed<T extends { status: string }>(result: T): Extract<T, { status: 'pushed' }> {
  assert.equal(result.status, 'pushed');
  return result as Extract<T, { status: 'pushed' }>;
}

function withToken(): void {
  resetConnectionsForTests();
  cacheToken('dropbox', 'tok', Date.now() + 3_600_000);
}

interface Call { url: string; method: string; arg?: string }
function mockFetch(handler: (call: Call) => Response): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const h = (init?.headers ?? {}) as Record<string, string>;
    const call: Call = { url: String(input), method: init?.method ?? 'GET', arg: h['Dropbox-API-Arg'] };
    calls.push(call);
    return handler(call);
  }) as unknown as typeof fetch;
  return { fetch: fn, calls };
}

test('canSyncSilently is true with a cached token', async () => {
  withToken();
  assert.equal(await dropboxSyncRemote(mockFetch(() => new Response('{}')).fetch).canSyncSilently!(), true);
});

test('head: get_metadata 409 → null, 200 → meta', async () => {
  withToken();
  assert.equal(await dropboxSyncRemote(mockFetch(() => new Response(null, { status: 409 })).fetch).head(), null);
  const meta = await dropboxSyncRemote(mockFetch(() =>
    new Response(JSON.stringify({ rev: 'a1', size: 512, server_modified: '2025-01-01T00:00:00Z' }), { status: 200 })).fetch).head();
  assert.deepEqual(meta, { rev: 'a1', updatedAt: '2025-01-01T00:00:00Z', size: 512 });
});

test('put uploads to the fixed path with mode:overwrite and returns the rev', async () => {
  withToken();
  const { fetch, calls } = mockFetch(() => new Response(JSON.stringify({ rev: 'a2', size: 3 })));
  const meta = await dropboxSyncRemote(fetch).put(new Uint8Array([1, 2, 3]));
  assert.match(calls[0]!.url, /content\.dropboxapi\.com\/2\/files\/upload$/);
  const arg = JSON.parse(calls[0]!.arg!);
  assert.equal(arg.path, '/lolly-sync/snapshot.lolly');
  assert.equal(arg.mode, 'overwrite');
  assert.equal(meta.rev, 'a2');
});

test('get downloads bytes + meta from the Dropbox-API-Result header; 409 → null', async () => {
  withToken();
  assert.equal(await dropboxSyncRemote(mockFetch(() => new Response(null, { status: 409 })).fetch).get(), null);
  const body = new Uint8Array([4, 5]);
  const got = await dropboxSyncRemote(mockFetch(() =>
    new Response(body as unknown as BodyInit, { status: 200, headers: { 'dropbox-api-result': JSON.stringify({ rev: 'a3', size: 2 }) } })).fetch).get();
  assert.deepEqual([...got!.bytes], [4, 5]);
  assert.equal(got!.meta.rev, 'a3');
});

// Stateful fake Dropbox, keyed by the full path: get_metadata (path in the JSON
// body), download and upload (path in the Dropbox-API-Arg header). A missing path
// answers 409 path/not_found. Upload keeps Dropbox's write modes, checked and
// written in one step: `add` refuses a path that exists and `update` refuses a
// different rev, both as 409 path/conflict (with autorename off, as the adapter
// sends it). With strict_conflict (the adapter sends it on every conditional
// write), `update` on a missing path conflicts too; without it, it writes.
function fakeDropbox(): typeof fetch {
  const files = new Map<string, { bytes: Uint8Array; rev: number; modified: string }>();
  let revs = 0;
  const meta = (f: { bytes: Uint8Array; rev: number; modified: string }): string =>
    JSON.stringify({ rev: `r${f.rev}`, size: f.bytes.length, server_modified: f.modified });
  const failure = (summary: string): Response =>
    new Response(JSON.stringify({ error_summary: summary }), { status: 409, headers: { 'content-type': 'application/json' } });
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const apiArg = new Headers(init?.headers as HeadersInit).get('dropbox-api-arg');
    if (url.endsWith('/files/get_metadata')) {
      const f = files.get((JSON.parse(String(init!.body)) as { path: string }).path);
      return f ? new Response(meta(f)) : failure('path/not_found/..');
    }
    if (url.endsWith('/files/upload')) {
      const arg = JSON.parse(apiArg!) as { path: string; mode?: string | { '.tag': string; update?: string }; strict_conflict?: boolean };
      const current = files.get(arg.path);
      if (arg.mode === 'add' && current) return failure('path/conflict/file/..');
      if (typeof arg.mode === 'object' && arg.mode['.tag'] === 'update'
        && (current ? `r${current.rev}` !== arg.mode.update : arg.strict_conflict === true)) {
        return failure('path/conflict/file/..');
      }
      revs++;
      const f = {
        bytes: new Uint8Array(init!.body as Uint8Array),
        rev: revs,
        modified: new Date(Date.UTC(2025, 0, 1, 0, 0, revs)).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      };
      files.set(arg.path, f);
      return new Response(meta(f));
    }
    if (url.endsWith('/files/download')) {
      const f = files.get((JSON.parse(apiArg!) as { path: string }).path);
      if (!f) return failure('path/not_found/..');
      return new Response(f.bytes as unknown as BodyInit, { status: 200, headers: { 'dropbox-api-result': meta(f) } });
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

test('end-to-end: engine push→detect→pull through dropboxSyncRemote against a fake Dropbox', async () => {
  withToken();
  const fetch = fakeDropbox();
  const a = makeHost({ 's1': { v: 1 } });
  const b = makeHost();

  const { state: aState } = pushed(await pushSnapshot(a.deps, dropboxSyncRemote(fetch), { state: INITIAL_SYNC_STATE }));
  assert.equal((await checkForNewer(dropboxSyncRemote(fetch), INITIAL_SYNC_STATE)).hasNewer, true);
  const { summary } = await pullAndApply(b.deps, dropboxSyncRemote(fetch));
  assert.equal(summary.sessions, 1);
  assert.deepEqual(b.sess.get('s1')!.data, { v: 1 });

  assert.equal((await checkForNewer(dropboxSyncRemote(fetch), aState)).hasNewer, false);
  pushed(await pushSnapshot(a.deps, dropboxSyncRemote(fetch), { state: aState }));
  assert.equal((await checkForNewer(dropboxSyncRemote(fetch), aState)).hasNewer, true, 'a second push bumps the rev');
});

// ── Conditional writes (plans/138 Tier D, WP-S1) ────────────────────────────────

test('put with ifRev uploads in update mode; null uses add; a conflict answer throws', async () => {
  withToken();
  const { fetch, calls } = mockFetch((c) => {
    const arg = JSON.parse(c.arg ?? '{}');
    if (arg.mode?.update === 'stale') {
      return new Response(JSON.stringify({ error_summary: 'path/conflict/file/..' }), { status: 409 });
    }
    return new Response(JSON.stringify({ rev: 'a3', size: 1 }));
  });
  const remote = dropboxSyncRemote(fetch);

  await remote.put(new Uint8Array([1]), { ifRev: 'a2' });
  assert.deepEqual(JSON.parse(calls[0]!.arg!).mode, { '.tag': 'update', update: 'a2' });
  assert.equal(JSON.parse(calls[0]!.arg!).autorename, false);

  assert.equal(JSON.parse(calls[0]!.arg!).strict_conflict, true);
  await remote.put(new Uint8Array([1]), { ifRev: null });
  assert.equal(JSON.parse(calls[1]!.arg!).mode, 'add');

  await assert.rejects(() => remote.put(new Uint8Array([1]), { ifRev: 'stale' }), { name: 'SyncConflictError' });
});

test('a 409 that is not a conflict stays an upload failure', async () => {
  withToken();
  const { fetch } = mockFetch(() => new Response(JSON.stringify({ error_summary: 'path/insufficient_space/..' }), { status: 409 }));
  await assert.rejects(() => dropboxSyncRemote(fetch).put(new Uint8Array([1]), { ifRev: 'a2' }), (err: Error) => err.name !== 'SyncConflictError');
});

// ── Conformance (plans/138 Tier D, WP-S6) ───────────────────────────────────────

/** A slot path as sync-service.ts names it for Dropbox: rooted in the app folder. */
const dropboxPath = (path?: string): string | undefined => (path === undefined ? undefined : `/${path}`);

let conformanceDropbox = fakeDropbox();
runSyncRemoteConformance('dropboxSyncRemote conformance (fake Dropbox)', (path) => dropboxSyncRemote(conformanceDropbox, dropboxPath(path)), {
  preconditions: 'store',
  silent: true,
  setup: () => { withToken(); conformanceDropbox = fakeDropbox(); },
});

runSyncRemoteConformance('dropboxSyncRemote conformance (live Dropbox)', (path) => dropboxSyncRemote(undefined, dropboxPath(path)), {
  preconditions: 'store',
  skip: `live Dropbox run: ${OAUTH_LIVE_SKIP}`,
});

test('an update naming a rev conflicts when the file was deleted since (strict_conflict)', async () => {
  withToken();
  const fetch = fakeDropbox();
  const remote = dropboxSyncRemote(fetch);
  await assert.rejects(() => remote.put(new Uint8Array([1]), { ifRev: 'r7' }), { name: 'SyncConflictError' });
  assert.equal(await remote.head(), null, 'nothing was recreated');
  const plain = await remote.put(new Uint8Array([2]));
  assert.ok(plain.rev, 'an unconditional write still works and sends no strict_conflict');
});
