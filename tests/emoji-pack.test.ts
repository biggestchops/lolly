// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EMOJI_PACK_MAX_BYTES, EMOJI_ARTWORK_MAX_BYTES, readEmojiPack, inspectEmojiPack, verifyEmojiArtwork, matchesEmojiPack } from '../engine/src/emoji-pack.ts';
import { fixture, fixtureLocks, fixtureRoot, digest, encoded } from './helpers/emoji-fixtures.ts';

test('three real upstream specimens preserve their exact artwork, source notices and independent licence terms', async () => {
  const licences: Record<string, string> = { openmoji: 'CC-BY-SA-4.0', twemoji: 'CC-BY-4.0', noto: 'Apache-2.0' };
  for (const lock of fixtureLocks) {
    const { pack, manifest, artwork } = await fixture(lock.directory);
    assert.equal(manifest.source.license, licences[lock.directory]);
    assert.equal(manifest.glyphs[0]!.source.license, licences[lock.directory]);
    assert.equal(manifest.glyphs[0]!.sourceChecksum, digest(artwork));
    assert.ok(matchesEmojiPack(pack, lock.pin));
    const verified = await verifyEmojiArtwork(pack, { kind: 'unicode', key: '1f600' }, artwork);
    assert.ok(verified.ok);
    assert.deepEqual(verified.bytes, new Uint8Array(artwork));
    for (const [name, info] of Object.entries(lock.files)) assert.equal(digest(await readFile(new URL(`${lock.directory}/${name}`, fixtureRoot))), info.checksum, name);
    for (const notice of manifest.notices) {
      const local = notice.name === 'Apache-2.0.txt' ? 'Apache-2.0.txt' : 'LICENSE.txt';
      assert.equal(notice.text, await readFile(new URL(`${lock.directory}/${local}`, fixtureRoot), 'utf8'));
    }
  }
});

test('manifest identity, UTF-8 and bounded input fail atomically', async () => {
  const { bytes, lock } = await fixture();
  const wrongBytes = new Uint8Array(bytes); wrongBytes[0] = wrongBytes[0]! ^ 1;
  const badUtf8 = Uint8Array.of(0xff);
  const cases = [
    await readEmojiPack(wrongBytes, lock.pin),
    await readEmojiPack(bytes, { ...lock.pin, id: 'community/emoji/wrong/color' }),
    await readEmojiPack(badUtf8, { ...lock.pin, checksum: digest(badUtf8) }),
    await readEmojiPack(new Uint8Array(EMOJI_PACK_MAX_BYTES + 1), lock.pin),
    await readEmojiPack(bytes, { ...lock.pin, pin: { version: 'latest' } }),
  ];
  assert.deepEqual(cases.map(result => result.ok ? 'unexpected-success' : result.issue.code), ['integrity-mismatch', 'integrity-mismatch', 'invalid-pack', 'invalid-pack', 'invalid-pack']);
});

test('canonical meanings, immutable pins, finite metrics and supported readers are admission requirements', async () => {
  const { manifest } = await fixture();
  const mutations: ((value: typeof manifest) => void)[] = [
    value => value.glyphs.push(structuredClone(value.glyphs[0]!)),
    value => { value.glyphs[0]!.meaning = { kind: 'unicode', key: '2764' }; },
    value => { value.glyphs[0]!.meaning = { kind: 'unicode', key: '1f600-200d' }; },
    value => { value.glyphs[0]!.asset.pin.version = 'HEAD'; },
    value => { value.glyphs[0]!.viewBox[2] = 0; },
    value => { value.metrics.advance = Infinity; },
    value => { value.glyphs[0]!.source.sourceUrl = 'https://name:secret@example.test/art'; },
    value => { Object.assign(value, { minimumReader: 2 }); },
    value => { Object.assign(value, { unicodeVersion: '99.0' }); },
    value => { Object.assign(value, { unexpected: true }); },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(manifest); mutate(copy);
    const { bytes, pin } = encoded(copy);
    assert.equal((await readEmojiPack(bytes, pin)).ok, false);
  }
});

test('owned byte and manifest snapshots resist mutation during asynchronous verification', async () => {
  const { bytes, lock, artwork } = await fixture();
  const callerBytes = Buffer.from(bytes), callerPin = structuredClone(lock.pin);
  const pending = readEmojiPack(callerBytes, callerPin);
  callerBytes.fill(0); callerPin.pin.version = 'changed';
  const result = await pending;
  assert.ok(result.ok);
  const inspection = inspectEmojiPack(result.pack)!;
  inspection.glyphs[0]!.asset.checksum = 'changed';
  assert.notEqual(inspectEmojiPack(result.pack)!.glyphs[0]!.asset.checksum, 'changed');
  const input = Buffer.from(artwork);
  const pendingArtwork = verifyEmojiArtwork(result.pack, { kind: 'unicode', key: '1f600' }, input);
  input.fill(0);
  const verified = await pendingArtwork;
  assert.ok(verified.ok);
  assert.equal(digest(verified.bytes), digest(artwork));
  const fake = { ...result.pack };
  assert.equal(matchesEmojiPack(fake, lock.pin), false);
  assert.equal(inspectEmojiPack(fake), null);
  assert.equal((await verifyEmojiArtwork(fake, { kind: 'unicode', key: '1f600' }, artwork)).ok, false);
});

test('missing, oversized and changed artwork never passes a matching manifest alone', async () => {
  const { pack, artwork } = await fixture();
  const changed = new Uint8Array(artwork); changed[0] = changed[0]! ^ 1;
  for (const bytes of [new Uint8Array(), new Uint8Array(EMOJI_ARTWORK_MAX_BYTES + 1), changed]) {
    assert.equal((await verifyEmojiArtwork(pack, { kind: 'unicode', key: '1f600' }, bytes)).ok, false);
  }
  assert.equal((await verifyEmojiArtwork(pack, { kind: 'unicode', key: '1f601' }, artwork)).ok, false);
});

test('published SDK schema mirrors are byte-identical to the engine schemas', async () => {
  for (const name of ['emoji-pack-v1', 'emoji-style-v1']) {
    const root = await readFile(new URL(`../schemas/${name}.schema.json`, import.meta.url));
    const sdk = await readFile(new URL(`../packages/core/schema/${name}.schema.json`, import.meta.url));
    assert.deepEqual(sdk, root);
  }
});
