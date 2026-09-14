// SPDX-License-Identifier: MPL-2.0
/**
 * The /verify Sources panel (sourcesHtml in valid.ts).
 *
 * A recorded ingredient that carries no Content Credential of its own - an
 * upstream SVG, a CC BY illustration, an emoji pack's artwork - is the whole
 * reason this panel exists, and the whole reason it has to be careful. Lolly
 * observed the licence and wrote it down; the source did not sign for it. The
 * panel must state which one it is on the row, show the terms it read, and
 * escape every string, because all of it came out of a file a stranger sent.
 *
 * Run directly: node --import ./tests/css-stub.mjs --test shells/web/src/views/valid-sources.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
// valid.ts reads `window.__toolIndex` - the same type-only augmentation
// valid-script.test.ts uses (nothing executes from sync.ts at runtime).
import type {} from '../catalog/sync.ts';
import { reuseAnswerHtml, sourcesHtml } from './valid.ts';
import type { VerifyReport } from './valid-verdict.ts';

const report = (over: Partial<VerifyReport>): VerifyReport => ({
  found: true, state: 'valid', trusted: true, madeWithLolly: true, likelyMadeWithLolly: false,
  partsMadeWithLolly: false, delivered: false, format: 'png', checks: [],
  ...over,
} as VerifyReport);

/** One emoji glyph, as emojiSourceIngredients records it and the reader reads it back. */
const emojiSource = {
  title: 'grinning face (Twemoji Color)',
  format: 'svg',
  relationship: 'componentOf',
  credentialed: false,
  data: { url: 'https://raw.githubusercontent.com/twitter/twemoji/v17.0.3/assets/svg/1f600.svg', alg: 'sha256', hash: 'ab'.repeat(32) },
  rights: {
    creator: 'Twitter, Inc and other contributors',
    license: 'CC-BY-4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    attribution: 'Twemoji by Twitter, licensed CC BY 4.0.',
    sourceUrl: 'https://raw.githubusercontent.com/twitter/twemoji/v17.0.3/assets/svg/1f600.svg',
    revision: 'v17.0.3',
    modifications: ['canonicalized to static-svg-v1', 'recoloured by emoji-treatment-v1'],
    sourceHash: `sha256:${'ab'.repeat(32)}`,
    usedHash: `sha256:${'cd'.repeat(32)}`,
  },
};

test('a file with no recorded sources shows no panel at all', () => {
  assert.equal(sourcesHtml(report({})), '');
  assert.equal(sourcesHtml(report({ ingredients: [] })), '');
});

test('an unsigned source is shown with its rights and named as recorded, not signed', () => {
  const html = sourcesHtml(report({ ingredients: [emojiSource] }));
  assert.ok(html.includes('grinning face (Twemoji Color)'), 'the source names itself');
  assert.ok(html.includes('Recorded by the exporter, not signed by the source.'),
    'an ingredient with no credential of its own must say who recorded it');
  assert.ok(!html.includes('Signed by the source'), 'and must never claim the source signed');
  assert.ok(html.includes('Twitter, Inc and other contributors'), 'the creator shows');
  assert.ok(html.includes('CC BY 4.0'), 'the licence shows under one readable name');
  assert.ok(html.includes('title="CC-BY-4.0"'), 'with the declaration as supplied kept beside it');
  assert.ok(html.includes('Twemoji by Twitter, licensed CC BY 4.0.'), 'the attribution sentence shows verbatim');
  assert.ok(html.includes('v17.0.3'), 'the upstream revision shows');
  assert.ok(html.includes('Source revision'), 'and is labelled, rather than being a bare hash beside Creator');
  assert.ok(html.includes('Placed in this file'), 'componentOf reads as a placement');
  assert.ok(html.includes('canonicalized to static-svg-v1, recoloured by emoji-treatment-v1'),
    'every change made on the way in is listed');
  assert.ok(html.includes('href="https://raw.githubusercontent.com/twitter/twemoji/v17.0.3/assets/svg/1f600.svg"'),
    'the exact bytes are linkable');
  assert.ok(html.includes('rel="noopener noreferrer"'), 'an untrusted link opens safely');
  assert.ok(html.includes('1 recorded'), 'the summary counts the sources');
});

