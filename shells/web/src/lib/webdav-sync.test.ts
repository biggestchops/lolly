// SPDX-License-Identifier: MPL-2.0
/**
 * lib/nextcloud-send.ts `webdavSyncRemote` (plans/138 B1) - the second concrete
 * SyncRemote. Mock-fetch coverage of request shape (Basic auth, MKCOL-then-PUT,
 * the dav URL + sync path), rev/meta parsing, 404→null, ETag-hidden→HEAD
 * recovery, plus an end-to-end engine run against a stateful fake server.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { webdavSyncRemote, connectWebdav, davUrl, type WebdavConfig } from './nextcloud-send.ts';
import { resetConnectionsForTests } from './provider-connections.ts';
import { pushSnapshot, checkForNewer, pullAndApply, INITIAL_SYNC_STATE } from './sync-engine.ts';
import {
  runSyncRemoteConformance, liveWebdavSettings, liveRunId, OTHER_PATH, UNUSUAL_PATH,
} from './sync-remote-conformance.ts';

/** The pushed half of a push result, or a failed assertion. */
function pushed<T extends { status: string }>(result: T): Extract<T, { status: 'pushed' }> {
  assert.equal(result.status, 'pushed');
  return result as Extract<T, { status: 'pushed' }>;
}

const CFG: WebdavConfig = {
  baseUrl: 'https://cloud.example.org', username: 'ada', appPassword: 'app-pw', folder: 'Lolly',
};

async function connect(): Promise<void> {
  resetConnectionsForTests();
  await connectWebdav(CFG);
}

interface Call { url: string; method: string; headers: Record<string, string> }
function mockFetch(handler: (call: Call) => Response): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v;
    const call: Call = { url: String(input), method: init?.method ?? 'GET', headers };
    calls.push(call);
    return handler(call);
  }) as unknown as typeof fetch;
  return { fetch: fn, calls };
}

test('put MKCOLs the ancestors then PUTs the snapshot with Basic auth', async () => {
  await connect();
  const { fetch, calls } = mockFetch((c) =>
    c.method === 'MKCOL' ? new Response(null, { status: 405 })       // already exists
    : new Response(null, { status: 201, headers: { etag: '"w1"' } })); // PUT
  const meta = await webdavSyncRemote(fetch).put(new Uint8Array([1, 2]));

  assert.deepEqual(calls.map((c) => c.method), ['MKCOL', 'MKCOL', 'PUT'], 'both ancestor collections created, then PUT');
  assert.match(calls[0]!.url, /\/remote\.php\/dav\/files\/ada\/Lolly$/);
  assert.match(calls[1]!.url, /\/remote\.php\/dav\/files\/ada\/Lolly\/lolly-sync$/);
  assert.match(calls[2]!.url, /\/remote\.php\/dav\/files\/ada\/Lolly\/lolly-sync\/snapshot\.lolly$/);
  assert.equal(calls[2]!.headers.authorization, `Basic ${Buffer.from('ada:app-pw').toString('base64')}`);
  assert.equal(meta.rev, 'w1');
});

test('head: 404 → null, 200 → meta', async () => {
  await connect();
  assert.equal(await webdavSyncRemote(mockFetch(() => new Response(null, { status: 404 })).fetch).head(), null);
  const meta = await webdavSyncRemote(mockFetch(() =>
    new Response(null, { status: 200, headers: { etag: '"w9"', 'content-length': '2048' } })).fetch).head();
  assert.equal(meta!.rev, 'w9');
  assert.equal(meta!.size, 2048);
});

test('get downloads bytes + meta; put recovers rev via HEAD when the PUT hides ETag', async () => {
  await connect();
  const body = new Uint8Array([5, 6, 7]);
  const got = await webdavSyncRemote(mockFetch(() => new Response(body, { status: 200, headers: { etag: '"g1"' } })).fetch).get();
  assert.deepEqual([...got!.bytes], [5, 6, 7]);
  assert.equal(got!.meta.rev, 'g1');

  const { fetch, calls } = mockFetch((c) =>
    c.method === 'MKCOL' ? new Response(null, { status: 201 })
    : c.method === 'PUT' ? new Response(null, { status: 201 })                       // no ETag exposed
    : new Response(null, { status: 200, headers: { etag: '"recovered"' } }));        // follow-up HEAD
  const meta = await webdavSyncRemote(fetch).put(new Uint8Array([1]));
  assert.equal(calls.at(-1)!.method, 'HEAD', 'a rev-less PUT is followed by HEAD');
  assert.equal(meta.rev, 'recovered');
});

