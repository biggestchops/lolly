// SPDX-License-Identifier: MPL-2.0
/**
 * The dev server's answer for /catalog/assets/index.json: the MERGED asset index.
 *
 * A shared asset root (community/emoji-packs, plan 252) holds a pack once, outside every
 * brand catalog, and each profile in profiles.json mounts it. dist/ gets the merged file
 * written by materializeInto at closeBundle; in dev there is no such file, so
 * serve-repo-static assembles it per request. This drives the REAL middleware off the
 * real config - not a transcription of it - in a child process per profile, because the
 * resolver picks the profile once per process from LOLLY_PROFILE.
 *
 * The validators are tested too. catalog/sync.ts stores what it is given and sends it
 * back next time, so a merged body with no validator would re-download the whole index
 * on every reload of the app. The ETag is the one that has to decide: the body depends
 * on the resolved profile as well as on the files, and the shared pack's index.json is
 * the newest input on both profiles, so a date alone answers 304 across a profile
 * switch and leaves the browser holding the other brand's catalog.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CONFIG = pathToFileURL(fileURLToPath(new URL('../vite.config.js', import.meta.url))).href;
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const PACK_ID = 'community/emoji/twemoji/color';
const MARKER = '@@PROBE@@';

interface Probe {
  status: number;
  headers: Record<string, string>;
  body: string;
  nexted: boolean;
}

/** The child: build the plugin from the real default export, take the middleware it
 *  registers, and run one fake request through it. Written as source lines rather than
 *  a fixture file so what is under test stays the shipping config. */
const CHILD = [
  "const { default: config } = await import(process.env.PROBE_CONFIG);",
  "const plugin = config.plugins.find((p) => p && p.name === 'serve-repo-static');",
  "if (!plugin) throw new Error('no serve-repo-static plugin in the config');",
  "let handler = null;",
  "plugin.configureServer({ middlewares: { use(fn) { handler = fn; } } });",
  "if (!handler) throw new Error('serve-repo-static registered no middleware');",
  "const res = {",
  "  statusCode: 200, headers: {}, body: '',",
  "  setHeader(name, value) { this.headers[String(name).toLowerCase()] = String(value); },",
  "  end(chunk) { this.body = chunk === undefined ? '' : Buffer.from(chunk).toString('utf8'); },",
  "};",
  "const req = { url: '/catalog/assets/index.json', headers: JSON.parse(process.env.PROBE_HEADERS) };",
  "let nexted = false;",
  "await handler(req, res, () => { nexted = true; });",
  "const out = { status: res.statusCode, headers: res.headers, body: res.body, nexted };",
  "process.stdout.write(process.env.PROBE_MARKER + JSON.stringify(out));",
].join('\n');

function probe(profile: string, headers: Record<string, string> = {}): Probe {
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', CHILD], {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      LOLLY_PROFILE: profile,
      PROBE_CONFIG: CONFIG,
      PROBE_HEADERS: JSON.stringify(headers),
      PROBE_MARKER: MARKER,
    },
  });
  const at = run.stdout?.indexOf(MARKER) ?? -1;
  if (at === -1) {
    throw new Error(`probe(${profile}) produced no result\n${run.stdout ?? ''}\n${run.stderr ?? ''}`);
  }
  return JSON.parse(run.stdout.slice(at + MARKER.length)) as Probe;
}

function assertServesSharedPack(answer: Probe, profile: string): void {
  assert.equal(answer.nexted, false, `${profile}: the middleware answered rather than falling through`);
  assert.equal(answer.status, 200);
  assert.equal(answer.headers['content-type'], 'application/json');
  // Heuristic freshness is what a Last-Modified without this would switch on, and a
  // held-back index in dev is a bug that looks like a stale brand.
  assert.equal(answer.headers['cache-control'], 'no-cache');
  assert.ok(Number.isFinite(Date.parse(answer.headers['last-modified'] ?? '')), `${profile}: a parseable Last-Modified`);
  const index = JSON.parse(answer.body) as { assets: { id: string }[] };
  assert.ok(Array.isArray(index.assets) && index.assets.length > 0, `${profile}: the brand entries are still there`);
  const ids = index.assets.map((asset) => asset.id);
  assert.ok(ids.includes(PACK_ID), `${profile}: the shared pack is in the served index`);
  assert.equal(ids.filter((id) => id === PACK_ID).length, 1, `${profile}: listed once, not once per root`);
}

