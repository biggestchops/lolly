// SPDX-License-Identifier: MPL-2.0
/**
 * lib/onedrive-send.ts `onedriveSyncRemote` (plans/138 Tier D, WP-P1). One path
 * under the app folder, `rev` = the item's cTag, downloads through the
 * pre-authenticated download URL, writes as a simple PUT up to 4 MB and an
 * upload session above that. Conditional writes name the eTag from a fresh read
 * (If-Match) or ask Graph to fail on an existing name. Mock-fetch coverage of
 * request shape and each branch, then end-to-end engine runs against a stateful
 * fake Graph that answers If-Match with 412 and a taken name with 409.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { onedriveSyncRemote, GRAPH_SIMPLE_UPLOAD_MAX, GRAPH_CHUNK_BYTES } from './onedrive-send.ts';
import { cacheToken, cachedToken, resetConnectionsForTests, saveConnection } from './provider-connections.ts';
import { pushSnapshot, checkForNewer, pullAndApply, INITIAL_SYNC_STATE } from './sync-engine.ts';
import { runSyncRemoteConformance, OAUTH_LIVE_SKIP } from './sync-remote-conformance.ts';

/** The pushed half of a push result, or a failed assertion. */
function pushed<T extends { status: string }>(result: T): Extract<T, { status: 'pushed' }> {
  assert.equal(result.status, 'pushed');
  return result as Extract<T, { status: 'pushed' }>;
}

const GRAPH_ITEM = 'https://graph.microsoft.com/v1.0/me/drive/special/approot:/';
const SNAPSHOT = `${GRAPH_ITEM}lolly-sync/snapshot.lolly:`;

function withToken(): void {
  resetConnectionsForTests();
  cacheToken('o365', 'tok', Date.now() + 3_600_000);
}

interface Call { url: string; method: string; headers: Record<string, string>; body?: BodyInit | null }

/** A mock fetch that records calls (headers lower-cased) and answers from a handler. */
function mockFetch(handler: (call: Call) => Response | Promise<Response>): { fetch: typeof fetch; calls: Call[] } {
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

const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status });
const isRead = (c: Call): boolean => c.method === 'GET' && c.url.includes('/me/drive/special/approot:');

/** A Graph item as the service answers it: a quoted eTag and a content cTag. */
function item(n: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'ITEM1',
    eTag: `"{AAAA},${n}"`,
    cTag: `"c:{AAAA},${n}"`,
    size: 3,
    lastModifiedDateTime: '2026-09-16T10:00:00Z',
    ...extra,
  };
}

// ── Silence, addressing, head ────────────────────────────────────────────────

test('canSyncSilently: false with no token, true with a cached token or a stored refresh token', async () => {
  resetConnectionsForTests();
  const remote = onedriveSyncRemote(mockFetch(() => json({})).fetch);
  assert.equal(await remote.canSyncSilently!(), false);
  cacheToken('o365', 'tok', Date.now() + 60_000);
  assert.equal(await remote.canSyncSilently!(), true);
  resetConnectionsForTests();
  await saveConnection({ kind: 'o365', account: 'a@b.c', persist: false, refreshToken: 'R', connectedAt: 'now' });
  assert.equal(await remote.canSyncSilently!(), true);
  resetConnectionsForTests();
});

test('head: 404 → null; 200 → meta whose rev is the cTag', async () => {
  withToken();
  assert.equal(await onedriveSyncRemote(mockFetch(() => new Response(null, { status: 404 })).fetch).head(), null);

  const { fetch, calls } = mockFetch(() => json(item(4, { size: 4096 })));
  const meta = await onedriveSyncRemote(fetch).head();
  assert.deepEqual(meta, { rev: '"c:{AAAA},4"', updatedAt: '2026-09-16T10:00:00Z', size: 4096 });
  assert.equal(calls[0]!.method, 'GET');
  assert.equal(calls[0]!.url, `${SNAPSHOT}?$select=id,eTag,cTag,size,lastModifiedDateTime`);
  assert.equal(calls[0]!.headers.authorization, 'Bearer tok');
});

test('head: a Graph error other than 404 is thrown, not read as "no snapshot"', async () => {
  withToken();
  await assert.rejects(() => onedriveSyncRemote(mockFetch(() => new Response('busy', { status: 503 })).fetch).head(), /503/);
});

