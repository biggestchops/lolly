// SPDX-License-Identifier: MPL-2.0
/**
 * lib/s3-send.ts `s3SyncRemote` (plans/138 B1) - the first concrete SyncRemote.
 * Exercised with a mock fetch (no network): request shape + SigV4 signing on
 * HEAD/GET/PUT, rev/meta parsing from response headers, the 404→null contract,
 * and the ETag-not-CORS-exposed → follow-up-HEAD recovery.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { s3SyncRemote, connectS3, sigV4Headers, encodeS3Key, type S3Config } from './s3-send.ts';
import { resetConnectionsForTests } from './provider-connections.ts';
import { pushSnapshot, checkForNewer, pullAndApply, INITIAL_SYNC_STATE } from './sync-engine.ts';
import {
  runSyncRemoteConformance, liveS3Settings, liveRunId, OTHER_PATH, UNUSUAL_PATH,
} from './sync-remote-conformance.ts';

/** The pushed half of a push result, or a failed assertion. */
function pushed<T extends { status: string }>(result: T): Extract<T, { status: 'pushed' }> {
  assert.equal(result.status, 'pushed');
  return result as Extract<T, { status: 'pushed' }>;
}

const CFG: S3Config = {
  endpoint: 'https://s3.example.com', region: 'eu-central-1', bucket: 'my-bucket',
  accessKeyId: 'AKIA_TEST', secretAccessKey: 'shhh', prefix: 'lolly/',
};

async function connect(): Promise<void> {
  resetConnectionsForTests();
  await connectS3(CFG);
}

interface Call { url: string; method: string; headers: Record<string, string>; body?: BodyInit | null }

/** A mock fetch that records calls and answers from a per-method queue/handler. */
function mockFetch(handler: (call: Call) => Response): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v;
    const call: Call = { url: String(input), method: init?.method ?? 'GET', headers, body: init?.body ?? null };
    calls.push(call);
    return handler(call);
  }) as unknown as typeof fetch;
  return { fetch: fn, calls };
}

test('put signs a PUT to the snapshot key and returns the ETag as rev', async () => {
  await connect();
  const { fetch, calls } = mockFetch(() => new Response(null, { status: 200, headers: { etag: '"abc123"', date: 'Wed, 01 Jan 2025 00:00:00 GMT' } }));
  const remote = s3SyncRemote(fetch);

  const meta = await remote.put(new Uint8Array([1, 2, 3]));

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.method, 'PUT');
  assert.match(calls[0]!.url, /\/my-bucket\/lolly\/lolly-sync\/snapshot\.lolly$/);
  assert.match(calls[0]!.headers.authorization ?? '', /^AWS4-HMAC-SHA256 Credential=AKIA_TEST\//);
  assert.ok(calls[0]!.headers['x-amz-content-sha256'], 'payload hash header present');
  assert.equal(meta.rev, 'abc123', 'ETag (quotes stripped) is the rev');
  assert.equal(meta.size, 3);
});

test('head: 404 → null, 200 → meta from headers', async () => {
  await connect();
  const notFound = s3SyncRemote(mockFetch(() => new Response(null, { status: 404 })).fetch);
  assert.equal(await notFound.head(), null);

  const present = s3SyncRemote(mockFetch(() =>
    new Response(null, { status: 200, headers: { etag: '"r7"', 'last-modified': 'Wed, 01 Jan 2025 00:00:00 GMT', 'content-length': '4096' } })).fetch);
  const meta = await present.head();
  assert.deepEqual(meta, { rev: 'r7', updatedAt: 'Wed, 01 Jan 2025 00:00:00 GMT', size: 4096 });
});

test('get downloads bytes + meta; 404 → null', async () => {
  await connect();
  const gone = s3SyncRemote(mockFetch(() => new Response(null, { status: 404 })).fetch);
  assert.equal(await gone.get(), null);

  const body = new Uint8Array([9, 8, 7, 6]);
  const remote = s3SyncRemote(mockFetch((c) => {
    assert.equal(c.method, 'GET');
    return new Response(body, { status: 200, headers: { etag: '"rev9"' } });
  }).fetch);
  const got = await remote.get();
  assert.deepEqual([...got!.bytes], [9, 8, 7, 6]);
  assert.equal(got!.meta.rev, 'rev9');
  assert.equal(got!.meta.size, 4);
});

