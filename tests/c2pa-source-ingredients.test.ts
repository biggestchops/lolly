// SPDX-License-Identifier: MPL-2.0
/**
 * Source ingredients without a credential of their own (engine 1.194, plans 252
 * and 253): a CC BY SVG incorporated into an export becomes a componentOf
 * ingredient that binds the ORIGINAL source bytes by external hashed URI,
 * records Lolly's rights observation in `tools.lolly.rights`, and is recorded
 * by a `c2pa.placed` action - never an `opened`, never a fabricated upstream
 * manifest or validation result. The fixtures are the real pinned emoji
 * specimens (Twemoji CC BY 4.0, OpenMoji CC BY-SA 4.0), compiled through the
 * engine's line compiler, so the census being credited is the one the
 * renderer produced. Cross-checked with c2patool where it is installed
 * (`brew install c2patool`); skipped by name where it is not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import {
  embedC2pa, buildExternalC2paStore, exportActionSteps, LOLLY_RIGHTS_ASSERTION, DIGITAL_SOURCE_TYPE, GENERATED_SOURCE_TYPE,
} from '../engine/src/c2pa.ts';
import type { C2paSourceIngredient } from '../engine/src/c2pa.ts';
import { verifyC2pa } from '../engine/src/c2pa-verify.ts';
import { decodeCbor, extractC2paStore, parseC2paStore, prepareC2paIngredient, collectIngredientRecords } from '../engine/src/c2pa-extract.ts';
import { compileEmojiLine } from '../engine/src/emoji-line.ts';
import type { EmojiLineMaster } from '../engine/src/emoji-line.ts';
import { emojiSourceIngredients } from '../engine/src/emoji-rights.ts';
import { emojiLineFixture } from './helpers/emoji-render.ts';

const hasC2patool = spawnSync('c2patool', ['--version']).status === 0;
const DATES = { notBefore: new Date(Date.now() - 60_000), notAfter: new Date(Date.now() + 86_400_000) };
const GEN = { name: 'Lolly', version: 'test' };
const CLAIM = { claimGenerator: 'Lolly lolly.tools', generatorInfo: GEN, dates: DATES };
const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

function c2paVerdict(bytes: Uint8Array): { state: string; beyondTrust: string[] } {
  const file = join(mkdtempSync(join(tmpdir(), 'lolly-c2pa-src-')), 'out.png');
  writeFileSync(file, bytes);
  const r = spawnSync('c2patool', [file], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  assert.equal(r.status, 0, `c2patool exited ${r.status}: ${r.stderr}`);
  const report = JSON.parse(r.stdout) as { validation_state?: string; validation_status?: { code: string }[] };
  const beyondTrust = (report.validation_status ?? []).map((s) => s.code).filter((code) => code !== 'signingCredential.untrusted');
  return { state: report.validation_state ?? '(none)', beyondTrust };
}

async function specimen(name: string): Promise<{ master: EmojiLineMaster; png: Uint8Array; svg: Uint8Array }> {
  const input = await emojiLineFixture(name);
  const result = await compileEmojiLine(input.options, [input.pack], input.host);
  assert.ok(result.ok, result.ok ? '' : result.message);
  const png = new Uint8Array(new Resvg(result.master.svg, { font: { loadSystemFonts: false } }).render().asPng());
  return { master: result.master, png, svg: new TextEncoder().encode(result.master.svg) };
}

test('a CC BY SVG with no credential becomes a placed source ingredient with a bound rights record', async () => {
  const { master, png } = await specimen('twemoji');
  const ingredients = emojiSourceIngredients(master.sources);
  assert.equal(ingredients.length, 1);
  const [ing] = ingredients;
  const census = master.sources[0]!;
  assert.equal(ing!.relationship, 'componentOf');
  assert.equal(`sha256:${hex(ing!.hash!)}`, census.sourceChecksum, 'the ingredient binds the ORIGINAL source bytes');
  assert.equal(ing!.url, census.source.sourceUrl);

  const out = await embedC2pa(png, 'png', { ...CLAIM, title: 'Emoji line', actions: exportActionSteps('png', {}), ingredients });
  const report = await verifyC2pa(out);
  assert.equal(report.state, 'valid');
  assert.equal(report.rights, undefined, "one CC BY part never becomes the composition's dc:rights");
  assert.equal(report.aiGenerated, undefined);

  // The reader surfaces it as a non-credentialed source with the bound rights.
  assert.equal(report.ingredients?.length, 1);
  const record = report.ingredients![0]!;
  assert.equal(record.credentialed, false);
  assert.equal(record.activeManifest, undefined);
  assert.equal(record.relationship, 'componentOf');
  assert.match(record.title!, /grinning face \(Twemoji Color 17\.0\.3\)/);
  assert.equal(record.format, 'image/svg+xml');
  assert.equal(record.instanceId, `${census.assetId}@17.0.3`);
  assert.deepEqual(record.data, { url: census.source.sourceUrl, alg: 'sha256', hash: census.sourceChecksum.slice('sha256:'.length), format: 'image/svg+xml' });
  assert.equal(record.informationalUri, 'https://creativecommons.org/licenses/by/4.0/');
  assert.equal(record.rights?.license, 'CC-BY-4.0');
  assert.equal(record.rights?.creator, census.source.creator);
  assert.equal(record.rights?.sourceHash, census.sourceChecksum);
  assert.equal(record.rights?.usedHash, census.canonicalChecksum, 'the rights record names the canonical form actually placed');
  assert.deepEqual(record.rights?.modifications, census.changes, 'every normalization change is declared');
  assert.equal(record.rights?.revision, census.source.revision);

  // The action pairing: componentOf is PLACED, after the created head, with the
  // ingredient reference the spec requires; nothing was "opened".
  const actions = (report.history ?? []).map((s) => s.action);
  assert.ok(!actions.includes('c2pa.opened'), `no opened step: ${actions.join(', ')}`);
  const placedAt = actions.indexOf('c2pa.placed');
  assert.ok(placedAt > actions.indexOf('c2pa.created'), `placed after created: ${actions.join(', ')}`);
  const placed = report.history![placedAt]!;
  assert.match(String(placed.description), /^Placed grinning face/);
  const params = placed.parameters as Map<string, unknown>;
  const refs = params.get('ingredients') as Map<string, unknown>[];
  assert.equal(refs[0]!.get('url'), 'self#jumbf=c2pa.assertions/c2pa.ingredient.v3');

  // The raw assertion is a spec-literal non-C2PA ingredient: no activeManifest,
  // no validationResults, the bytes bound by an external hashed URI.
  const store = extractC2paStore(out)!.store;
  const parts = parseC2paStore(store);
  const ingAssertion = decodeCbor(parts.assertions.find((a) => a.label === 'c2pa.ingredient.v3')!.content) as Map<string, unknown>;
  assert.equal(ingAssertion.has('activeManifest'), false);
  assert.equal(ingAssertion.has('validationResults'), false);
  assert.equal(ingAssertion.has('claimSignature'), false);
  const data = ingAssertion.get('data') as Map<string, unknown>;
  assert.equal(data.get('alg'), 'sha256');
  assert.equal(hex(data.get('hash') as Uint8Array), census.sourceChecksum.slice('sha256:'.length));
  const rights = decodeCbor(parts.assertions.find((a) => a.label === LOLLY_RIGHTS_ASSERTION)!.content) as Map<string, unknown>;
  assert.equal(rights.get('version'), 1);
  const sources = rights.get('sources') as Map<string, unknown>[];
  assert.equal(sources.length, 1);
  assert.equal((sources[0]!.get('ingredient') as Map<string, unknown>).get('url'), 'self#jumbf=c2pa.assertions/c2pa.ingredient.v3');
  assert.equal(sources[0]!.get('license'), 'CC-BY-4.0');

  if (hasC2patool) {
    const verdict = c2paVerdict(out);
    assert.equal(verdict.state, 'Valid', 'the reference validator accepts the non-C2PA ingredient and its placed action');
    assert.deepEqual(verdict.beyondTrust, [], `unexpected c2patool statuses: ${verdict.beyondTrust.join(', ')}`);
  }
});

test('a CC BY-SA source keeps its own licence in the record while the composition keeps its own rights', async () => {
  const { master, png } = await specimen('openmoji');
  const own = 'Copyright 2026 Example Co. All rights reserved.';
  const out = await embedC2pa(png, 'png', { ...CLAIM, rights: own, actions: exportActionSteps('png', {}), ingredients: emojiSourceIngredients(master.sources) });
  const report = await verifyC2pa(out);
  assert.equal(report.state, 'valid');
  assert.equal(report.rights, own);
  assert.equal(report.ingredients?.[0]?.rights?.license, 'CC-BY-SA-4.0', 'ShareAlike is recorded as such, never relabelled');
  assert.equal(report.ingredients?.[0]?.rights?.licenseUrl, 'https://creativecommons.org/licenses/by-sa/4.0/');
  assert.match(report.ingredients?.[0]?.description ?? '', /CC-BY-SA-4\.0/);
});

test('the vector master itself carries the source ingredient, embedded or as an external store', async () => {
  const { master, svg } = await specimen('noto');
  const ingredients = emojiSourceIngredients(master.sources);
  const actions = [{ action: 'c2pa.created', digitalSourceType: DIGITAL_SOURCE_TYPE }];
  // Embedded in the SVG (section A.3.3): the master travels with its own sources.
  const stamped = await embedC2pa(svg, 'svg', { ...CLAIM, title: 'Emoji line', actions, ingredients });
  const report = await verifyC2pa(stamped);
  assert.equal(report.state, 'valid');
  assert.equal(report.ingredients?.length, 1);
  assert.equal(report.ingredients![0]!.credentialed, false);
  assert.equal(report.ingredients![0]!.rights?.license, 'Apache-2.0');
  assert.deepEqual((report.history ?? []).map((s) => s.action), ['c2pa.created', 'c2pa.placed']);
  // The external store for a delivery that cannot embed (section 11.4) records the
  // same ingredient and rights; only a document that references the store can be
  // verified against it, so this checks the store's contents, not a binding.
  const store = await buildExternalC2paStore(svg, { ...CLAIM, title: 'Emoji line', actions, ingredients });
  const records = collectIngredientRecords(store);
  assert.equal(records.length, 1);
  assert.equal(records[0]!.credentialed, false);
  assert.equal(records[0]!.data?.url, master.sources[0]!.source.sourceUrl);
  assert.equal(records[0]!.rights?.usedHash, master.sources[0]!.canonicalChecksum);
  assert.ok(parseC2paStore(store).assertions.some((a) => a.label === LOLLY_RIGHTS_ASSERTION));
});

test('a credentialed componentOf ingredient is placed, parentOf is opened, and two parents are refused', async () => {
  const { png } = await specimen('twemoji');
  const aiSource = await embedC2pa(png, 'png', {
    claimGenerator: 'Some AI Model', generatorInfo: { name: 'Some AI Model', version: 'test' },
    actions: [{ action: 'c2pa.created', digitalSourceType: GENERATED_SOURCE_TYPE }], dates: DATES,
  });
  const credentialed = prepareC2paIngredient(aiSource)!;
  assert.ok(credentialed);

  const placedOut = await embedC2pa(png, 'png', { ...CLAIM, actions: exportActionSteps('png', {}), ingredients: [{ ...credentialed, relationship: 'componentOf' }] });
  const placedReport = await verifyC2pa(placedOut);
  assert.equal(placedReport.state, 'valid');
  const placedActions = (placedReport.history ?? []).filter((s) => s.softwareAgent === 'Lolly').map((s) => s.action);
  assert.ok(placedActions.includes('c2pa.placed') && !placedActions.includes('c2pa.opened'), placedActions.join(', '));
  assert.equal(placedReport.aiGenerated?.kind, 'generated', 'the AI origin still propagates through the placed step');
  assert.equal(placedReport.ingredients?.at(-1)?.credentialed, true);
  assert.equal(placedReport.ingredients?.at(-1)?.relationship, 'componentOf');
  if (hasC2patool) {
    const verdict = c2paVerdict(placedOut);
    assert.equal(verdict.state, 'Valid');
    assert.deepEqual(verdict.beyondTrust, [], `unexpected c2patool statuses: ${verdict.beyondTrust.join(', ')}`);
  }

  const openedOut = await embedC2pa(png, 'png', { ...CLAIM, actions: exportActionSteps('png', {}), ingredients: [credentialed] });
  const openedActions = ((await verifyC2pa(openedOut)).history ?? []).filter((s) => s.softwareAgent === 'Lolly').map((s) => s.action);
  assert.equal(openedActions[0], 'c2pa.opened', 'the historic default is unchanged: parentOf opens first');
  assert.ok(!openedActions.includes('c2pa.placed'));

  await assert.rejects(
    embedC2pa(png, 'png', { ...CLAIM, actions: exportActionSteps('png', {}), ingredients: [credentialed, { ...credentialed }] }),
    /only one parentOf ingredient/,
  );
});

test('malformed source ingredients are refused before anything is signed', async () => {
  const { master, png } = await specimen('twemoji');
  const [good] = emojiSourceIngredients(master.sources) as [C2paSourceIngredient];
  const cases: [Partial<C2paSourceIngredient>, RegExp][] = [
    [{ hash: undefined }, /url AND hash together/],
    [{ hash: new Uint8Array(31) }, /32-byte sha256/],
    [{ url: 'ftp://example.com/a.svg' }, /http\(s\) URL/],
    [{ url: 'https://user:secret@example.com/a.svg' }, /credentials/],
    [{ format: 'nonsense' }, /neither a known format key nor an IANA media type/],
    [{ relationship: 'inputTo' as 'componentOf' }, /componentOf|parentOf/],
    [{ title: '   ' }, /title/],
    [{ rights: { ...good.rights!, sourceHash: 'md5:abc' } }, /sourceHash/],
    [{ rights: { ...good.rights!, modifications: [''] } }, /modifications/],
    [{ rights: { ...good.rights!, licenseUrl: 'creativecommons.org' } }, /licenseUrl/],
  ];
  for (const [patch, expected] of cases) {
    await assert.rejects(embedC2pa(png, 'png', { ...CLAIM, actions: exportActionSteps('png', {}), ingredients: [{ ...good, ...patch }] }), expected);
  }
});