test('a metadata-only change (eTag moved, cTag did not) keeps the rev', async () => {
  withToken();
  let answer = item(1);
  const remote = onedriveSyncRemote(mockFetch(() => json(answer)).fetch);
  const before = await remote.head();
  answer = { ...item(1), eTag: '"{AAAA},9"' };
  assert.equal((await remote.head())!.rev, before!.rev);
});

test('the path parameter replaces the default and each segment is encoded, slashes kept', async () => {
  withToken();
  const { fetch, calls } = mockFetch(() => new Response(null, { status: 404 }));
  await onedriveSyncRemote(fetch, 'lolly-backup/day-3.lolly').head();
  await onedriveSyncRemote(fetch, '/odd dir/a:b#?.lolly').head();
  await onedriveSyncRemote(fetch, '').head();
  assert.ok(calls[0]!.url.startsWith(`${GRAPH_ITEM}lolly-backup/day-3.lolly:?`));
  assert.ok(calls[1]!.url.startsWith(`${GRAPH_ITEM}odd%20dir/a%3Ab%23%3F.lolly:?`));
  assert.ok(calls[2]!.url.startsWith(`${SNAPSHOT}?`), 'an empty path falls back to the snapshot');
});

test('a 401 drops the token, refreshes through the stored refresh token and retries once', async () => {
  resetConnectionsForTests();
  cacheToken('o365', 'stale', Date.now() + 60_000);
  await saveConnection({ kind: 'o365', account: 'a@b.c', persist: false, refreshToken: 'R1', connectedAt: 'now' });
  const { fetch, calls } = mockFetch((c) => {
    if (c.url.includes('login.microsoftonline.com')) return json({ access_token: 'fresh', refresh_token: 'R2', expires_in: 3600 });
    return c.headers.authorization === 'Bearer stale' ? new Response(null, { status: 401 }) : json(item(2));
  });
  const meta = await onedriveSyncRemote(fetch).head();
  assert.equal(meta!.rev, '"c:{AAAA},2"');
  assert.deepEqual(calls.map((c) => c.headers.authorization ?? 'token-endpoint'), ['Bearer stale', 'token-endpoint', 'Bearer fresh']);
  assert.equal(cachedToken('o365'), 'fresh');
  resetConnectionsForTests();
});

// ── get ──────────────────────────────────────────────────────────────────────

test('get: 404 → null; bytes come from the download URL with no Authorization header', async () => {
  withToken();
  assert.equal(await onedriveSyncRemote(mockFetch(() => new Response(null, { status: 404 })).fetch).get(), null);

  const { fetch, calls } = mockFetch((c) => c.url.startsWith('https://dl.example/')
    ? new Response(new Uint8Array([7, 8, 9]) as unknown as BodyInit, { status: 200 })
    : json(item(5, { size: 999, '@microsoft.graph.downloadUrl': 'https://dl.example/f?tempauth=x' })));
  const got = await onedriveSyncRemote(fetch).get();
  assert.deepEqual([...got!.bytes], [7, 8, 9]);
  assert.deepEqual(got!.meta, { rev: '"c:{AAAA},5"', updatedAt: '2026-09-16T10:00:00Z', size: 3 });
  assert.equal(calls[0]!.url, SNAPSHOT, 'the metadata read asks for the default fields, which carry the download URL');
  assert.equal(calls[1]!.url, 'https://dl.example/f?tempauth=x');
  assert.equal(calls[1]!.headers.authorization, undefined, 'the pre-authenticated URL gets no bearer token');
});

test('get: without a download URL it falls back to /content; a vanished download is null', async () => {
  withToken();
  const { fetch, calls } = mockFetch((c) => c.url.endsWith(':/content')
    ? new Response(new Uint8Array([1]) as unknown as BodyInit, { status: 200 })
    : json(item(6)));
  const got = await onedriveSyncRemote(fetch).get();
  assert.deepEqual([...got!.bytes], [1]);
  assert.equal(calls[1]!.url, `${SNAPSHOT}/content`);
  assert.equal(calls[1]!.headers.authorization, 'Bearer tok');

  const gone = mockFetch((c) => c.url.startsWith('https://dl.example/')
    ? new Response(null, { status: 404 })
    : json(item(6, { '@microsoft.graph.downloadUrl': 'https://dl.example/gone' })));
  assert.equal(await onedriveSyncRemote(gone.fetch).get(), null);
});