test('a credentialed parent reads as signed, and as the thing this file came from', () => {
  const html = sourcesHtml(report({ ingredients: [{
    title: 'holiday-photo.jpg', format: 'jpg', relationship: 'parentOf', credentialed: true,
  }] }));
  assert.ok(html.includes('Signed by the source, and its credential travelled with it.'));
  assert.ok(html.includes('This file was made from it'));
  assert.ok(!html.includes('Recorded by the exporter'));
});

test('every string is escaped, and a javascript: locator never becomes a link', () => {
  const html = sourcesHtml(report({ ingredients: [{
    title: '<img src=x onerror=alert(1)>',
    credentialed: false,
    relationship: 'componentOf',
    informationalUri: 'javascript:alert(1)',
    rights: {
      creator: '"><script>alert(1)</script>',
      license: 'CC-BY-4.0', licenseUrl: 'x', attribution: 'a', sourceUrl: 'javascript:alert(1)',
      modifications: [], sourceHash: 'sha256:0',
    },
  }] }));
  assert.ok(!html.includes('<img src=x'), 'a title out of a stranger\'s file is escaped');
  assert.ok(!html.includes('<script>'), 'so is a creator name');
  assert.ok(!html.includes('javascript:'), 'a non-http locator is dropped rather than linked');
  assert.ok(!html.includes('<a href'), 'and no link is drawn at all');
});

test('a source with nothing but a relationship still renders one honest row', () => {
  const html = sourcesHtml(report({ ingredients: [{ credentialed: false, relationship: 'componentOf' }] }));
  assert.ok(html.includes('Untitled source'));
  assert.ok(html.includes('Recorded by the exporter, not signed by the source.'));
});

test('a crafted relationship cannot reach through to Object.prototype', () => {
  // `relationship` is a string read straight off the credential, so a lookup in
  // an object literal would answer 'toString' with the function's own source.
  const html = sourcesHtml(report({ ingredients: [{ credentialed: false, relationship: 'toString' }] }));
  assert.equal(html.includes('native code'), false, 'no prototype member is printed');
  assert.ok(html.includes('toString'), 'the unknown relationship is shown as the text it is');
});

// ── The rights layer over the same panel (plan 253, section 9) ────────────────
//
// Three additions, and the reason each one earns its place. The summary is
// computed from the ingredients rather than written here, so it cannot say a name
// this file does not carry. Copy credit hands over the line the engine assembled,
// which is what a caption needs and a file's metadata cannot deliver. And "Check
// for this use" is the only place a reuse is evaluated, because opening Verify is
// not a statement that anybody intends to publish anything.

test('the summary is computed from what the file records, not written into the view', () => {
  const html = sourcesHtml(report({ ingredients: [emojiSource] }));
  assert.ok(html.includes('Credential intact.'), 'the credential verdict leads');
  assert.ok(html.includes('It records 1 source.'), 'the count is the file\'s own');
  assert.ok(html.includes('The exporter recorded it; the source did not sign a credential of its own.'),
    'and who said so stays a separate sentence from whether it verified');
  assert.ok(html.includes('It is not a check that every work in the pixels was identified.'),
    'the limits of the reading are stated rather than trimmed away');
});

test('a summary never claims a source signed when only the exporter recorded it', () => {
  const html = sourcesHtml(report({ ingredients: [emojiSource] }));
  assert.ok(!/verified/i.test(html.split('valid-sources-list')[0] ?? ''), 'no verification language in the summary');
  assert.ok(!html.includes('rights cleared'), 'and none of the wording the plan forbids');
  assert.ok(!html.includes('legally safe'));
  assert.ok(!html.includes('copyright verified'));
});

test('Copy credit carries the assembled credit line, and Open source only an http locator', () => {
  const html = sourcesHtml(report({ ingredients: [emojiSource] }));
  assert.ok(html.includes('data-copy-credit="'), 'the credit rides on the button');
  assert.ok(html.includes('Twitter, Inc and other contributors'), 'the creator is in it');
  assert.ok(html.includes('changes: canonicalized to static-svg-v1, recoloured by emoji-treatment-v1'),
    'so are the changes, because a CC BY credit has to indicate them');
  assert.ok(html.includes('Open source'), 'and the exact bytes are reachable');
});

test('a non-http source locator reaches neither the link nor the credit to paste', () => {
  const html = sourcesHtml(report({ ingredients: [{
    title: 'x', credentialed: false, relationship: 'componentOf',
    rights: {
      creator: 'A', license: 'CC-BY-4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      attribution: 'a', sourceUrl: 'javascript:alert(1)', modifications: [], sourceHash: 'sha256:0',
    },
  }] }));
  assert.ok(!html.includes('javascript:'), 'it is dropped before the credit is built');
  assert.ok(html.includes('data-copy-credit="'), 'the rest of the credit still travels');
});

