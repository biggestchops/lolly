// SPDX-License-Identifier: MPL-2.0
/**
 * Shared asset roots: the /catalog/packs/<name>/ namespace, the merged asset index
 * and what materializeInto writes for them (plan 252, the shared pack mount).
 *
 * A shared root is how one emoji pack lives in one place and reaches every brand. The
 * cases below pin the three things a consumer depends on: a packs url resolves to the
 * root's own file and can never step outside it, the index a Node reader gets is the
 * brand's entries plus every mounted root's with a collision refused rather than
 * ordered, and a materialized tree carries both as real files. The last pair of cases
 * runs against the profiles this checkout actually mounts, so the repository's own
 * wiring is covered and not only the fixture's.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  allAssetRoots, assetIndexFiles, catalogFile, contentRoots, contentUrlFile, materializeInto,
  readAssetIndex, toolDirs,
} from '../src/content-roots.ts';
import { repoRoot } from '../src/repo-root.ts';

function write(path: string, body: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, body);
}

const json = (value: unknown): string => JSON.stringify(value, null, 2) + '\n';

/**
 * A checkout with two shared asset roots, one of them inside the tool pack the way
 * community/emoji-packs is, plus a profile that mounts neither.
 */
function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'lolly-packs-'));
  write(join(root, 'profiles.json'), json({
    default: 'brand-x',
    profiles: {
      'brand-x': {
        tools: ['community'],
        assets: ['community/emoji-packs', 'extras/sounds'],
        catalog: 'brands/x/catalog',
      },
      bare: { tools: ['community'], catalog: 'brands/x/catalog' },
    },
  }));
  write(join(root, 'community/alpha/tool.json'), json({ id: 'alpha' }));
  write(join(root, 'brands/x/catalog/tools/index.json'), json({ tools: [] }));
  write(join(root, 'brands/x/catalog/assets/index.json'), json({
    version: '1',
    defaultFavourites: ['x/logo'],
    assets: [{ id: 'x/logo', formats: [{ url: '/catalog/assets/logo.svg' }] }],
  }));
  write(join(root, 'brands/x/catalog/assets/logo.svg'), '<svg/>\n');
  write(join(root, 'community/emoji-packs/index.json'), json({
    version: '1',
    assets: [{ id: 'community/emoji/set', formats: [{ url: '/catalog/packs/emoji-packs/set.json' }] }],
  }));
  write(join(root, 'community/emoji-packs/set.json'), '{"glyphs":[]}\n');
  write(join(root, 'extras/sounds/index.json'), json({
    version: '1',
    assets: [{ id: 'community/sounds/ping', formats: [{ url: '/catalog/packs/sounds/ping.wav' }] }],
  }));
  write(join(root, 'extras/sounds/ping.wav'), 'RIFF\n');
  return root;
}