// Stateful fake WebDAV server, keyed by the full path. It keeps collections the
// way a real server does: MKCOL answers 201, or 405 when the path exists, or 409
// when the parent is missing, and a PUT into a missing collection is 409. PUT
// stores the bytes and bumps the ETag, answering If-Match / If-None-Match with 412
// as RFC 7232 says (If-Match on a missing file fails too). The check and the
// write happen in one step. HEAD/GET answer or 404; DELETE removes a file or a
// whole collection. Each user's files root always exists.
function fakeServer(): typeof fetch {
  const files = new Map<string, { bytes: Uint8Array; etag: string }>();
  const dirs = new Set<string>();
  let seq = 0;
  const parentOf = (p: string): string => p.slice(0, p.lastIndexOf('/'));
  const isDir = (p: string): boolean => dirs.has(p) || /^\/remote\.php\/dav\/files\/[^/]+$/.test(p);
  const unquote = (v: string): string => v.replace(/^"|"$/g, '');
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers as HeadersInit);
    const obj = files.get(path);
    if (method === 'MKCOL') {
      if (isDir(path) || obj) return new Response(null, { status: 405 });
      if (!isDir(parentOf(path))) return new Response(null, { status: 409 });
      dirs.add(path);
      return new Response(null, { status: 201 });
    }
    if (method === 'PUT') {
      if (!isDir(parentOf(path))) return new Response(null, { status: 409 });
      if (isDir(path)) return new Response(null, { status: 405 });
      const ifMatch = headers.get('if-match');
      if (ifMatch !== null && (!obj || unquote(ifMatch) !== unquote(obj.etag))) return new Response(null, { status: 412 });
      if (headers.get('if-none-match') === '*' && obj) return new Response(null, { status: 412 });
      files.set(path, { bytes: new Uint8Array(init!.body as Uint8Array), etag: `"w${++seq}"` });
      return new Response(null, { status: obj ? 204 : 201, headers: { etag: files.get(path)!.etag } });
    }
    if (method === 'DELETE') {
      if (!obj && !isDir(path)) return new Response(null, { status: 404 });
      files.delete(path);
      for (const key of [...files.keys()]) if (key.startsWith(`${path}/`)) files.delete(key);
      for (const dir of [...dirs]) if (dir === path || dir.startsWith(`${path}/`)) dirs.delete(dir);
      return new Response(null, { status: 204 });
    }
    if (!obj) return new Response(null, { status: 404 });
    return new Response(method === 'HEAD' ? null : (obj.bytes as unknown as BodyInit), {
      status: 200, headers: { etag: obj.etag, 'content-length': String(obj.bytes.length) },
    });
  }) as unknown as typeof fetch;
}

function makeHost(sessions: Record<string, unknown> = {}) {
  const sess = new Map<string, { data: unknown }>(Object.entries(sessions).map(([k, v]) => [k, { data: v }]));
  const store = new Map<string, string>();
  const host = {
    profile: { async get() { return {}; }, async set() {} },
    state: {
      async list() { return [...sess.keys()].map((slot) => ({ slot })); },
      async load(slot: string) { return sess.get(slot)?.data ?? null; },
      async save(slot: string, data: unknown) { sess.set(slot, { data }); },
    },
    assets: { async _exportUserAssets() { return []; }, async _importUserAsset() {} },
    log() {},
  };
  return { deps: { host: host as never, storage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } } }, sess };
}