test('the licence shows its canonical name with the exact declaration kept beside it', () => {
  const html = sourcesHtml(report({ ingredients: [{
    title: 'x', credentialed: false, relationship: 'componentOf',
    rights: {
      creator: 'A', license: 'cc-by-sa-4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      attribution: 'a', sourceUrl: 'https://example.org/x.svg', modifications: [], sourceHash: 'sha256:0',
    },
  }] }));
  assert.ok(html.includes('CC BY-SA 4.0'), 'the canonical name is shown');
  assert.ok(html.includes('title="cc-by-sa-4.0"'), 'and the declaration as supplied is never rewritten away');

  // The canonical spelling is read whenever the identifier resolves, not only
  // when it differs from the declaration. A credential records `CC-BY-SA-4.0`,
  // and printing that raw here while the export panel printed `CC BY-SA 4.0`
  // handed two people two different strings for one licence.
  const canonical = sourcesHtml(report({ ingredients: [{
    title: 'x', credentialed: false, relationship: 'componentOf',
    rights: {
      creator: 'A', license: 'CC-BY-SA-4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      attribution: 'a', sourceUrl: 'https://example.org/x.svg', modifications: [], sourceHash: 'sha256:0',
    },
  }] }));
  assert.ok(canonical.includes('>CC BY-SA 4.0<'), 'the readable name, not the identifier');
  assert.ok(canonical.includes('data-copy-credit="'));
  assert.ok(!/data-copy-credit="[^"]*CC-BY-SA-4\.0/.test(canonical), 'and the credit offered to paste says the same thing');
});

test('the reuse chooser is offered and answers nothing until a use is picked', () => {
  const html = sourcesHtml(report({ ingredients: [emojiSource] }), 2);
  assert.ok(html.includes('Check for this use'));
  assert.ok(html.includes('data-reuse-check="2"'), 'the select is bound to its own file');
  assert.ok(html.includes('<div class="valid-sources-reuse-out" data-reuse-out="2" aria-live="polite"></div>'),
    'and the answer area starts empty');
});

test('sharing a recoloured ShareAlike work asks for a compatible licence, by code', () => {
  const sa = {
    title: 'openmoji glyph', credentialed: false, relationship: 'componentOf',
    rights: {
      creator: 'OpenMoji contributors', license: 'CC-BY-SA-4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', attribution: 'a',
      sourceUrl: 'https://example.org/1f600.svg', modifications: ['recoloured'], sourceHash: 'sha256:0',
    },
  };
  const adapt = reuseAnswerHtml(report({ ingredients: [sa] }), 'adapt');
  assert.ok(adapt.includes('licence.adaptation-choice'), 'the stable code is shown, not a paraphrase');
  assert.ok(adapt.includes('If you share this adaptation, it needs a compatible licence.'));
  assert.ok(adapt.includes('This use needs a decision from you.'));
  // The same work placed unchanged asks nothing: ShareAlike is a condition on
  // adaptations, not a property of the file.
  const share = reuseAnswerHtml(report({ ingredients: [sa] }), 'share');
  assert.ok(!share.includes('licence.adaptation-choice'), 'an unchanged placement needs no licence choice');
  assert.ok(share.includes('Nothing is left to decide'));
});

test('a route that carries no credit at all reports the delivery gap', () => {
  const html = reuseAnswerHtml(report({ ingredients: [emojiSource] }), 'stripped');
  assert.ok(html.includes('attribution.delivery-missing'));
  assert.ok(html.includes('this route carries no credit of its own'));
});

test('passing on the source file itself is a separate question from placing it', () => {
  const unknown = {
    title: 'a work with no licence', credentialed: false, relationship: 'componentOf',
  };
  const html = reuseAnswerHtml(report({ ingredients: [unknown] }), 'redistribute');
  assert.ok(html.includes('licence.unknown'), 'nothing recorded stays unknown');
  assert.ok(!html.includes('Nothing is left to decide'), 'and is never reported as settled');
});

test('an unrecognised use id answers nothing rather than guessing one', () => {
  assert.equal(reuseAnswerHtml(report({ ingredients: [emojiSource] }), 'whatever'), '');
});