test('a packs url resolves inside the shared root, and a miss is null', () => {
  const root = fixtureRoot();
  try {
    const roots = contentRoots({ root, profile: 'brand-x' });
    assert.deepEqual(roots.assetRoots, [
      { name: 'emoji-packs', dir: join(root, 'community/emoji-packs') },
      { name: 'sounds', dir: join(root, 'extras/sounds') },
    ]);

    assert.equal(
      catalogFile('packs/emoji-packs/set.json', roots),
      join(root, 'community/emoji-packs/set.json'),
    );
    assert.equal(catalogFile('packs/sounds/ping.wav', roots), join(root, 'extras/sounds/ping.wav'));
    // A name no profile mounts is an ordinary catalog path, which is what a
    // materialized tree needs: there the packs really are directories under catalog/.
    assert.equal(
      catalogFile('packs/nobody/x.json', roots),
      join(root, 'brands/x/catalog/packs/nobody/x.json'),
    );
    assert.equal(catalogFile('assets/index.json', roots), join(root, 'brands/x/catalog/assets/index.json'));

    assert.equal(
      contentUrlFile('/catalog/packs/emoji-packs/set.json', roots),
      join(root, 'community/emoji-packs/set.json'),
    );
    assert.equal(contentUrlFile('/catalog/packs/emoji-packs/missing.json', roots), null);
    assert.equal(contentUrlFile('/catalog/packs/nobody/set.json', roots), null);

    // Containment: a `..` is refused, never resolved, and a url carrying one is a
    // miss rather than a file outside the root.
    assert.throws(() => catalogFile('packs/emoji-packs/../../../etc/passwd', roots), /leaves the content root/);
    assert.equal(contentUrlFile('/catalog/packs/emoji-packs/../../../etc/passwd', roots), null);

    // The root sits inside the tool pack, and it is not a tool.
    assert.deepEqual([...toolDirs(roots).keys()], ['alpha']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the asset index is the brand plus every mounted root, in root order', () => {
  const root = fixtureRoot();
  try {
    const roots = contentRoots({ root, profile: 'brand-x' });
    const merged = readAssetIndex(roots);
    assert.deepEqual(merged.assets.map((a) => a.id), ['x/logo', 'community/emoji/set', 'community/sounds/ping']);
    // Every other key the brand index carries survives the merge.
    assert.deepEqual(merged.defaultFavourites, ['x/logo']);
    assert.deepEqual(assetIndexFiles(roots), [
      join(root, 'brands/x/catalog/assets/index.json'),
      join(root, 'community/emoji-packs/index.json'),
      join(root, 'extras/sounds/index.json'),
    ]);

    // A profile that mounts no shared root reads the brand's index unchanged.
    const bare = contentRoots({ root, profile: 'bare' });
    assert.deepEqual(bare.assetRoots, []);
    assert.deepEqual(readAssetIndex(bare).assets.map((a) => a.id), ['x/logo']);

    // Both profiles' roots, deduped, for the build scripts that maintain the files.
    assert.deepEqual(allAssetRoots({ root }).map((a) => a.name), ['emoji-packs', 'sounds']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an id in two places is refused, not resolved by order', () => {
  const root = fixtureRoot();
  try {
    const roots = contentRoots({ root, profile: 'brand-x' });
    write(join(root, 'extras/sounds/index.json'), json({
      version: '1',
      assets: [{ id: 'community/emoji/set', formats: [{ url: '/catalog/packs/sounds/set.json' }] }],
    }));
    assert.throws(() => readAssetIndex(roots), /declared in both/);

    write(join(root, 'extras/sounds/index.json'), json({
      version: '1',
      assets: [{ id: 'x/logo', formats: [{ url: '/catalog/packs/sounds/logo.svg' }] }],
    }));
    assert.throws(() => readAssetIndex(roots), /permanent contract/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a materialized tree carries the packs as files and the merged index', () => {
  const root = fixtureRoot();
  const dest = mkdtempSync(join(tmpdir(), 'lolly-packs-dist-'));
  try {
    const roots = contentRoots({ root, profile: 'brand-x' });
    const brandIndexBefore = readFileSync(join(root, 'brands/x/catalog/assets/index.json'), 'utf8');
    materializeInto(dest, roots);

    assert.equal(readFileSync(join(dest, 'catalog/packs/emoji-packs/set.json'), 'utf8'), '{"glyphs":[]}\n');
    assert.equal(readFileSync(join(dest, 'catalog/packs/sounds/ping.wav'), 'utf8'), 'RIFF\n');
    const written = JSON.parse(readFileSync(join(dest, 'catalog/assets/index.json'), 'utf8')) as {
      assets: { id: string }[];
    };
    assert.deepEqual(written.assets.map((a) => a.id), ['x/logo', 'community/emoji/set', 'community/sounds/ping']);
    // The brand's committed index is not a build output: the merge exists in dist only.
    assert.equal(readFileSync(join(root, 'brands/x/catalog/assets/index.json'), 'utf8'), brandIndexBefore);

    // And the tree reads back as one composed profile, with the packs url still good.
    const packaged = contentRoots({ root: dest });
    assert.equal(packaged.profile, 'materialized');
    assert.deepEqual(packaged.assetRoots, []);
    assert.equal(
      contentUrlFile('/catalog/packs/emoji-packs/set.json', packaged),
      join(dest, 'catalog/packs/emoji-packs/set.json'),
    );
    assert.deepEqual(readAssetIndex(packaged).assets.map((a) => a.id),
      ['x/logo', 'community/emoji/set', 'community/sounds/ping']);
  } finally {
    rmSync(dest, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

/** The profiles this checkout mounts. brands/suse is private, so a public clone has
 *  one of them and this repository has two; either way each mounted profile must
 *  serve the shared pack. */
function mountedProfiles(): string[] {
  const cfg = JSON.parse(readFileSync(join(repoRoot(), 'profiles.json'), 'utf8')) as {
    profiles: Record<string, { tools: string[]; catalog: string; assets?: string[] }>;
  };
  // Tools and catalog only, the way isComplete judges it: a shared asset root is
  // additive, so it is never what makes a profile unresolvable.
  return Object.entries(cfg.profiles)
    .filter(([, p]) => [...p.tools, p.catalog].every((r) => existsSync(join(repoRoot(), r))))
    .map(([name]) => name);
}

test('every mounted profile serves the shared emoji pack from one file', () => {
  const names = mountedProfiles();
  assert.ok(names.length, 'at least one profile is mounted in this checkout');
  for (const profile of names) {
    const roots = contentRoots({ root: repoRoot(), profile });
    assert.ok(
      roots.assetRoots.some((a) => a.name === 'emoji-packs'),
      `${profile} mounts the emoji-packs root`,
    );
    const merged = readAssetIndex(roots);
    const found = merged.assets.filter((a) => a.id === 'community/emoji/twemoji/color');
    assert.equal(found.length, 1, `${profile} lists the pack exactly once`);
    const entry = found[0] as unknown as {
      formats: { url: string }[]; meta?: { emoji?: { glyphs?: number } };
    };
    assert.equal(entry.formats[0]!.url, '/catalog/packs/emoji-packs/twemoji-color.json');
    assert.equal(entry.meta?.emoji?.glyphs, 3953);
    assert.equal(
      contentUrlFile(entry.formats[0]!.url, roots),
      join(repoRoot(), 'community/emoji-packs/twemoji-color.json'),
    );
  }
});

// ── A shared root is additive, never required ───────────────────────────────
// It adds entries to an index that is already complete without it, and a
// deployment may legitimately leave one out: the MCP serverless function excludes
// the 15.7 MB emoji bundle from its trace because it is near its size limit.
// Judging a profile complete on its shared roots would turn that into a throw on
// every content request rather than a listing with one fewer pack in it.

test('a shared root that is not on disk is skipped, not fatal', () => {
  const root = fixtureRoot();
  try {
    rmSync(join(root, 'extras/sounds'), { recursive: true, force: true });
    const roots = contentRoots({ root, profile: 'brand-x' });
    assert.deepEqual(roots.assetRoots, [
      { name: 'emoji-packs', dir: join(root, 'community/emoji-packs') },
    ], 'the absent root is simply not mounted');
    const ids = readAssetIndex(roots).assets.map((a) => a.id);
    assert.deepEqual(ids, ['x/logo', 'community/emoji/set'], 'and the index is the rest of it');
    assert.equal(allAssetRoots({ root }).some((a) => a.name === 'sounds'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a profile with only its bundle file missing still resolves and lists the pack', () => {
  // Exactly the deployed MCP function: index.json is traced, the bundle is not.
  const root = fixtureRoot();
  try {
    rmSync(join(root, 'community/emoji-packs/set.json'));
    const roots = contentRoots({ root, profile: 'brand-x' });
    const ids = readAssetIndex(roots).assets.map((a) => a.id);
    assert.ok(ids.includes('community/emoji/set'), 'the pack is still listed');
    assert.equal(contentUrlFile('/catalog/packs/emoji-packs/set.json', roots), null,
      'and its bytes answer null, which is what a host turns into a placeholder');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a missing pack names a submodule only when it is one', () => {
  const root = fixtureRoot();
  try {
    // A brand pack: the checkout command is the right advice.
    rmSync(join(root, 'brands/x/catalog'), { recursive: true, force: true });
    assert.throws(
      () => contentRoots({ root, profile: 'brand-x' }),
      /git submodule update --init --checkout brands\/x\/catalog/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  const second = fixtureRoot();
  try {
    // A plain directory: `git submodule update` answers "pathspec did not match"
    // and sends the reader looking for a submodule that does not exist.
    rmSync(join(second, 'community'), { recursive: true, force: true });
    assert.throws(() => contentRoots({ root: second, profile: 'brand-x' }), (err: Error) => {
      assert.match(err.message, /is missing: community/);
      assert.equal(err.message.includes('git submodule'), false, err.message);
      return true;
    });
  } finally {
    rmSync(second, { recursive: true, force: true });
  }
});

test('two shared roots with one name are refused even when one is absent', () => {
  const root = mkdtempSync(join(tmpdir(), 'lolly-packs-dup-'));
  try {
    write(join(root, 'profiles.json'), json({
      default: 'dup',
      profiles: {
        dup: { tools: ['community'], assets: ['a/packs', 'b/packs'], catalog: 'brands/x/catalog' },
      },
    }));
    write(join(root, 'community/alpha/tool.json'), json({ id: 'alpha' }));
    write(join(root, 'brands/x/catalog/assets/index.json'), json({ version: '1', assets: [] }));
    write(join(root, 'a/packs/index.json'), json({ version: '1', assets: [] }));
    assert.throws(() => contentRoots({ root, profile: 'dup' }), /two shared asset roots named "packs"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
