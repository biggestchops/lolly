// SPDX-License-Identifier: MPL-2.0
/**
 * The MCP asset listing reads the MERGED index, so an agent on either profile can name
 * the shared emoji pack (plan 252). paths.ts resolves the content roots once per
 * process, so each profile is a child process rather than an env flip mid-run.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RESOURCES = pathToFileURL(fileURLToPath(new URL('../src/resources.ts', import.meta.url))).href;
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const PACK_ID = 'community/emoji/twemoji/color';
const MARKER = '@@ASSETS@@';

const CHILD = [
  "const { readResource } = await import(process.env.PROBE_MOD);",
  "const listing = await readResource('lolly://assets');",
  "process.stdout.write(process.env.PROBE_MARKER + listing.text);",
].join('\n');

interface Listing { count: number; assets: { id: string; type: string; tags: string[] }[] }

function listing(profile: string): Listing {
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', CHILD], {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, LOLLY_PROFILE: profile, PROBE_MOD: RESOURCES, PROBE_MARKER: MARKER },
  });
  const at = run.stdout?.indexOf(MARKER) ?? -1;
  if (at === -1) throw new Error(`lolly://assets on ${profile} produced nothing\n${run.stdout ?? ''}\n${run.stderr ?? ''}`);
  return JSON.parse(run.stdout.slice(at + MARKER.length)) as Listing;
}

function assertListsSharedPack(profile: string): void {
  const found = listing(profile);
  assert.equal(found.count, found.assets.length);
  assert.ok(found.assets.length > 1, `${profile}: the brand's own assets are still listed`);
  const pack = found.assets.filter((asset) => asset.id === PACK_ID);
  assert.equal(pack.length, 1, `${profile}: the shared pack is listed exactly once`);
  assert.equal(pack[0]!.type, 'data');
  assert.ok(pack[0]!.tags.includes('emoji-pack'), `${profile}: the listing carries the tag that makes it a set`);
}

test('lolly://assets lists the shared pack on lolly-start', () => {
  assertListsSharedPack('lolly-start');
});

test('lolly://assets lists the same shared pack on suse', (t) => {
  // The private SUSE pack is absent from a public clone, so name the skip rather than
  // pass quietly: a green run would otherwise mean the profile was never resolved.
  if (!existsSync(`${REPO}brands/suse/catalog`)) {
    t.skip('brands/suse is not checked out, so the suse profile cannot be resolved here');
    return;
  }
  assertListsSharedPack('suse');
});
