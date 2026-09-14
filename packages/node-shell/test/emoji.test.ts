// SPDX-License-Identifier: MPL-2.0
/**
 * The Node emoji host against the real shared pack mount on disk: the set it lists, the
 * manifest bytes an exact pin gets, the artwork each glyph checksum names, the refusals
 * for a pin no root holds, and the point of the mount - the same pack is listed on every
 * profile, with no file copied into a brand catalog.
 *
 * Run directly:  node --test packages/node-shell/test/emoji.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EmojiPackPinV1 } from '@lolly-tools/core/emoji-v1';
import { createNodeEmojiAPI } from '../src/emoji.ts';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
/** The shared asset root both profiles mount, not a brand catalog: one pack, one copy. */
const SHARED_INDEX = join(REPO, 'community/emoji-packs/index.json');
const ASSET_ID = 'community/emoji/twemoji/color';
const sha256 = (bytes: Uint8Array | string): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

interface IndexEntry {
  id: string;
  formats?: { format: string; url: string; size?: number }[];
  meta?: { emoji?: { id: string; version: string; checksum: string; glyphs: number } };
}
const shared = JSON.parse(readFileSync(SHARED_INDEX, 'utf8')) as { assets: IndexEntry[] };
const entry = shared.assets.find((asset) => asset.id === ASSET_ID)!;
const entryMeta = entry.meta!.emoji!;
const declaredSize = entry.formats?.find((format) => format.format === 'json')?.size;
const pin: EmojiPackPinV1 = { id: entryMeta.id, pin: { version: entryMeta.version }, checksum: entryMeta.checksum };

// One parser stands in for jsdom: parseXml is the host's to supply, and nothing in
// these tests renders SVG. The jsdom default is exercised by the CLI itself.
// No catalogDir, so this is the resolver's merged index for the active profile - which
// is the whole claim being tested.
const api = await createNodeEmojiAPI({ parseXml: (source) => source });

test('sets() lists the shared pack the profile mounts', async () => {
  const sets = await api.sets();
  const found = sets.find((set) => set.pin.id === ASSET_ID);
  assert.ok(found, 'the shared pack is listed');
  assert.deepEqual(found!.pin, pin);
  assert.equal(found!.family, 'Twemoji');
  assert.equal(found!.glyphs, entryMeta.glyphs);
  assert.equal(found!.coverageComplete, true);
  // `size` is written by pnpm run build:catalog (checksum-assets), so a newly added
  // entry may not carry one yet. Pinned both ways: where the index states a size,
  // sets() reports it, because a shell says how big a download is before it starts.
  assert.equal(found!.bytes, declaredSize);
});

test('manifest() hands back exactly the bytes the pin hashes to', async () => {
  const bytes = await api.manifest(pin);
  assert.ok(bytes);
  assert.equal(sha256(bytes!), pin.checksum);
  const manifest = JSON.parse(new TextDecoder().decode(bytes!)) as { id: string; version: string; glyphs: unknown[] };
  assert.equal(manifest.id, pin.id);
  assert.equal(manifest.version, pin.pin.version);
  assert.equal(manifest.glyphs.length, entryMeta.glyphs);
});

test('a pin no mounted root holds answers null, never a substitute', async () => {
  assert.equal(await api.manifest({ ...pin, pin: { version: '0.0.1' } }), null);
  assert.equal(await api.manifest({ ...pin, checksum: sha256('other') }), null);
  assert.equal(await api.manifest({ ...pin, id: 'community/emoji/openmoji/color' }), null);
});

test('artwork() bytes hash to the checksum the manifest pins for that glyph', async () => {
  const bytes = await api.manifest(pin);
  const manifest = JSON.parse(new TextDecoder().decode(bytes!)) as {
    glyphs: { label: string; asset: { url: string; checksum: string } }[];
  };
  for (const glyph of [manifest.glyphs[0]!, manifest.glyphs[7]!, manifest.glyphs.at(-1)!]) {
    const svg = await api.artwork(pin, glyph.asset as never);
    assert.ok(svg, `artwork for ${glyph.label}`);
    assert.equal(sha256(svg!), glyph.asset.checksum);
    assert.ok(new TextDecoder().decode(svg!).includes('<svg'), 'the glyph is SVG text');
  }
  assert.equal(await api.artwork(pin, { url: 'no-such-file.svg' } as never), null);
});

test('every profile lists the same shared pack, with no copy in either brand', async (t) => {
  // The private SUSE pack is absent from a public clone, so name the skip rather than
  // pass quietly: a green run here would otherwise mean the profile was never resolved.
  if (!existsSync(join(REPO, 'brands/suse/catalog'))) {
    t.skip('brands/suse is not checked out, so the suse profile cannot be resolved here');
    return;
  }
  const before = process.env.LOLLY_PROFILE;
  try {
    for (const profile of ['suse', 'lolly-start']) {
      process.env.LOLLY_PROFILE = profile;
      const resolved = await createNodeEmojiAPI({ parseXml: (source) => source });
      const sets = await resolved.sets();
      const found = sets.find((set) => set.pin.id === ASSET_ID);
      assert.ok(found, `${profile} lists the shared pack`);
      assert.deepEqual(found!.pin, pin, `${profile} lists the same pin, not a copy of its own`);
    }
  } finally {
    if (before === undefined) delete process.env.LOLLY_PROFILE;
    else process.env.LOLLY_PROFILE = before;
  }
  // The bytes live once, outside both brands.
  assert.ok(!existsSync(join(REPO, 'brands/suse/catalog/assets/emoji')));
  assert.ok(!existsSync(join(REPO, 'brands/lolly-start/catalog/assets/emoji')));
});

test('a bundle url that climbs out of the catalog is refused', async () => {
  // The relative part comes off an index entry, so it is data. This is the only
  // place in the module that joins a data field onto a filesystem path.
  const dir = mkdtempSync(join(tmpdir(), 'lolly-emoji-catalog-'));
  mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(join(dir, 'assets/index.json'), JSON.stringify({
    assets: [{ ...entry, formats: [{ format: 'json', url: '/catalog/../../../etc/passwd' }] }],
  }));

  const escaping = await createNodeEmojiAPI({ catalogDir: dir, parseXml: (source) => source });
  assert.deepEqual((await escaping.sets()).map((set) => set.pin.id), [ASSET_ID], 'the entry is still listed');
  assert.equal(await escaping.manifest(pin) === null, true, 'but its bytes are never read from outside the catalog');
  rmSync(dir, { recursive: true, force: true });
});
