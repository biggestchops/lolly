// SPDX-License-Identifier: MPL-2.0
/**
 * The file-level rights report (plan 253 section 9): what a credential records,
 * what the file carries, and nothing about reuse until someone asks. Built
 * against a real stamped Twemoji specimen, so the rows are the ones a reader
 * actually finds. The integrity verdict and the rights answer stay separate
 * fields: complete credits never turn a broken signature green, and an intact
 * signature never hides a missing credit.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Resvg } from '@resvg/resvg-js';
import type { UseContextV1 } from '../packages/core/src/rights-v1.ts';
import { embedC2pa, exportActionSteps } from '../engine/src/c2pa.ts';
import { verifyC2pa } from '../engine/src/c2pa-verify.ts';
import type { C2paReport } from '../engine/src/c2pa-verify.ts';
import { compileEmojiLine } from '../engine/src/emoji-line.ts';
import { emojiSourceIngredients } from '../engine/src/emoji-rights.ts';
import { evaluateReuse, rightsReportFromC2pa } from '../engine/src/rights-report.ts';
import { emojiLineFixture } from './helpers/emoji-render.ts';

const DATES = { notBefore: new Date(Date.now() - 60_000), notAfter: new Date(Date.now() + 86_400_000) };
const CLAIM = { claimGenerator: 'Lolly lolly.tools', generatorInfo: { name: 'Lolly', version: 'test' }, dates: DATES };
const FORBIDDEN = /copyright verified|legally safe|fully cleared|rights cleared|royalty-free/i;

async function stamped(name: string, extra: Record<string, unknown> = {}): Promise<C2paReport> {
  const input = await emojiLineFixture(name);
  const result = await compileEmojiLine(input.options, [input.pack], input.host);
  assert.ok(result.ok, result.ok ? '' : result.message);
  const png = new Uint8Array(new Resvg(result.master.svg, { font: { loadSystemFonts: false } }).render().asPng());
  const out = await embedC2pa(png, 'png', {
    ...CLAIM,
    title: 'Emoji line',
    actions: exportActionSteps('png', {}),
    ingredients: emojiSourceIngredients(result.master.sources),
    ...extra,
  });
  return verifyC2pa(out);
}

test('a file with one recorded source reports the source, its credit and who asserted it', async () => {
  const report = await stamped('twemoji');
  const rights = rightsReportFromC2pa(report);
  assert.equal(rights.recorded.length, 1);
  const source = rights.recorded[0]!;
  assert.match(source.title ?? '', /grinning face \(Twemoji Color 17\.0\.3\)/);
  assert.equal(source.creator, 'Twitter, Inc. and other contributors');
  assert.equal(source.licence, 'CC-BY-4.0');
  assert.equal(source.licenceUrl, 'https://creativecommons.org/licenses/by/4.0/');
  assert.match(source.sourceUrl ?? '', /^https:\/\/raw\.githubusercontent\.com\//);
  assert.equal(source.assertedBy, 'exporter', 'the source signed nothing; Lolly recorded what it read');
  assert.deepEqual(source.carried, { ingredient: true, credentialed: false, readableCredit: 'unknown' });
  // `licence` reports the identifier as recorded; the CREDIT prints the readable
  // name, which is the same string the export panel offers, so a person copying
  // one and a person copying the other paste the same thing.
  assert.match(source.credit, /^"grinning face \(Twemoji Color 17\.0\.3\)" by Twitter, Inc\. and other contributors, CC BY 4\.0 https:/);
  // Each recorded modification is a whole sentence, so they join without leaving
  // a doubled full stop in a line somebody is offered to paste.
  assert.match(source.credit, /changes: Canonicalized SVG syntax and inline presentation styles, Prefixed local SVG ids and paint references for placement\.$/);
  assert.doesNotMatch(source.credit, /\.\./);
  assert.equal(rights.carried.ingredients, 1);
  assert.equal(rights.carried.credentialed, 0);
  assert.equal(rights.carried.recorded, 1);
  assert.equal(rights.reuse, null, 'opening Verify is not a statement that someone wants to publish the work');
  assert.equal(rights.ownRights, null);
});

test('the summary is computed from the facts, names nobody, and claims nothing the plan forbids', async () => {
  const report = await stamped('twemoji');
  const rights = rightsReportFromC2pa(report);
  assert.equal(
    rights.summary,
    'Credential intact. It records 1 source. The exporter recorded it; the source did not sign a credential of its own.',
  );
  assert.doesNotMatch(rights.summary, FORBIDDEN);
  assert.doesNotMatch(rights.summary, /Twitter/, 'the summary reports counts, never an upstream name as a verdict');
  for (const limit of rights.carried.limits) assert.doesNotMatch(limit, FORBIDDEN);
  assert.ok(rights.carried.limits.some((limit) => /what the signer declared/.test(limit)), 'the inspection limit is stated');
  assert.ok(rights.carried.limits.some((limit) => /readable credit/.test(limit)), 'the uninspected channel is stated');
});

test("the composition's own rights statement stays apart from its sources'", async () => {
  const own = 'Copyright 2026 Example Co. All rights reserved.';
  const report = await stamped('openmoji', { rights: own });
  const rights = rightsReportFromC2pa(report);
  assert.equal(rights.ownRights, own);
  assert.equal(rights.recorded[0]?.licence, 'CC-BY-SA-4.0', 'ShareAlike is recorded as such, never relabelled');
  assert.match(rights.summary, /rights statement is separate/);
});

test('a file with no credential says so without calling the file suspect', () => {
  const none: C2paReport = { found: false, state: 'none', trusted: false, madeWithLolly: false, likelyMadeWithLolly: false, partsMadeWithLolly: false, delivered: false, format: 'png', checks: [] };
  const rights = rightsReportFromC2pa(none);
  assert.equal(rights.summary, 'No Content Credential was found in this file. It records no creative sources.');
  assert.deepEqual(rights.recorded, []);
  assert.deepEqual(rights.carried, { ingredients: 0, credentialed: 0, recorded: 0, limits: ['This file carries no Content Credential, so no source list was read from it.'] });
  assert.equal(rights.reuse, null);
});

test('a credential that did not verify keeps its rights text as an unchecked assertion', async () => {
  const report = await stamped('twemoji');
  const broken: C2paReport = { ...report, state: 'invalid' };
  const rights = rightsReportFromC2pa(broken);
  assert.match(rights.summary, /^The credential did not verify\./);
  assert.equal(rights.recorded.length, 1, 'the recorded information is kept, not deleted');
  assert.ok(rights.carried.limits.some((limit) => /unchecked assertion/.test(limit)));
});

test('a missing creator or licence in a recorded source is counted as a limit, not hidden', () => {
  const partial: C2paReport = {
    found: true, state: 'valid', trusted: false, madeWithLolly: true, likelyMadeWithLolly: true, partsMadeWithLolly: false, delivered: true, format: 'png', checks: [],
    ingredients: [{ manifest: 'm', label: 'c2pa.ingredient.v3', credentialed: false, title: 'Unnamed Artwork', data: { url: 'https://example.org/art.svg' } }],
  };
  const rights = rightsReportFromC2pa(partial);
  assert.equal(rights.recorded[0]?.creator, undefined);
  assert.equal(rights.recorded[0]?.licence, undefined);
  assert.equal(rights.recorded[0]?.credit, '"Unnamed Artwork", source https://example.org/art.svg, unchanged.');
  assert.ok(rights.carried.limits.some((limit) => /1 of 1 recorded sources are missing/.test(limit)));
});

test("a stranger's credential cannot put a script url or a private path into a credit", () => {
  // This text is read out of somebody else's file and offered to a person to
  // paste, and it reaches the CLI, the TUI and an MCP result unchanged. The
  // engine drops a locator that is not an ordinary public address rather than
  // leaving each surface to invent its own rule (plan 253 decision 10).
  const hostile: C2paReport = {
    found: true, state: 'valid', trusted: false, madeWithLolly: false, likelyMadeWithLolly: false, partsMadeWithLolly: false, delivered: true, format: 'png', checks: [],
    ingredients: [{
      manifest: 'm',
      label: 'c2pa.ingredient.v3',
      credentialed: false,
      title: 'Hostile Artwork',
      rights: {
        creator: 'Someone',
        license: 'CC-BY-4.0',
        licenseUrl: 'javascript:alert(1)',
        attribution: 'Someone',
        sourceUrl: 'file:///Users/andy/Private/receipts/invoice-4821.pdf',
        modifications: [],
        sourceHash: `sha256:${'0'.repeat(64)}`,
      },
    }],
  };
  const rights = rightsReportFromC2pa(hostile);
  assert.equal(rights.recorded[0]?.credit, '"Hostile Artwork" by Someone, CC BY 4.0, unchanged.');
  assert.doesNotMatch(rights.recorded[0]?.credit ?? '', /javascript:|file:\/\/|invoice-4821/);
  // The fields stay as recorded, because what a file says is a fact about the
  // file. Only the credit, which is text a person is handed, drops them.
  assert.equal(rights.recorded[0]?.sourceUrl, 'file:///Users/andy/Private/receipts/invoice-4821.pdf');
});

test('a reuse is evaluated only when a context is supplied, and it answers in the same vocabulary', async () => {
  const report = await stamped('openmoji');
  const share: UseContextV1 = {
    operation: 'send',
    delivery: { format: 'png', route: 'connector', canCarryCredential: false, canCarryReadableCredit: true },
    audience: 'public',
  };
  const asIs = evaluateReuse(report, share);
  assert.equal(asIs.status, 'ready', 'passing on an unchanged CC BY-SA work needs the credit, which the caption carries');
  assert.deepEqual(asIs.plan.channels, ['caption']);
  assert.equal(asIs.plan.required.length, 1);

  const adapted = evaluateReuse(report, share, { operations: ['placed', 'recoloured'] });
  assert.equal(adapted.status, 'actions-required');
  assert.deepEqual(adapted.issues.map((issue) => issue.code), ['licence.adaptation-choice']);
  assert.equal(adapted.issues[0]?.summary, 'If you share this adaptation, it needs a compatible licence.');

  const stripping: UseContextV1 = { ...share, delivery: { format: 'png', route: 'connector', canCarryCredential: false, canCarryReadableCredit: false } };
  const noCredit = evaluateReuse(report, stripping);
  assert.deepEqual(noCredit.issues.map((issue) => issue.code), ['attribution.delivery-missing']);
  assert.deepEqual(noCredit.plan.channels, []);
});