// ── put: simple uploads ──────────────────────────────────────────────────────

test('put without a condition: one PUT that replaces, no read, no If-Match; rev from the answer', async () => {
  withToken();
  const { fetch, calls } = mockFetch(() => json(item(7), 200));
  const meta = await onedriveSyncRemote(fetch).put(new Uint8Array([1, 2, 3]));
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.method, 'PUT');
  assert.equal(calls[0]!.url, `${SNAPSHOT}/content?@microsoft.graph.conflictBehavior=replace`);
  assert.equal(calls[0]!.headers['if-match'], undefined);
  assert.equal(calls[0]!.headers['content-type'], 'application/octet-stream');
  assert.equal(meta.rev, '"c:{AAAA},7"');
  assert.equal(meta.size, 3);
});

test('put with ifRev reads first and names the fresh eTag, verbatim, in If-Match', async () => {
  withToken();
  const { fetch, calls } = mockFetch((c) => isRead(c) ? json(item(3)) : json(item(4), 200));
  const meta = await onedriveSyncRemote(fetch).put(new Uint8Array([1]), { ifRev: '"c:{AAAA},3"' });
  assert.equal(calls.length, 2);
  assert.ok(isRead(calls[0]!), 'a metadata read comes first');
  assert.equal(calls[1]!.url, `${SNAPSHOT}/content?@microsoft.graph.conflictBehavior=replace`);
  assert.equal(calls[1]!.headers['if-match'], '"{AAAA},3"', 'the eTag, not the cTag, and not re-quoted');
  assert.equal(meta.rev, '"c:{AAAA},4"');
});

test('put with ifRev: a stored copy that already differs is a conflict, with no upload', async () => {
  withToken();
  const moved = mockFetch(() => json(item(5)));
  await assert.rejects(() => onedriveSyncRemote(moved.fetch).put(new Uint8Array([1]), { ifRev: '"c:{AAAA},3"' }), { name: 'SyncConflictError' });
  assert.equal(moved.calls.length, 1);

  const removed = mockFetch(() => new Response(null, { status: 404 }));
  await assert.rejects(() => onedriveSyncRemote(removed.fetch).put(new Uint8Array([1]), { ifRev: '"c:{AAAA},3"' }), { name: 'SyncConflictError' });
  assert.equal(removed.calls.length, 1);
});

test('put with ifRev null asks Graph to fail on a taken name; an existing copy is a conflict first', async () => {
  withToken();
  const empty = mockFetch((c) => isRead(c) ? new Response(null, { status: 404 }) : json(item(1), 201));
  const meta = await onedriveSyncRemote(empty.fetch).put(new Uint8Array([1]), { ifRev: null });
  assert.equal(empty.calls[1]!.url, `${SNAPSHOT}/content?@microsoft.graph.conflictBehavior=fail`);
  assert.equal(empty.calls[1]!.headers['if-match'], undefined);
  assert.equal(empty.calls[1]!.headers['if-none-match'], undefined, 'Graph does not document If-None-Match: * on writes');
  assert.equal(meta.rev, '"c:{AAAA},1"');

  const taken = mockFetch(() => json(item(1)));
  await assert.rejects(() => onedriveSyncRemote(taken.fetch).put(new Uint8Array([1]), { ifRev: null }), { name: 'SyncConflictError' });
  assert.equal(taken.calls.length, 1, 'no upload when the read already shows a copy');
});

test('put with ifRev null: a 409 because another device wrote first is a conflict', async () => {
  withToken();
  let reads = 0;
  const { fetch } = mockFetch((c) => {
    if (isRead(c)) return ++reads === 1 ? new Response(null, { status: 404 }) : json(item(1));
    return json({ error: { code: 'nameAlreadyExists' } }, 409);
  });
  await assert.rejects(() => onedriveSyncRemote(fetch).put(new Uint8Array([1]), { ifRev: null }), { name: 'SyncConflictError' });
});

test('put with ifRev null: a 409 while nothing is stored stays an upload failure', async () => {
  withToken();
  const { fetch } = mockFetch((c) => isRead(c) ? new Response(null, { status: 404 }) : json({ error: { code: 'other' } }, 409));
  await assert.rejects(() => onedriveSyncRemote(fetch).put(new Uint8Array([1]), { ifRev: null }),
    (err: Error) => err.name !== 'SyncConflictError' && /409/.test(err.message));
});