test('put recovers the rev via a follow-up HEAD when the PUT response hides ETag', async () => {
  await connect();
  const { fetch, calls } = mockFetch((c) =>
    c.method === 'PUT'
      ? new Response(null, { status: 200 })                                  // no ETag exposed
      : new Response(null, { status: 200, headers: { etag: '"recovered"' } })); // the follow-up HEAD
  const remote = s3SyncRemote(fetch);

  const meta = await remote.put(new Uint8Array([1]));
  assert.deepEqual(calls.map((c) => c.method), ['PUT', 'HEAD'], 'HEAD follows a rev-less PUT');
  assert.equal(meta.rev, 'recovered');
});

test('put surfaces a non-OK bucket status', async () => {
  await connect();
  const remote = s3SyncRemote(mockFetch(() => new Response('denied', { status: 403 })).fetch);
  await assert.rejects(() => remote.put(new Uint8Array([1])), /403/);
});

// A stateful fake bucket, keyed by the full object path: stores each object,
// bumps its ETag on write, 404s when absent, and answers If-Match / If-None-Match
// the way S3 does (412 on a failed condition, 404 for If-Match on a missing key).
// The check and the write happen in one step, as they do in S3, so two racing
// conditional writes cannot both succeed. The engine's push→detect→pull loop runs
// end-to-end through the real s3SyncRemote code (SigV4 + header parsing).
function fakeBucket(): typeof fetch {
  const store = new Map<string, { bytes: Uint8Array; etag: string }>();
  let seq = 0;
  const unquote = (v: string): string => v.replace(/^"|"$/g, '');
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = new URL(String(input)).pathname;
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers as HeadersInit);
    const obj = store.get(key);
    if (method === 'PUT') {
      const ifMatch = headers.get('if-match');
      if (ifMatch !== null && !obj) return new Response(null, { status: 404 });
      if (ifMatch !== null && unquote(ifMatch) !== unquote(obj!.etag)) return new Response(null, { status: 412 });
      if (headers.get('if-none-match') === '*' && obj) return new Response(null, { status: 412 });
      const bytes = new Uint8Array(init!.body as Uint8Array);
      store.set(key, { bytes, etag: `"r${++seq}"` });
      return new Response(null, { status: 200, headers: { etag: store.get(key)!.etag } });
    }
    if (method === 'DELETE') { store.delete(key); return new Response(null, { status: 204 }); }
    if (!obj) return new Response(null, { status: 404 });
    return new Response(method === 'HEAD' ? null : (obj.bytes as unknown as BodyInit), {
      status: 200, headers: { etag: obj.etag, 'content-length': String(obj.bytes.length) },
    });
  }) as unknown as typeof fetch;
}

// A compact in-memory BackupHost + storage (as in sync-engine.test.ts).
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

test('end-to-end: engine push→detect→pull through s3SyncRemote against a fake bucket', async () => {
  await connect();
  const fetch = fakeBucket();
  const a = makeHost({ 's1': { v: 1 } });
  const b = makeHost();

  const remoteA = s3SyncRemote(fetch);
  const { state: aState } = pushed(await pushSnapshot(a.deps, remoteA, { state: INITIAL_SYNC_STATE }));

  // B (never synced) sees A's snapshot as newer and applies it.
  const remoteB = s3SyncRemote(fetch);
  assert.equal((await checkForNewer(remoteB, INITIAL_SYNC_STATE)).hasNewer, true);
  const { summary, state: bState } = await pullAndApply(b.deps, remoteB);
  assert.equal(summary.sessions, 1);
  assert.deepEqual(b.sess.get('s1')!.data, { v: 1 });

  // Neither device now sees a newer snapshot; a second push from A does bump it.
  assert.equal((await checkForNewer(remoteA, aState)).hasNewer, false);
  assert.equal((await checkForNewer(remoteB, bState)).hasNewer, false);
  pushed(await pushSnapshot(a.deps, remoteA, { state: aState }));
  assert.equal((await checkForNewer(remoteB, bState)).hasNewer, true, 'B sees A’s second push');
});

