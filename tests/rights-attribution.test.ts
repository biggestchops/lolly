// SPDX-License-Identifier: MPL-2.0
/**
 * Attribution delivery (plan 253): the readable credits, the companion files,
 * the source ingredients built from portable work records, and the receipt.
 * The receipt is measured against a REAL stamped file - a pinned Twemoji
 * specimen compiled by the engine's line compiler, rasterised, stamped through
 * embedC2pa and read back with verifyC2pa - so `readback-confirmed` means a
 * reader found the credit, never that the writer intended to include one.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { Resvg } from '@resvg/resvg-js';
import type { CreativeUseV1, CreativeWorkRecordV1, UseContextV1 } from '../packages/core/src/rights-v1.ts';
import { embedC2pa, exportActionSteps } from '../engine/src/c2pa.ts';
import { verifyC2pa } from '../engine/src/c2pa-verify.ts';
import type { C2paReport } from '../engine/src/c2pa-verify.ts';
import { compileEmojiLine } from '../engine/src/emoji-line.ts';
import type { EmojiLineMaster } from '../engine/src/emoji-line.ts';
import { emojiSourceIngredients } from '../engine/src/emoji-rights.ts';
import { attributionCompanion, attributionCredits, checkAttributionReadback, sourceIngredientsFor } from '../engine/src/rights-attribution.ts';
import type { SourceDetailV1 } from '../engine/src/rights-attribution.ts';
import { evaluateCreativeUses } from '../engine/src/rights-evaluate.ts';
import { emojiLineFixture } from './helpers/emoji-render.ts';

const DATES = { notBefore: new Date(Date.now() - 60_000), notAfter: new Date(Date.now() + 86_400_000) };
const CLAIM = { claimGenerator: 'Lolly lolly.tools', generatorInfo: { name: 'Lolly', version: 'test' }, dates: DATES };
const CONTEXT: UseContextV1 = {
  operation: 'render',
  delivery: { format: 'png', route: 'file-with-c2pa', canCarryCredential: true, canCarryReadableCredit: true },
  audience: 'shared',
};

/** The emoji census as portable records, which is what stage E2 will produce for the runtime. */
function censusRecords(master: EmojiLineMaster): { works: CreativeWorkRecordV1[]; uses: CreativeUseV1[]; details: Record<string, SourceDetailV1> } {
  const works: CreativeWorkRecordV1[] = [];
  const uses: CreativeUseV1[] = [];
  const details: Record<string, SourceDetailV1> = {};
  for (const source of master.sources) {
    const id = source.assetId;
    works.push({
      id,
      title: `${source.label} (${source.family} ${source.style} ${source.pack.pin.version})`,
      creators: [{ name: source.source.creator, role: 'creator' }],
      sourceUrl: source.source.sourceUrl,
      revision: source.source.revision,
      sourceHash: source.sourceChecksum,
      rights: [{ declaration: source.source.license, url: source.source.licenseUrl, assertedBy: 'catalog', evidence: 'manifest', status: 'parsed' }],
    });
    uses.push({
      work: id,
      pin: { id: source.assetId, version: source.pack.pin.version, checksum: source.canonicalChecksum },
      role: 'incorporated',
      operations: ['placed'],
      scope: { count: source.occurrences.length },
    });
    details[id] = {
      format: 'image/svg+xml',
      attribution: source.source.attribution,
      modifications: [...source.source.modifications, ...source.changes],
    };
  }
  return { works, uses, details };
}

async function specimen(name: string): Promise<{ master: EmojiLineMaster; png: Uint8Array }> {
  const input = await emojiLineFixture(name);
  const result = await compileEmojiLine(input.options, [input.pack], input.host);
  assert.ok(result.ok, result.ok ? '' : result.message);
  const png = new Uint8Array(new Resvg(result.master.svg, { font: { loadSystemFonts: false } }).render().asPng());
  return { master: result.master, png };
}

test('the ingredients built from portable records are the ones the emoji census already writes', async () => {
  const { master } = await specimen('twemoji');
  const { works, uses, details } = censusRecords(master);
  assert.deepEqual(sourceIngredientsFor(works, uses, details), emojiSourceIngredients(master.sources));
});