test('a 412 after another device wrote is a conflict', async () => {
  withToken();
  let reads = 0;
  const { fetch, calls } = mockFetch((c) => {
    if (isRead(c)) return json(item(++reads === 1 ? 3 : 4));
    return json({ error: { code: 'resourceModified' } }, 412);
  });
  await assert.rejects(() => onedriveSyncRemote(fetch).put(new Uint8Array([1]), { ifRev: '"c:{AAAA},3"' }), { name: 'SyncConflictError' });
  assert.deepEqual(calls.map((c) => c.method), ['GET', 'PUT', 'GET'], 'refused, read again, no retry');
});

test('a 412 while the content is unchanged (only the eTag moved) retries once without If-Match', async () => {
  withToken();
  let reads = 0;
  const { fetch, calls } = mockFetch((c) => {
    if (isRead(c)) return json({ ...item(3), eTag: `"{AAAA},${++reads === 1 ? 3 : 8}"` });
    return c.headers['if-match'] ? json({ error: { code: 'resourceModified' } }, 412) : json(item(9), 200);
  });
  const meta = await onedriveSyncRemote(fetch).put(new Uint8Array([1]), { ifRev: '"c:{AAAA},3"' });
  assert.equal(meta.rev, '"c:{AAAA},9"');
  assert.deepEqual(calls.map((c) => `${c.method}${c.headers['if-match'] ? '+if-match' : ''}`), ['GET', 'PUT+if-match', 'GET', 'PUT']);
});

test('a failed upload that is not a refused condition stays an upload failure', async () => {
  withToken();
  const { fetch } = mockFetch((c) => isRead(c) ? json(item(3)) : new Response('quota', { status: 507 }));
  await assert.rejects(() => onedriveSyncRemote(fetch).put(new Uint8Array([1]), { ifRev: '"c:{AAAA},3"' }),
    (err: Error) => err.name !== 'SyncConflictError' && /507/.test(err.message));
  await assert.rejects(() => onedriveSyncRemote(fetch).put(new Uint8Array([1])), /507/);
});

test('an upload answer without a cTag is followed by a read that recovers the rev', async () => {
  withToken();
  const { fetch, calls } = mockFetch((c) => isRead(c) ? json(item(12)) : json({ id: 'ITEM1', size: 1 }, 200));
  const meta = await onedriveSyncRemote(fetch).put(new Uint8Array([1]));
  assert.deepEqual(calls.map((c) => c.method), ['PUT', 'GET']);
  assert.equal(meta.rev, '"c:{AAAA},12"');
});

// ── put: the browser preflight fallback ──────────────────────────────────────

test('a browser preflight that refuses If-Match: one retry without it', async () => {
  withToken();
  const { fetch, calls } = mockFetch((c) => {
    if (c.headers['if-match']) throw new TypeError('Failed to fetch');
    return isRead(c) ? json(item(3)) : json(item(4), 200);
  });
  const meta = await onedriveSyncRemote(fetch).put(new Uint8Array([1]), { ifRev: '"c:{AAAA},3"' });
  assert.equal(meta.rev, '"c:{AAAA},4"');
  assert.deepEqual(calls.map((c) => `${c.method}${c.headers['if-match'] ? '+if-match' : ''}`), ['GET', 'PUT+if-match', 'PUT']);
});

test('the Tauri apps never retry without If-Match (their transport has no preflight)', async () => {
  withToken();
  const g = globalThis as { window?: unknown };
  const had = 'window' in g;
  const prev = g.window;
  g.window = { __TAURI_INTERNALS__: { invoke: () => undefined } };
  try {
    const { fetch, calls } = mockFetch((c) => {
      if (c.headers['if-match']) throw new TypeError('network down');
      return json(item(3));
    });
    await assert.rejects(() => onedriveSyncRemote(fetch).put(new Uint8Array([1]), { ifRev: '"c:{AAAA},3"' }), /network down/);
    assert.equal(calls.length, 2, 'the read and the one conditional PUT, no retry');
  } finally {
    if (had) g.window = prev; else delete g.window;
  }
});

// ── put: upload sessions ─────────────────────────────────────────────────────