test('end-to-end with encryption: the bucket holds ciphertext, the passphrase restores', async () => {
  await connect();
  const fetch = fakeBucket();
  const a = makeHost({ 's1': { secret: 42 } });
  pushed(await pushSnapshot(a.deps, s3SyncRemote(fetch), { state: INITIAL_SYNC_STATE, passphrase: 'pw' }));

  const b = makeHost();
  await assert.rejects(() => pullAndApply(b.deps, s3SyncRemote(fetch)), /encrypted/i);
  const c = makeHost();
  const { summary } = await pullAndApply(c.deps, s3SyncRemote(fetch), { passphrase: 'pw' });
  assert.equal(summary.sessions, 1);
  assert.deepEqual(c.sess.get('s1')!.data, { secret: 42 });
});

// ── Conditional writes (plans/138 Tier D, WP-S1) ────────────────────────────────

test('put with ifRev sends If-Match; null sends If-None-Match; 412 is a conflict', async () => {
  await connect();
  const { fetch, calls } = mockFetch((c) =>
    c.headers['if-match'] === '"stale"' ? new Response(null, { status: 412 })
    : new Response(null, { status: 200, headers: { etag: '"r2"' } }));
  const remote = s3SyncRemote(fetch);

  await remote.put(new Uint8Array([1]), { ifRev: 'r1' });
  assert.equal(calls[0]!.headers['if-match'], '"r1"');
  assert.match(calls[0]!.headers.authorization ?? '', /SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date,/,
    'the precondition header is sent but not signed');

  await remote.put(new Uint8Array([1]), { ifRev: null });
  assert.equal(calls[1]!.headers['if-none-match'], '*');

  await remote.put(new Uint8Array([1]));
  assert.equal(calls[2]!.headers['if-match'], undefined, 'no condition asked, none sent');

  await assert.rejects(() => remote.put(new Uint8Array([1]), { ifRev: 'stale' }), { name: 'SyncConflictError' });
});

test('a bucket whose CORS rejects If-Match still syncs: one retry without it', async () => {
  await connect();
  const { fetch, calls } = mockFetch((c) => {
    if (c.headers['if-match']) throw new TypeError('Failed to fetch');   // the preflight refusal
    return new Response(null, { status: 200, headers: { etag: '"r3"' } });
  });
  const meta = await s3SyncRemote(fetch).put(new Uint8Array([1]), { ifRev: 'r2' });
  assert.equal(meta.rev, 'r3');
  assert.equal(calls.length, 2);
  assert.equal(calls[1]!.headers['if-match'], undefined);
});

test('a weak or date-shaped rev sends no precondition', async () => {
  await connect();
  const { fetch, calls } = mockFetch(() => new Response(null, { status: 200, headers: { etag: '"r4"' } }));
  const remote = s3SyncRemote(fetch);
  await remote.put(new Uint8Array([1]), { ifRev: 'W/"abc' });
  await remote.put(new Uint8Array([1]), { ifRev: 'Wed, 01 Jan 2025 00:00:00 GMT' });
  assert.equal(calls[0]!.headers['if-match'], undefined);
  assert.equal(calls[1]!.headers['if-match'], undefined);
});