test('a font rendering text and a work only pointed at are not ingredients of the output', () => {
  const work: CreativeWorkRecordV1 = {
    id: 'example/example-sans',
    title: 'Example Sans',
    creators: [{ name: 'Example Type Foundry', role: 'creator' }],
    sourceUrl: 'https://example.org/example-sans.ttf',
    sourceHash: `sha256:${'a'.repeat(64)}`,
    rights: [{ declaration: 'OFL-1.1', url: 'https://openfontlicense.org/open-font-license-official-text/', assertedBy: 'catalog', evidence: 'notice-file', status: 'parsed' }],
  };
  assert.deepEqual(sourceIngredientsFor([work], [{ work: work.id, role: 'runtime', operations: ['placed'] }]), []);
  assert.deepEqual(sourceIngredientsFor([work], [{ work: work.id, role: 'reference', operations: ['placed'] }]), []);
  // Neither is a redistributed source file nor a transformation input. This
  // writer records `componentOf` (the output is composed of it) and `parentOf`
  // (the output derives from it); a computational input is `inputTo` in C2PA 2.4
  // and is not written here, and a source file carried beside the output is not
  // part of it. Recording either as constituent art would be a false statement
  // about what the picture is made of, so neither becomes an ingredient.
  assert.deepEqual(sourceIngredientsFor([work], [{ work: work.id, role: 'source-distribution', operations: ['placed'] }]), []);
  assert.deepEqual(sourceIngredientsFor([work], [{ work: work.id, role: 'transformation', operations: ['placed'] }]), []);
  const placed = sourceIngredientsFor([work], [{ work: work.id, role: 'incorporated', operations: ['placed'] }]);
  assert.equal(placed.length, 1);
  assert.equal(placed[0]?.relationship, 'componentOf');
  assert.equal(placed[0]?.format, 'font/ttf', 'the media type is read from the source locator when no caller supplied one');
});

test('an incomplete work record loses its own ingredient, never the whole credential', async () => {
  // The writer binds a source with a url AND a hash together, and refuses an
  // empty rights field. An ingredient it would reject must not be built: the
  // stamp would throw and the export would ship with no Content Credential at
  // all, every other source with it.
  const noHash: CreativeWorkRecordV1 = {
    id: 'example/river',
    title: 'River Illustration',
    creators: [{ name: 'Example Artist', role: 'creator' }],
    sourceUrl: 'https://example.org/river.svg',
    rights: [{ declaration: 'CC-BY-4.0', url: 'https://creativecommons.org/licenses/by/4.0/', assertedBy: 'catalog', evidence: 'catalog-entry', status: 'parsed' }],
  };
  const use: CreativeUseV1 = { work: noHash.id, role: 'incorporated', operations: ['placed'] };
  const unbound = sourceIngredientsFor([noHash], [use]);
  assert.equal(unbound.length, 1);
  assert.equal(unbound[0]?.url, undefined, 'no locator without the hash that binds it');
  assert.equal(unbound[0]?.hash, undefined);
  assert.equal(unbound[0]?.rights, undefined, 'a rights record the writer would refuse is left off');

  const hashed: CreativeWorkRecordV1 = { ...noHash, sourceHash: `sha256:${'1'.repeat(64)}` };
  const noAttribution = sourceIngredientsFor([hashed], [use]);
  assert.equal(noAttribution[0]?.rights, undefined, 'an empty attribution sentence is never sent as an empty string');

  // Both really do reach the writer without taking the export down.
  const png = new Uint8Array((await specimen('twemoji')).png);
  for (const ingredients of [unbound, noAttribution]) {
    const out = await embedC2pa(png, 'png', { ...CLAIM, title: 'Incomplete source', actions: exportActionSteps('png', {}), ingredients });
    assert.equal((await verifyC2pa(out)).state, 'valid');
  }

  // And the plan still names the work, so the receipt reports one source that is
  // not in the file rather than an export that quietly lost its credentials.
  const evaluation = evaluateCreativeUses({ works: [hashed], uses: [use], context: CONTEXT });
  assert.deepEqual(evaluation.plan.required.map((notice) => notice.work), ['example/river']);
});