const LARGE = GRAPH_SIMPLE_UPLOAD_MAX + 1;
const UPLOAD_URL = 'https://up.example/session-1';

test('a large conditional put opens a session with If-Match and replace, then PUTs chunks without a token', async () => {
  withToken();
  const { fetch, calls } = mockFetch((c) => {
    if (isRead(c)) return json(item(3));
    if (c.url.endsWith(':/createUploadSession')) return json({ uploadUrl: UPLOAD_URL });
    const last = String(c.headers['content-range']).endsWith(`-${LARGE - 1}/${LARGE}`);
    return last ? json(item(4, { size: LARGE }), 201) : json({ nextExpectedRanges: ['x-'] }, 202);
  });
  const meta = await onedriveSyncRemote(fetch).put(new Uint8Array(LARGE), { ifRev: '"c:{AAAA},3"' });

  const session = calls[1]!;
  assert.equal(session.method, 'POST');
  assert.equal(session.url, `${SNAPSHOT}/createUploadSession`);
  assert.equal(session.headers['if-match'], '"{AAAA},3"');
  assert.deepEqual(JSON.parse(String(session.body)), { item: { '@microsoft.graph.conflictBehavior': 'replace' } });
  const chunks = calls.slice(2);
  assert.equal(chunks.length, Math.ceil(LARGE / GRAPH_CHUNK_BYTES));
  for (const c of chunks) {
    assert.equal(c.url, UPLOAD_URL);
    assert.equal(c.method, 'PUT');
    assert.equal(c.headers.authorization, undefined);
  }
  assert.equal(meta.rev, '"c:{AAAA},4"');
  assert.equal(meta.size, LARGE);
});

test('a large unconditional put names replace, because a session defaults to fail', async () => {
  withToken();
  const { fetch, calls } = mockFetch((c) => c.url.endsWith(':/createUploadSession')
    ? json({ uploadUrl: UPLOAD_URL })
    : json(item(1, { size: LARGE }), 200));
  await onedriveSyncRemote(fetch).put(new Uint8Array(LARGE));
  assert.equal(calls[0]!.headers['if-match'], undefined);
  assert.deepEqual(JSON.parse(String(calls[0]!.body)), { item: { '@microsoft.graph.conflictBehavior': 'replace' } });
});

test('a large put with ifRev null: 409 on the last chunk is a conflict and the session is cancelled', async () => {
  withToken();
  let reads = 0;
  const { fetch, calls } = mockFetch((c) => {
    if (isRead(c)) return ++reads === 1 ? new Response(null, { status: 404 }) : json(item(1));
    if (c.url.endsWith(':/createUploadSession')) return json({ uploadUrl: UPLOAD_URL });
    if (c.method === 'DELETE') return new Response(null, { status: 204 });
    const last = String(c.headers['content-range']).endsWith(`-${LARGE - 1}/${LARGE}`);
    return last ? json({ error: { code: 'nameAlreadyExists' } }, 409) : json({}, 202);
  });
  await assert.rejects(() => onedriveSyncRemote(fetch).put(new Uint8Array(LARGE), { ifRev: null }), { name: 'SyncConflictError' });
  assert.deepEqual(JSON.parse(String(calls[1]!.body)), { item: { '@microsoft.graph.conflictBehavior': 'fail' } });
  assert.ok(calls.some((c) => c.method === 'DELETE' && c.url === UPLOAD_URL), 'the failed session is cancelled');
});

test('a 412 when the session opens is a conflict once the read shows new content', async () => {
  withToken();
  let reads = 0;
  const { fetch, calls } = mockFetch((c) => {
    if (isRead(c)) return json(item(++reads === 1 ? 3 : 5));
    return json({ error: { code: 'resourceModified' } }, 412);
  });
  await assert.rejects(() => onedriveSyncRemote(fetch).put(new Uint8Array(LARGE), { ifRev: '"c:{AAAA},3"' }), { name: 'SyncConflictError' });
  assert.equal(calls.filter((c) => c.url.startsWith('https://up.example/')).length, 0, 'no chunk was sent');
});

// ── A stateful fake Graph ─────────────────────────────────────────────────────
// One drive under the app folder, keyed by decoded path. A content write bumps
// both tags; `touch` bumps only the eTag, the way a metadata change does. If-Match
// is compared with the eTag (412 on mismatch or when nothing is stored), a taken
// name under conflictBehavior 'fail' answers 409, on the PUT for a simple upload
// and on the last chunk for a session (as Microsoft documents). Downloads and
// chunk PUTs must not carry the bearer token. `raceNextWrite` stores another
// device's copy just before the next write request is checked, which is the
// moment between the adapter's own read and its upload.

