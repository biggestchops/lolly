// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { compileEmojiLine } from '../engine/src/emoji-line.ts';
import { emojiSourceIngredients, emojiCreditsText, emojiRightsRecord, emojiSourceModifications, emojiWorksAndUses } from '../engine/src/emoji-rights.ts';
import { emojiLineFixture } from './helpers/emoji-render.ts';
import { fixtureLocks } from './helpers/emoji-fixtures.ts';

test('every compiled specimen yields one componentOf source ingredient that binds the original bytes', async () => {
  for (const lock of fixtureLocks) {
    const input = await emojiLineFixture(lock.directory);
    const result = await compileEmojiLine(input.options, [input.pack], input.host);
    assert.ok(result.ok, result.ok ? '' : result.message);
    const [census] = result.master.sources;
    assert.equal(census!.family, input.manifest.family);
    assert.equal(census!.style, input.manifest.style);
    assert.equal(census!.label, 'grinning face');
    assert.equal(census!.assetId, input.manifest.glyphs[0]!.asset.id);
    const [ing] = emojiSourceIngredients(result.master.sources);
    assert.equal(ing!.credential, 'none');
    assert.equal(ing!.relationship, 'componentOf');
    assert.equal(ing!.format, 'image/svg+xml');
    assert.equal(ing!.title, `grinning face (${input.manifest.family} ${input.manifest.style} ${lock.pin.pin.version})`);
    assert.equal(ing!.url, input.manifest.glyphs[0]!.source.sourceUrl);
    assert.equal(ing!.hash!.length, 32);
    assert.equal(ing!.instanceId, `${input.manifest.glyphs[0]!.asset.id}@${lock.pin.pin.version}`);
    assert.equal(ing!.informationalUri, input.manifest.source.licenseUrl);
    assert.deepEqual(ing!.rights, emojiRightsRecord(census!));
    assert.equal(ing!.rights!.license, input.manifest.source.license);
    assert.equal(ing!.rights!.sourceHash, census!.sourceChecksum);
    assert.equal(ing!.rights!.usedHash, census!.canonicalChecksum);
    assert.notEqual(ing!.rights!.sourceHash, ing!.rights!.usedHash, 'normalized bytes differ from the source, and the record says so');
    assert.deepEqual(ing!.rights!.modifications, emojiSourceModifications(census!));
    assert.ok(ing!.rights!.modifications.length >= 2, 'the normalization changes are declared as modifications');
    assert.match(ing!.description!, new RegExp(`Licence: ${input.manifest.source.license.replaceAll('.', '\\.')} <`));
    assert.match(ing!.description!, /Changes: /);
  }
});

test('readable credits name the work, creator, set, licence, source and changes', async () => {
  const input = await emojiLineFixture('twemoji');
  const result = await compileEmojiLine(input.options, [input.pack], input.host);
  assert.ok(result.ok);
  const credits = emojiCreditsText(result.master.sources);
  assert.equal(credits.split('\n').length, 1);
  assert.match(credits, /^"grinning face" by Twitter, Inc\. and other contributors \(Twemoji Color 17\.0\.3\), used 2 times\. /);
  assert.match(credits, /CC-BY-4\.0: https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/\. Source: https:\/\/raw\.githubusercontent\.com\//);
  assert.match(credits, /Changes: Canonicalized SVG syntax/);
  assert.equal(emojiCreditsText([]), '');
});

test('a census with a malformed checksum cannot become an ingredient', async () => {
  const input = await emojiLineFixture('twemoji');
  const result = await compileEmojiLine(input.options, [input.pack], input.host);
  assert.ok(result.ok);
  const broken = structuredClone(result.master.sources);
  broken[0]!.sourceChecksum = 'sha256:not-hex';
  assert.throws(() => emojiSourceIngredients(broken), /not a sha256 checksum/);
});

test('a glyph the treatment left alone is not reported as recoloured', async () => {
  // `applyEmojiTreatment` hands the artwork back untouched and records no change
  // for a protected meaning (every flag, every skin-toned sequence) and for a
  // palette too small for the mode. A census keyed on the style that was ASKED
  // for would tell the evaluator a byte-identical flag was recoloured, and the
  // evaluator would ask for an adaptation licence for a use that needs none.
  const input = await emojiLineFixture('openmoji');
  const result = await compileEmojiLine(input.options, [input.pack], input.host);
  assert.ok(result.ok, result.ok ? '' : result.message);

  const untouched = structuredClone(result.master.sources);
  untouched[0]!.changes = untouched[0]!.changes.filter((change) => !change.startsWith('Recoloured every paint'));
  assert.deepEqual(emojiWorksAndUses(untouched).uses[0]!.operations, ['placed']);

  const recoloured = structuredClone(result.master.sources);
  recoloured[0]!.changes = [...untouched[0]!.changes, 'Recoloured every paint with emoji-treatment-v1 in snap mode.'];
  assert.deepEqual(emojiWorksAndUses(recoloured).uses[0]!.operations, ['placed', 'recoloured']);
});
