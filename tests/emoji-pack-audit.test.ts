// SPDX-License-Identifier: MPL-2.0
/**
 * The bundle audit in scripts/check-emoji-packs.ts, over the absence records a
 * pack entry may carry (plan 253, B3).
 *
 * A set can leave a glyph out. `meta.emoji.missing` is artwork the engine refused
 * because the upstream file is defective; `meta.emoji.withheld` is a glyph left out
 * on purpose, such as one that brings the reference rasteriser down. Both are
 * accepted. What is pinned here is that neither is taken on trust: a row needs a
 * key and a reason, and a key the entry calls absent has to be absent, so an entry
 * can never quietly describe a pack that is not the one on disk.
 *
 * Run directly:  node --test tests/emoji-pack-audit.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditBundle } from '../scripts/check-emoji-packs.ts';

const FIXTURE = new URL('./fixtures/emoji/twemoji/', import.meta.url);

/** One real one-glyph pack, written out as a bundle plus the index entry that registers it. */
async function bundleWith(meta: Record<string, unknown>): Promise<{ bundle: string; index: string }> {
  const manifest = await readFile(new URL('manifest.json', FIXTURE), 'utf8');
  const artwork = { '1f600.svg': await readFile(new URL('1f600.svg', FIXTURE), 'utf8') };
  const checksum = `sha256:${createHash('sha256').update(Buffer.from(manifest, 'utf8')).digest('hex')}`;
  const dir = await mkdtemp(join(tmpdir(), 'lolly-emoji-audit-'));
  const bundle = join(dir, 'pack.json');
  const index = join(dir, 'index.json');
  await writeFile(bundle, JSON.stringify({ schemaVersion: 1, kind: 'emoji-pack-bundle', manifest, artwork }));
  await writeFile(index, JSON.stringify({
    version: '1',
    assets: [{
      id: 'community/emoji/twemoji/color',
      tags: ['emoji-pack'],
      formats: [{ format: 'json', url: '/catalog/packs/emoji-packs/pack.json' }],
      meta: { emoji: { id: 'community/emoji/twemoji/color', version: '17.0.3', checksum, glyphs: 1, ...meta } },
    }],
  }));
  return { bundle, index };
}

test('a pack with no absences audits and reports none', async () => {
  const { bundle, index } = await bundleWith({});
  const report = await auditBundle(bundle, index);
  assert.equal(report.entry, 'checked');
  assert.equal(report.glyphs, 1);
  assert.equal(report.missing, 0);
  assert.equal(report.withheld, 0);
});

test('refused and withheld glyphs are accepted, with their counts', async () => {
  const { bundle, index } = await bundleWith({
    missing: [{ key: '2b1b', file: '2B1B.svg', reason: 'Unsupported SVG attribute characters.' }],
    withheld: [{ key: '1f4e6', file: 'emoji_u1f4e6.svg', reason: 'Crashes the pinned reference rasteriser.' }],
  });
  const report = await auditBundle(bundle, index);
  assert.equal(report.missing, 1);
  assert.equal(report.withheld, 1);
});

test('an absence the pack actually carries is refused', async () => {
  const { bundle, index } = await bundleWith({ missing: [{ key: '1f600', reason: 'Refused upstream.' }] });
  await assert.rejects(auditBundle(bundle, index), /lists 1f600 as missing, but the manifest carries it/);
});

test('an absence with no reason is refused', async () => {
  const { bundle, index } = await bundleWith({ withheld: [{ key: '1f4e6', reason: '   ' }] });
  await assert.rejects(auditBundle(bundle, index), /with no reason/);
});

test('an absence with no key is refused', async () => {
  const { bundle, index } = await bundleWith({ missing: [{ file: '2B1B.svg', reason: 'Defective upstream.' }] });
  await assert.rejects(auditBundle(bundle, index), /needs a key on every row/);
});

test('an absence list that is not a list is refused', async () => {
  const { bundle, index } = await bundleWith({ missing: { key: '2b1b', reason: 'Defective upstream.' } });
  await assert.rejects(auditBundle(bundle, index), /must be a list/);
});
