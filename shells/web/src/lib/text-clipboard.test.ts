// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import type { TextDocumentV1 } from '@lolly-tools/core';
import { parseTextDocument } from '../../../../engine/src/text-story-document.ts';
import { parseColor } from '../../../../engine/src/css-color.ts';
import { copyTextFragment, pastedTextHtml, TEXT_CLIPBOARD_MIME } from './text-clipboard.ts';
const fonts: TextDocumentV1['fonts'] = [{ id: 'font', family: 'Known', sha256: 'a'.repeat(64), faceIndex: 0, source: { kind: 'bundled', path: '/fonts/known.ttf' } }];
const document: TextDocumentV1 = { version: 1, stories: [], styles: [], fonts };
const parse = (html: string) => new JSDOM(html).window.document;
test('pasted HTML preserves special spaces, breaks and basic styles without executing markup', () => {
  const result = pastedTextHtml('<p><b>A&nbsp;é</b> <span style="color:#aabbcc;font-size:18pt">word</span><br>next</p><p><i>end</i></p><script>bad()</script><img src="https://invalid.test/leak"><svg onload="bad()"><text>bad</text></svg>', { font: 'font', size: 16 }, document, parse);
  parseTextDocument(result);
  assert.equal(result.stories[0]!.source, 'A\u00a0é word\u2028next\nend');
  assert.equal(result.stories[0]!.spans[0]!.character!.weight, 700);
  const coloured = result.stories[0]!.spans.find(span => span.character!.size === 24)!;
  assert.deepEqual(parseColor(coloured.character!.color), parseColor('#aabbcc'));
  assert.ok(result.stories[0]!.spans.some(span => span.character!.italic));
});
test('copy uses literal source and a self-contained rich fragment', () => {
  const doc = pastedTextHtml('<div style="white-space:pre-wrap">*literal* &nbsp;<u>👩🏽‍💻</u>\n</div>', { font: 'font', size: 16 }, document, parse), story = doc.stories[0]!;
  const data = new Map<string, string>(); copyTextFragment({ setData: (type, value) => data.set(type, value) }, doc, story, { start: 0, end: story.source.length });
  assert.equal(data.get('text/plain'), '*literal* \u00a0👩🏽‍💻\n');
  assert.equal(parseTextDocument(data.get(TEXT_CLIPBOARD_MIME)).stories[0]!.source, story.source);
  assert.equal(parse(data.get('text/html')!).body.textContent, story.source);
});
test('hostile pasted markup has explicit node, depth and size bounds', () => {
  assert.throws(() => pastedTextHtml('<b>'.repeat(66) + 'text' + '</b>'.repeat(66), {}, document, parse), /complex/);
  assert.throws(() => pastedTextHtml('x'.repeat(65537), {}, document, parse), /limit/);
  assert.throws(() => pastedTextHtml('x'.repeat(524289), {}, document, parse), /large/);
});
test('wide-gamut colours and literal code survive rich paste and a second copy', () => {
  const doc = pastedTextHtml('<code style="color:color(display-p3 1 .2 .1)">"literal"  code</code>', { font: 'font', size: 16 }, document, parse);
  const story = doc.stories[0]!, span = story.spans[0]!;
  assert.equal(span.literal, true); assert.equal(parseColor(span.character!.color)?.space, 'display-p3');
  const data = new Map<string,string>(); copyTextFragment({ setData: (key,value) => data.set(key,value) },doc,story,{start:0,end:story.source.length});
  assert.ok(parseTextDocument(data.get(TEXT_CLIPBOARD_MIME)).stories[0]!.spans[0]!.literal);
  assert.equal(parse(data.get('text/html')!).querySelector('code')!.textContent, story.source);
});