interface FakeFile { bytes: Uint8Array; e: number; c: number }

interface FakeGraph {
  fetch: typeof fetch;
  files: Map<string, FakeFile>;
  touch(path: string): void;
  raceNextWrite(path: string, bytes: Uint8Array): void;
  writeNow(path: string, bytes: Uint8Array): void;
}

function fakeGraph(): FakeGraph {
  const files = new Map<string, FakeFile>();
  const sessions = new Map<string, { path: string; behavior: string; parts: Uint8Array[] }>();
  let seq = 0;
  let race: { path: string; bytes: Uint8Array } | null = null;
  const tags = (f: FakeFile) => ({ eTag: `"{F00D},${f.e}"`, cTag: `"c:{F00D},${f.c}"` });
  const itemJson = (path: string, f: FakeFile) => ({
    id: path, ...tags(f), size: f.bytes.length, lastModifiedDateTime: `2026-09-16T10:00:${String(f.c % 60).padStart(2, '0')}Z`,
  });
  const store = (path: string, bytes: Uint8Array): FakeFile => {
    const prev = files.get(path);
    const f = { bytes, e: (prev?.e ?? 0) + 1, c: (prev?.c ?? 0) + 1 };
    files.set(path, f);
    return f;
  };
  const header = (init: RequestInit | undefined, name: string): string | undefined => {
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) if (k.toLowerCase() === name) return v;
    return undefined;
  };

  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';

    if (url.host === 'dl.example') {
      assert.equal(header(init, 'authorization'), undefined);
      const f = files.get(decodeURIComponent(url.pathname.slice(1)));
      return f ? new Response(f.bytes as unknown as BodyInit, { status: 200 }) : new Response(null, { status: 404 });
    }

    if (url.host === 'up.example') {
      assert.equal(header(init, 'authorization'), undefined);
      const sess = sessions.get(url.pathname);
      if (!sess) return new Response(null, { status: 404 });
      if (method === 'DELETE') { sessions.delete(url.pathname); return new Response(null, { status: 204 }); }
      sess.parts.push(new Uint8Array(init!.body as Uint8Array));
      const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(header(init, 'content-range') ?? '')!;
      if (Number(m[2]) + 1 < Number(m[3])) return json({ nextExpectedRanges: [`${Number(m[2]) + 1}-`] }, 202);
      if (sess.behavior === 'fail' && files.has(sess.path)) return json({ error: { code: 'nameAlreadyExists' } }, 409);
      const whole = new Uint8Array(Number(m[3]));
      let at = 0;
      for (const p of sess.parts) { whole.set(p, at); at += p.length; }
      sessions.delete(url.pathname);
      return json(itemJson(sess.path, store(sess.path, whole)), 201);
    }

    assert.equal(header(init, 'authorization'), 'Bearer tok');
    const m = /^\/v1\.0\/me\/drive\/special\/approot:\/(.+):(\/content|\/createUploadSession)?$/.exec(url.pathname);
    if (!m) return new Response(null, { status: 400 });
    const path = m[1]!.split('/').map(decodeURIComponent).join('/');
    if (method !== 'GET' && race) { store(race.path, race.bytes); race = null; }
    const current = files.get(path);
    const ifMatch = header(init, 'if-match');
    const refused = ifMatch !== undefined && (!current || ifMatch !== tags(current).eTag);

    if (!m[2] && method === 'GET') {
      if (!current) return json({ error: { code: 'itemNotFound' } }, 404);
      const body: Record<string, unknown> = itemJson(path, current);
      if (!url.searchParams.has('$select')) body['@microsoft.graph.downloadUrl'] = `https://dl.example/${encodeURIComponent(path)}`;
      return json(body);
    }
    if (m[2] === '/content' && method === 'PUT') {
      if (refused) return json({ error: { code: 'resourceModified' } }, 412);
      if (url.searchParams.get('@microsoft.graph.conflictBehavior') === 'fail' && current) return json({ error: { code: 'nameAlreadyExists' } }, 409);
      const created = !current;
      return json(itemJson(path, store(path, new Uint8Array(init!.body as Uint8Array))), created ? 201 : 200);
    }
    if (m[2] === '/createUploadSession' && method === 'POST') {
      if (refused) return json({ error: { code: 'resourceModified' } }, 412);
      const behavior = (JSON.parse(String(init!.body)) as { item?: Record<string, string> }).item?.['@microsoft.graph.conflictBehavior'] ?? 'fail';
      const id = `/s${++seq}`;
      sessions.set(id, { path, behavior, parts: [] });
      return json({ uploadUrl: `https://up.example${id}` });
    }
    return new Response(null, { status: 405 });
  }) as unknown as typeof fetch;

  return {
    fetch: fn,
    files,
    touch(path: string) { const f = files.get(path); if (f) f.e++; },
    raceNextWrite(path: string, bytes: Uint8Array) { race = { path, bytes }; },
    writeNow(path: string, bytes: Uint8Array) { store(path, bytes); },
  };
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