test('end-to-end: a stale device cannot overwrite a newer push', async () => {
  await connect();
  const fetch = fakeBucket();
  const a = makeHost({ 's1': { v: 1 } });
  const b = makeHost();
  const first = pushed(await pushSnapshot(a.deps, s3SyncRemote(fetch), { state: INITIAL_SYNC_STATE }));
  const { state: bState } = await pullAndApply(b.deps, s3SyncRemote(fetch));

  a.sess.set('s1', { data: { v: 2 } });
  pushed(await pushSnapshot(a.deps, s3SyncRemote(fetch), { state: first.state }));

  // B still names A's first copy, so its push is refused and the store keeps v2.
  b.sess.set('s2', { data: { mine: true } });
  const refused = await pushSnapshot(b.deps, s3SyncRemote(fetch), { state: bState });
  assert.equal(refused.status, 'conflict');
  const c = makeHost();
  await pullAndApply(c.deps, s3SyncRemote(fetch));
  assert.deepEqual(c.sess.get('s1')!.data, { v: 2 });
  assert.equal(c.sess.has('s2'), false);
});

// ── Conformance (plans/138 Tier D, WP-S6) ───────────────────────────────────────

/** The object key a remote over `path` writes, under the connected prefix. */
const keyFor = (cfg: S3Config, path?: string): string => `${cfg.prefix ?? ''}${path ?? 'lolly-sync/snapshot.lolly'}`;

/** Remove objects with signed DELETEs, the live suite's cleanup. A missing key is fine. */
async function deleteKeys(cfg: S3Config, keys: Iterable<string>, fetchFn: typeof fetch): Promise<void> {
  const emptyHash = createHash('sha256').update('').digest('hex');
  for (const key of keys) {
    const url = new URL(`${cfg.endpoint.replace(/\/+$/, '')}/${encodeURIComponent(cfg.bucket)}/${encodeS3Key(key)}`);
    const res = await fetchFn(url.toString(), { method: 'DELETE', headers: await sigV4Headers(cfg, 'DELETE', url, emptyHash, null) });
    if (!res.ok && res.status !== 404) throw new Error(`DELETE ${key} answered ${res.status}`);
  }
}

let conformanceBucket = fakeBucket();
runSyncRemoteConformance('s3SyncRemote conformance (fake bucket)', (path) => s3SyncRemote(conformanceBucket, path), {
  preconditions: 'store',
  setup: async () => { await connect(); conformanceBucket = fakeBucket(); },
});

test('the live cleanup deletes every key a case wrote', async () => {
  await connect();
  const fetch = fakeBucket();
  const paths = [undefined, OTHER_PATH, UNUSUAL_PATH];
  for (const p of paths) await s3SyncRemote(fetch, p).put(new Uint8Array([1]));
  await deleteKeys(CFG, paths.map((p) => keyFor(CFG, p)), fetch);
  for (const p of paths) assert.equal(await s3SyncRemote(fetch, p).head(), null, `${p ?? 'default path'} is gone`);
});

// Live mode: see the variables at the top of sync-remote-conformance.ts. Each case
// writes under <prefix><run id>/case-<n>/ and deletes what it wrote afterwards.
const live = liveS3Settings(process.env);
const liveRun = liveRunId();
let liveCase = 0;
let liveCfg: S3Config | null = null;
const liveKeys = new Set<string>();
runSyncRemoteConformance('s3SyncRemote conformance (live bucket)', (path) => {
  liveKeys.add(keyFor(liveCfg!, path));
  return s3SyncRemote(globalThis.fetch, path);
}, {
  preconditions: live.preconditions,
  skip: live.skip,
  setup: async () => {
    liveCfg = { ...live.config!, prefix: `${live.config!.prefix ?? ''}${liveRun}/case-${++liveCase}/` };
    liveKeys.clear();
    resetConnectionsForTests();
    await connectS3(liveCfg);
  },
  teardown: async () => { if (liveCfg) await deleteKeys(liveCfg, liveKeys, globalThis.fetch); },
});

test('a conditional write naming a deleted object is a conflict, not an upload failure', async () => {
  await connect();
  const remote = s3SyncRemote(fakeBucket());
  await assert.rejects(() => remote.put(new Uint8Array([1]), { ifRev: 'e1' }), { name: 'SyncConflictError' });
  const { fetch } = mockFetch(() => new Response(null, { status: 404 }));
  await assert.rejects(() => s3SyncRemote(fetch).put(new Uint8Array([1])), /Bucket upload failed \(404\)/,
    'an unconditional 404 stays an upload failure');
});