test('end-to-end: engine push→detect→pull through webdavSyncRemote against a fake server', async () => {
  await connect();
  const fetch = fakeServer();
  const a = makeHost({ 's1': { v: 1 } });
  const b = makeHost();

  const { state: aState } = pushed(await pushSnapshot(a.deps, webdavSyncRemote(fetch), { state: INITIAL_SYNC_STATE }));
  assert.equal((await checkForNewer(webdavSyncRemote(fetch), INITIAL_SYNC_STATE)).hasNewer, true);
  const { summary, state: bState } = await pullAndApply(b.deps, webdavSyncRemote(fetch));
  assert.equal(summary.sessions, 1);
  assert.deepEqual(b.sess.get('s1')!.data, { v: 1 });

  assert.equal((await checkForNewer(webdavSyncRemote(fetch), aState)).hasNewer, false);
  pushed(await pushSnapshot(a.deps, webdavSyncRemote(fetch), { state: aState }));
  assert.equal((await checkForNewer(webdavSyncRemote(fetch), bState)).hasNewer, true, 'B sees A’s second push');
});

// ── Conditional writes (plans/138 Tier D, WP-S1) ────────────────────────────────

test('put with ifRev sends If-Match and maps 412 to a conflict', async () => {
  await connect();
  const { fetch, calls } = mockFetch((c) => {
    if (c.method === 'MKCOL') return new Response(null, { status: 405 });
    return c.headers['if-match'] === '"w1"'
      ? new Response(null, { status: 412 })
      : new Response(null, { status: 201, headers: { etag: '"w2"' } });
  });
  const remote = webdavSyncRemote(fetch);
  await assert.rejects(() => remote.put(new Uint8Array([1]), { ifRev: 'w1' }), { name: 'SyncConflictError' });
  const meta = await remote.put(new Uint8Array([1]), { ifRev: null });
  assert.equal(calls.filter((c) => c.method === 'PUT')[1]!.headers['if-none-match'], '*');
  assert.equal(meta.rev, 'w2');
});

test('a 409 from WebDAV is not a conflict (it means a missing parent folder)', async () => {
  await connect();
  const { fetch } = mockFetch((c) => (c.method === 'MKCOL' ? new Response(null, { status: 405 }) : new Response(null, { status: 409 })));
  await assert.rejects(() => webdavSyncRemote(fetch).put(new Uint8Array([1]), { ifRev: 'w1' }), (err: Error) => err.name !== 'SyncConflictError');
});

// ── Conformance (plans/138 Tier D, WP-S6) ───────────────────────────────────────

/** DELETE a folder with everything in it, the live suite's cleanup. A missing folder is fine. */
async function deleteFolder(cfg: WebdavConfig, folder: string, fetchFn: typeof fetch): Promise<void> {
  const res = await fetchFn(davUrl(cfg, folder), {
    method: 'DELETE',
    headers: { Authorization: `Basic ${btoa(`${cfg.username}:${cfg.appPassword}`)}` },
  });
  if (!res.ok && res.status !== 404) throw new Error(`DELETE ${folder} answered ${res.status}`);
}

let conformanceServer = fakeServer();
runSyncRemoteConformance('webdavSyncRemote conformance (fake server)', (path) => webdavSyncRemote(conformanceServer, path), {
  preconditions: 'store',
  setup: async () => { await connect(); conformanceServer = fakeServer(); },
});

test('the live cleanup deletes the case folder and everything in it', async () => {
  await connect();
  const fetch = fakeServer();
  const paths = [undefined, OTHER_PATH, UNUSUAL_PATH];
  for (const p of paths) await webdavSyncRemote(fetch, p).put(new Uint8Array([1]));
  await deleteFolder(CFG, CFG.folder!, fetch);
  for (const p of paths) assert.equal(await webdavSyncRemote(fetch, p).head(), null, `${p ?? 'default path'} is gone`);
});

// Live mode: see the variables at the top of sync-remote-conformance.ts. Each case
// writes under <folder>/<run id>-case-<n> and deletes that folder afterwards.
const live = liveWebdavSettings(process.env);
const liveRun = liveRunId();
let liveCase = 0;
let liveCfg: WebdavConfig | null = null;
runSyncRemoteConformance('webdavSyncRemote conformance (live server)', (path) => webdavSyncRemote(globalThis.fetch, path), {
  preconditions: live.preconditions,
  skip: live.skip,
  setup: async () => {
    const folder = [live.config!.folder, `${liveRun}-case-${++liveCase}`].filter(Boolean).join('/');
    liveCfg = { ...live.config!, folder };
    resetConnectionsForTests();
    await connectWebdav(liveCfg);
  },
  teardown: async () => { if (liveCfg) await deleteFolder(liveCfg, liveCfg.folder!, globalThis.fetch); },
});