test('the dev server serves the shared pack in the lolly-start asset index', () => {
  assertServesSharedPack(probe('lolly-start'), 'lolly-start');
});

test('the dev server serves the same shared pack in the suse asset index', (t) => {
  // The private SUSE pack is absent from a public clone, so name the skip rather than
  // pass quietly: a green run would otherwise mean the profile was never resolved.
  if (!existsSync(`${REPO}brands/suse/catalog`)) {
    t.skip('brands/suse is not checked out, so the suse profile cannot be resolved here');
    return;
  }
  assertServesSharedPack(probe('suse'), 'suse');
});

test('a conditional request is answered 304, an older validator is not', () => {
  const first = probe('lolly-start');
  const lastModified = first.headers['last-modified']!;

  const unchanged = probe('lolly-start', { 'if-modified-since': lastModified });
  assert.equal(unchanged.status, 304);
  assert.equal(unchanged.body, '', 'a 304 carries no body');
  assert.equal(unchanged.headers['last-modified'], lastModified);

  const stale = probe('lolly-start', { 'if-modified-since': new Date(Date.parse(lastModified) - 60_000).toUTCString() });
  assert.equal(stale.status, 200, 'a validator older than the newest input gets the whole index');
  assert.ok(JSON.parse(stale.body).assets.length > 0);
});

test('the ETag answers 304, and a tag from another catalog does not', () => {
  const first = probe('lolly-start');
  const etag = first.headers.etag!;
  assert.match(etag, /^"[0-9a-f]{32}"$/, 'a strong tag, the same on every read of the same inputs');
  assert.equal(probe('lolly-start').headers.etag, etag, 'and stable across requests');

  const unchanged = probe('lolly-start', { 'if-none-match': etag });
  assert.equal(unchanged.status, 304);
  assert.equal(unchanged.body, '');

  // If-None-Match decides; a date that would otherwise have said 304 does not
  // rescue a tag that does not match. This is what makes a profile switch a miss.
  const other = probe('lolly-start', {
    'if-none-match': '"0123456789abcdef0123456789abcdef"',
    'if-modified-since': first.headers['last-modified']!,
  });
  assert.equal(other.status, 200, 'a tag that does not match gets the whole index');
  assert.ok(JSON.parse(other.body).assets.length > 0);
});

test('a profile switch is a miss, even though both profiles share the newest input', (t) => {
  if (!existsSync(`${REPO}brands/suse/catalog`)) {
    t.skip('brands/suse is not checked out, so there is no second profile to switch to');
    return;
  }
  const start = probe('lolly-start');
  const suse = probe('suse');
  // The shared pack's index.json is the newest input on both, so the DATE is the
  // same. That is exactly the trap: restarting the dev server on the other profile
  // used to answer 304 and leave the browser on the wrong catalog.
  assert.notEqual(start.headers.etag, suse.headers.etag, 'the tag covers the profile, not just the files');

  const crossed = probe('suse', { 'if-none-match': start.headers.etag! });
  assert.equal(crossed.status, 200, 'the other profile\'s tag is a miss');
  const ids = (JSON.parse(crossed.body) as { assets: { id: string }[] }).assets.map((a) => a.id);
  assert.ok(ids.includes(PACK_ID), 'and the body it serves is the suse catalog, pack included');

  const dateOnly = probe('suse', { 'if-modified-since': start.headers['last-modified']! });
  assert.equal(dateOnly.headers.etag, suse.headers.etag,
    'a date-only conditional still carries the tag, so the next sync has one to send');
});