test('a locator a credit would print is an ordinary public address or nothing', () => {
  const hostile: CreativeWorkRecordV1 = {
    id: 'example/hostile',
    title: 'Hostile Record',
    creators: [{ name: 'Example Artist', role: 'creator' }],
    sourceUrl: 'file:///Users/andy/Private/receipts/invoice-4821.pdf',
    sourceHash: `sha256:${'9'.repeat(64)}`,
    rights: [{ declaration: 'CC-BY-4.0', url: 'javascript:alert(1)', assertedBy: 'exporter', evidence: 'native-metadata', status: 'parsed' }],
  };
  const evaluation = evaluateCreativeUses({ works: [hostile], uses: [{ work: hostile.id, role: 'incorporated', operations: ['placed'] }], context: CONTEXT });
  const credits = attributionCredits(evaluation.plan);
  assert.doesNotMatch(credits, /javascript:/);
  assert.doesNotMatch(credits, /file:\/\//);
  assert.doesNotMatch(credits, /invoice-4821/);
  assert.equal(evaluation.plan.required[0]?.sourceUrl, undefined);
  // A reviewed licence carries its own link, so the credit prints that rather
  // than whatever the record claimed the licence page was.
  assert.equal(evaluation.plan.required[0]?.licenceUrl, 'https://creativecommons.org/licenses/by/4.0/');
  const ingredient = sourceIngredientsFor([hostile], [{ work: hostile.id, role: 'incorporated', operations: ['placed'] }])[0];
  assert.equal(ingredient?.url, undefined);
  assert.equal(ingredient?.informationalUri, undefined);
});

test('the credits read as one line per required source, with courtesy credits under their own heading', () => {
  const river: CreativeWorkRecordV1 = {
    id: 'example/river',
    title: 'River Illustration',
    creators: [{ name: 'Example Artist', role: 'creator' }],
    sourceUrl: 'https://example.org/river.svg',
    sourceHash: `sha256:${'1'.repeat(64)}`,
    rights: [{ declaration: 'CC-BY-4.0', url: 'https://creativecommons.org/licenses/by/4.0/', assertedBy: 'catalog', evidence: 'catalog-entry', status: 'parsed' }],
  };
  const photo: CreativeWorkRecordV1 = {
    id: 'example/photo',
    title: 'Public Domain Photo',
    creators: [{ name: 'Example Photographer', role: 'creator' }],
    sourceUrl: 'https://example.org/photo.jpg',
    sourceHash: `sha256:${'2'.repeat(64)}`,
    rights: [{ declaration: 'CC0-1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/', assertedBy: 'catalog', evidence: 'catalog-entry', status: 'parsed' }],
  };
  const apache: CreativeWorkRecordV1 = {
    id: 'example/icon',
    title: 'Example Icon',
    creators: [{ name: 'Example Org', role: 'creator' }],
    sourceUrl: 'https://example.org/icon.svg',
    sourceHash: `sha256:${'3'.repeat(64)}`,
    rights: [{ declaration: 'Apache-2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0', copyright: 'Copyright 2023 Example Org', notices: ['Example Icon Set\nCopyright 2023 Example Org'], assertedBy: 'catalog', evidence: 'notice-file', status: 'parsed' }],
  };
  const { plan } = evaluateCreativeUses({
    works: [river, photo, apache],
    uses: [river, photo, apache].map((work) => ({ work: work.id, role: 'incorporated' as const, operations: ['placed' as const] })),
    context: CONTEXT,
  });
  const credits = attributionCredits(plan);
  assert.equal(credits.split('\n\n').length, 3, 'required lines, then the notices, then the courtesy credits');
  assert.match(credits, /^"Example Icon" by Example Org, Copyright 2023 Example Org, Apache License 2\.0 /);
  assert.match(credits, /"River Illustration" by Example Artist, CC BY 4\.0 https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/, source https:\/\/example\.org\/river\.svg, unchanged\./);
  assert.match(credits, /Notices that travel with this work\nExample Icon Set\nCopyright 2023 Example Org/);
  assert.match(credits, /Credits offered as a courtesy\n"Public Domain Photo" by Example Photographer, CC0 1\.0 /);

  const companion = attributionCompanion(plan);
  assert.deepEqual(companion.files.map((file) => file.name), ['CREDITS.txt', 'credits.json']);
  assert.equal(companion.files[0]?.text, `${credits}\n`);
  const data = JSON.parse(companion.files[1]!.text) as { required: { work: string }[]; optional: { work: string }[]; rulesVersion: string };
  assert.deepEqual(data.required.map((notice) => notice.work), ['example/icon', 'example/river']);
  assert.deepEqual(data.optional.map((notice) => notice.work), ['example/photo']);
  assert.equal(data.rulesVersion, plan.rulesVersion);
  assert.equal(companion.files[1]?.text, attributionCompanion(plan).files[1]?.text, 'the companion JSON is the same bytes every time');
});

test('a real stamped file reads back confirmed, and a file missing the source does not', async () => {
  const { master, png } = await specimen('twemoji');
  const { works, uses, details } = censusRecords(master);
  const evaluation = evaluateCreativeUses({ works, uses, context: CONTEXT });
  assert.equal(evaluation.status, 'ready');
  assert.equal(evaluation.plan.required.length, 1);

  const ingredients = sourceIngredientsFor(works, uses, details);
  const out = await embedC2pa(png, 'png', { ...CLAIM, title: 'Emoji line', actions: exportActionSteps('png', {}), ingredients });
  const report = await verifyC2pa(out);
  assert.equal(report.state, 'valid');
  const outputHash = `sha256:${createHash('sha256').update(out).digest('hex')}`;

  const receipt = checkAttributionReadback(evaluation.plan, report, outputHash, evaluation.fingerprint);
  assert.equal(receipt.state, 'readback-confirmed');
  assert.equal(receipt.fingerprint, evaluation.fingerprint);
  assert.equal(receipt.outputHash, outputHash);
  assert.deepEqual(receipt.expected, [works[0]!.id]);
  assert.deepEqual(receipt.observed, [works[0]!.id]);
  assert.deepEqual(receipt.remaining, []);
  assert.deepEqual(receipt.checks.filter((check) => !check.ok), []);
  assert.equal(receipt.credits, attributionCredits(evaluation.plan));
  assert.match(receipt.credits, /CC BY 4\.0 https:\/\/creativecommons\.org\/licenses\/by\/4\.0\//);

  // The same plan against a file that does not carry the source: written, with
  // the missing source named, and never confirmed.
  const stripped: C2paReport = { ...report, ingredients: [] };
  const tampered = checkAttributionReadback(evaluation.plan, stripped, outputHash, evaluation.fingerprint);
  assert.equal(tampered.state, 'written');
  assert.deepEqual(tampered.observed, []);
  assert.deepEqual(tampered.remaining.map((issue) => issue.code), ['credential.ingredient-missing']);
  assert.equal(tampered.remaining[0]?.work, works[0]!.id);
  assert.equal(tampered.checks.find((check) => check.name === 'sources.expected')?.ok, false);

  // A source that is present but recorded under a different licence is also not confirmed.
  const relabelled: C2paReport = {
    ...report,
    ingredients: report.ingredients!.map((record) => ({ ...record, rights: { ...record.rights!, license: 'CC0-1.0' } })),
  };
  const wrongLicence = checkAttributionReadback(evaluation.plan, relabelled, outputHash, evaluation.fingerprint);
  assert.equal(wrongLicence.state, 'written');
  assert.match(wrongLicence.remaining[0]?.summary ?? '', /read back differently/);

  // No credential at all: the plan still has its credits, and nothing claims delivery.
  const none: C2paReport = { found: false, state: 'none', trusted: false, madeWithLolly: false, likelyMadeWithLolly: false, partsMadeWithLolly: false, delivered: false, format: null, checks: [] };
  const unstamped = checkAttributionReadback(evaluation.plan, none, outputHash, evaluation.fingerprint);
  assert.equal(unstamped.state, 'written');
  assert.equal(unstamped.checks.find((check) => check.name === 'credential.found')?.ok, false);
});

test('a file whose credential did not verify never reads as confirmed', async () => {
  const { master, png } = await specimen('twemoji');
  const { works, uses, details } = censusRecords(master);
  const evaluation = evaluateCreativeUses({ works, uses, details, context: CONTEXT });
  const out = await embedC2pa(png, 'png', { ...CLAIM, title: 'Emoji line', actions: exportActionSteps('png', {}), ingredients: sourceIngredientsFor(works, uses, details) });

  // One byte flipped inside the image data: the ingredient still parses, the
  // binding does not hold. Plan 253 section 9.1 says an invalid credential's
  // rights text is an untrusted assertion, so it cannot fulfil a promise.
  const tampered = new Uint8Array(out);
  const idat = findMarker(tampered, 'IDAT');
  tampered[idat + 8] = tampered[idat + 8]! ^ 0xff;
  const broken = await verifyC2pa(tampered);
  assert.equal(broken.state, 'invalid');
  assert.ok((broken.ingredients ?? []).length > 0, 'the ingredient is still readable, which is the trap');

  const receipt = checkAttributionReadback(evaluation.plan, broken, outputHash(tampered), evaluation.fingerprint);
  assert.equal(receipt.state, 'written');
  assert.deepEqual(receipt.observed, []);
  assert.equal(receipt.checks.find((check) => check.name === 'credential.found')?.ok, true);
  assert.equal(receipt.checks.find((check) => check.name === 'credential.valid')?.ok, false);
  assert.ok(receipt.remaining.some((issue) => issue.rule === 'readback-integrity-v1'));
});

test('an ingredient another manifest recorded is not a promise this export kept', async () => {
  const { master, png } = await specimen('twemoji');
  const { works, uses, details } = censusRecords(master);
  const evaluation = evaluateCreativeUses({ works, uses, details, context: CONTEXT });
  const out = await embedC2pa(png, 'png', { ...CLAIM, title: 'Emoji line', actions: exportActionSteps('png', {}), ingredients: sourceIngredientsFor(works, uses, details) });
  const report = await verifyC2pa(out);

  // `report.ingredients` is every ingredient ANY manifest in the store recorded,
  // a preserved upstream one included, so a file that inherited somebody else's
  // record of this source must not read as this export's credit delivered.
  const foreign: C2paReport = {
    ...report,
    ingredients: report.ingredients!.map((record) => ({ ...record, manifest: 'urn:uuid:somebody-elses-manifest' })),
  };
  const receipt = checkAttributionReadback(evaluation.plan, foreign, undefined, evaluation.fingerprint);
  assert.equal(receipt.state, 'written');
  assert.deepEqual(receipt.observed, []);
  assert.equal(receipt.checks.find((check) => check.name === 'ingredients.present')?.ok, false);

  // With no active manifest label there is nothing to attribute a credit to.
  const unlabelled: C2paReport = { ...report, claim: undefined };
  assert.equal(checkAttributionReadback(evaluation.plan, unlabelled, undefined, evaluation.fingerprint).state, 'written');
});

const outputHash = (bytes: Uint8Array): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

/** The byte offset of a PNG chunk's type field, for a deliberate one-byte edit. */
function findMarker(bytes: Uint8Array, type: string): number {
  const wanted = [...type].map((c) => c.charCodeAt(0));
  for (let i = 8; i < bytes.length - 4; i++) {
    if (wanted.every((code, k) => bytes[i + k] === code)) return i;
  }
  throw new Error(`no ${type} chunk`);
}

test('a plan with nothing required is confirmed without inventing an ingredient', () => {
  const empty = evaluateCreativeUses({ works: [], uses: [], context: CONTEXT });
  const none: C2paReport = { found: true, state: 'valid', trusted: false, madeWithLolly: true, likelyMadeWithLolly: true, partsMadeWithLolly: false, delivered: true, format: 'png', checks: [], ingredients: [] };
  const receipt = checkAttributionReadback(empty.plan, none);
  assert.equal(receipt.state, 'readback-confirmed');
  assert.deepEqual(receipt.expected, []);
  assert.equal(receipt.credits, '');
  assert.equal(receipt.outputHash, undefined);
});