test('end-to-end: engine push→detect→pull through onedriveSyncRemote against a fake Graph', async () => {
  withToken();
  const graph = fakeGraph();
  const a = makeHost({ 's1': { v: 1 } });
  const b = makeHost();

  const { state: aState } = pushed(await pushSnapshot(a.deps, onedriveSyncRemote(graph.fetch), { state: INITIAL_SYNC_STATE }));
  assert.ok(graph.files.has('lolly-sync/snapshot.lolly'));

  assert.equal((await checkForNewer(onedriveSyncRemote(graph.fetch), INITIAL_SYNC_STATE)).hasNewer, true);
  const { summary, state: bState } = await pullAndApply(b.deps, onedriveSyncRemote(graph.fetch));
  assert.equal(summary.sessions, 1);
  assert.deepEqual(b.sess.get('s1')!.data, { v: 1 });

  assert.equal((await checkForNewer(onedriveSyncRemote(graph.fetch), aState)).hasNewer, false);
  assert.equal((await checkForNewer(onedriveSyncRemote(graph.fetch), bState)).hasNewer, false);
  pushed(await pushSnapshot(a.deps, onedriveSyncRemote(graph.fetch), { state: aState }));
  assert.equal((await checkForNewer(onedriveSyncRemote(graph.fetch), bState)).hasNewer, true, 'B sees A’s second push');
});

test('end-to-end: a stale device cannot overwrite a newer push', async () => {
  withToken();
  const graph = fakeGraph();
  const a = makeHost({ 's1': { v: 1 } });
  const b = makeHost();
  const first = pushed(await pushSnapshot(a.deps, onedriveSyncRemote(graph.fetch), { state: INITIAL_SYNC_STATE }));
  const { state: bState } = await pullAndApply(b.deps, onedriveSyncRemote(graph.fetch));

  a.sess.set('s1', { data: { v: 2 } });
  pushed(await pushSnapshot(a.deps, onedriveSyncRemote(graph.fetch), { state: first.state }));

  // B still names A's first copy, so its push is refused and the store keeps v2.
  b.sess.set('s2', { data: { mine: true } });
  const refused = await pushSnapshot(b.deps, onedriveSyncRemote(graph.fetch), { state: bState });
  assert.equal(refused.status, 'conflict');
  const c = makeHost();
  await pullAndApply(c.deps, onedriveSyncRemote(graph.fetch));
  assert.deepEqual(c.sess.get('s1')!.data, { v: 2 });
  assert.equal(c.sess.has('s2'), false);
});

test('end-to-end: a metadata-only change is not a newer copy and does not block the next push', async () => {
  withToken();
  const graph = fakeGraph();
  const a = makeHost({ 's1': { v: 1 } });
  const first = pushed(await pushSnapshot(a.deps, onedriveSyncRemote(graph.fetch), { state: INITIAL_SYNC_STATE }));
  graph.touch('lolly-sync/snapshot.lolly');

  assert.equal((await checkForNewer(onedriveSyncRemote(graph.fetch), first.state)).hasNewer, false);
  a.sess.set('s1', { data: { v: 2 } });
  pushed(await pushSnapshot(a.deps, onedriveSyncRemote(graph.fetch), { state: first.state }));
});

