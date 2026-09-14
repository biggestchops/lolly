// SPDX-License-Identifier: MPL-2.0
/**
 * The shared Sources section every Node surface prints (plan 253, section 9.2).
 *
 * `lolly validate`, the TUI and the MCP verify result all render this, so the one
 * thing it must never do is hand a surface its own vocabulary. The rows come from
 * the engine's rights reader, which is also what the web Verify panel reads, and
 * they keep the distinction the whole feature rests on: a source that signed for
 * itself and a source the exporter merely recorded are two different sentences.
 *
 * Run directly:  node --test packages/node-shell/test/verdict-report.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { C2paReport } from '@lolly/engine';
import { verdictSources } from '../src/verdict-report.ts';

const report = (over: Partial<C2paReport>): C2paReport => ({
  found: true, state: 'valid', trusted: true, madeWithLolly: true, likelyMadeWithLolly: false,
  partsMadeWithLolly: false, delivered: false, format: 'png', checks: [],
  ...over,
} as C2paReport);

const twemoji = {
  manifest: 'urn:m', label: 'c2pa.ingredient.v3', credentialed: false,
  relationship: 'componentOf', title: 'grinning face (Twemoji Color)', format: 'svg',
  rights: {
    creator: 'Twitter, Inc and other contributors',
    license: 'CC-BY-4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    attribution: 'Twemoji by Twitter, licensed CC BY 4.0.',
    sourceUrl: 'https://example.org/1f600.svg',
    modifications: ['recoloured by emoji-treatment-v1'],
    sourceHash: 'sha256:00',
  },
};

test('a file that records nothing gets no section at all', () => {
  assert.equal(verdictSources(report({})), null);
  assert.equal(verdictSources(report({ ingredients: [] })), null);
});

test('one row per source, with the asserting party as its own field', () => {
  const out = verdictSources(report({ ingredients: [twemoji] }))!;
  assert.equal(out.sources.length, 1);
  const [row] = out.sources;
  assert.equal(row!.title, 'grinning face (Twemoji Color)');
  assert.equal(row!.creator, 'Twitter, Inc and other contributors');
  assert.equal(row!.licence, 'CC-BY-4.0');
  assert.equal(row!.asserted, 'recorded by the exporter');
  assert.ok(row!.credit.includes('changes: recoloured by emoji-treatment-v1'),
    'the credit indicates the modification, which is what CC BY asks for');
});

test('a credentialed source says the source signed, and never the other sentence', () => {
  const out = verdictSources(report({ ingredients: [{ ...twemoji, credentialed: true }] }))!;
  assert.equal(out.sources[0]!.asserted, 'signed by the source');
  assert.ok(out.summary.includes('The source signed its own credential.'));
  assert.ok(!out.summary.includes('the exporter recorded'));
});

test('the summary and the limits are the engine\'s wording, not this package\'s', () => {
  const out = verdictSources(report({ ingredients: [twemoji] }))!;
  assert.ok(out.summary.startsWith('Credential intact.'));
  assert.ok(out.summary.includes('It records 1 source.'));
  assert.ok(out.limits.some((l) => l.includes('not a check that every work in the pixels was identified')),
    'what was not established is printed rather than dropped');
});

test('a broken credential does not turn its rights statements into checked facts', () => {
  const out = verdictSources(report({ state: 'invalid', ingredients: [twemoji] }))!;
  assert.ok(out.summary.includes('The credential did not verify.'));
  assert.ok(out.limits.some((l) => l.includes('unchecked assertion')));
  assert.equal(out.sources[0]!.creator, 'Twitter, Inc and other contributors',
    'and the text it carried is kept rather than deleted');
});

test('every printed string is scrubbed of terminal control sequences', () => {
  // A crafted manifest reaching a terminal is the reason cleanControlChars exists;
  // a rights record is one more attacker-controlled place it must apply.
  const nasty = {
    ...twemoji,
    title: 'ok\u001b[31mRED',
    rights: { ...twemoji.rights, creator: 'A\u0007B', license: 'CC-BY-4.0\u001b]0;x\u0007' },
  };
  const out = verdictSources(report({ ingredients: [nasty] }))!;
  const all = [out.summary, ...out.limits, ...out.sources.flatMap((s) => [s.title, s.creator, s.licence, s.credit])].join('');
  // Checked by code point rather than a character-class range, because a regex
  // holding control characters is itself the thing the linter flags.
  const control = [...all].some((ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return code < 0x20 || (code >= 0x7f && code <= 0x9f);
  });
  assert.ok(!control, 'no control character survives into the output');
  assert.ok(out.sources[0]!.title.includes('RED'), 'the readable text itself is kept');
});

test('a source with no title or creator still renders one honest row', () => {
  const out = verdictSources(report({ ingredients: [{ manifest: 'urn:m', label: 'c2pa.ingredient.v3', credentialed: false }] }))!;
  assert.equal(out.sources[0]!.title, 'Untitled source');
  assert.equal(out.sources[0]!.creator, '');
  assert.equal(out.sources[0]!.licence, '');
  assert.ok(out.limits.some((l) => l.includes('missing a creator or a licence')));
});