test('end-to-end: a write from another device after the read is refused by Graph (412)', async () => {
  withToken();
  const graph = fakeGraph();
  const remote = onedriveSyncRemote(graph.fetch);
  const first = await remote.put(new Uint8Array([1]));
  graph.raceNextWrite('lolly-sync/snapshot.lolly', new Uint8Array([9]));
  await assert.rejects(() => remote.put(new Uint8Array([2]), { ifRev: first.rev }), { name: 'SyncConflictError' });
  assert.deepEqual([...graph.files.get('lolly-sync/snapshot.lolly')!.bytes], [9], 'the other device keeps its copy');
});

test('end-to-end: two devices creating the first copy at once, Graph refuses the second (409)', async () => {
  withToken();
  const graph = fakeGraph();
  const remote = onedriveSyncRemote(graph.fetch);
  // This device read an empty store; the other device's first copy is stored before this upload.
  graph.raceNextWrite('lolly-sync/snapshot.lolly', new Uint8Array([1]));
  await assert.rejects(() => remote.put(new Uint8Array([2]), { ifRev: null }), { name: 'SyncConflictError' });
  assert.deepEqual([...graph.files.get('lolly-sync/snapshot.lolly')!.bytes], [1]);
  // With the copy now visible, the refusal comes from the read, before any upload.
  await assert.rejects(() => remote.put(new Uint8Array([3]), { ifRev: null }), { name: 'SyncConflictError' });
});

test('end-to-end: large snapshots go through upload sessions, with the same conditions', async () => {
  withToken();
  const graph = fakeGraph();
  const remote = onedriveSyncRemote(graph.fetch, 'lolly-backup/day-3.lolly');
  const big = new Uint8Array(GRAPH_SIMPLE_UPLOAD_MAX + GRAPH_CHUNK_BYTES + 17);
  big[0] = 1;
  big[big.length - 1] = 2;

  const created = await remote.put(big, { ifRev: null });
  assert.deepEqual(await remote.head(), created);
  await assert.rejects(() => remote.put(big, { ifRev: null }), { name: 'SyncConflictError' });

  const replaced = await remote.put(big, { ifRev: created.rev });
  assert.notEqual(replaced.rev, created.rev);
  await assert.rejects(() => remote.put(big, { ifRev: created.rev }), { name: 'SyncConflictError' });

  // Another device writes while this one opens a session: Graph refuses it (412).
  graph.raceNextWrite('lolly-backup/day-3.lolly', big);
  await assert.rejects(() => remote.put(big, { ifRev: replaced.rev }), { name: 'SyncConflictError' });
  const latest = (await remote.head())!;

  // A first copy that another device creates while the chunks are on their way
  // is refused on the last chunk (409), and the other device keeps its copy.
  let raced = false;
  const racing = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!raced && String(input).startsWith('https://up.example/')) {
      raced = true;
      graph.writeNow('lolly-backup/day-4.lolly', new Uint8Array([4]));
    }
    return graph.fetch(input, init);
  }) as unknown as typeof fetch;
  await assert.rejects(() => onedriveSyncRemote(racing, 'lolly-backup/day-4.lolly').put(big, { ifRev: null }), { name: 'SyncConflictError' });
  assert.deepEqual([...graph.files.get('lolly-backup/day-4.lolly')!.bytes], [4]);

  const got = await remote.get();
  assert.equal(got!.bytes.length, big.length);
  assert.equal(got!.bytes[0], 1);
  assert.equal(got!.bytes[big.length - 1], 2);
  assert.equal(got!.meta.rev, latest.rev);
  assert.ok(!graph.files.has('lolly-sync/snapshot.lolly'), 'the slot path, not the default, was written');
});

// ── The shared adapter suite (plans/138 Tier D, WP-S6) ──────────────────────────
// OneDrive paths are plain relative paths under the app folder, the same form
// sync-service slotPath() passes for it.

let conformanceGraph = fakeGraph();
runSyncRemoteConformance('onedriveSyncRemote conformance (fake Graph)', (path) => onedriveSyncRemote(conformanceGraph.fetch, path), {
  preconditions: 'store',
  silent: true,
  setup: () => { withToken(); conformanceGraph = fakeGraph(); },
});

runSyncRemoteConformance('onedriveSyncRemote conformance (live OneDrive)', (path) => onedriveSyncRemote(undefined, path), {
  preconditions: 'store',
  skip: `live OneDrive run: ${OAUTH_LIVE_SKIP}`,
});
