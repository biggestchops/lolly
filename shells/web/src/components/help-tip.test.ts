// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { helpTip } from './help-tip.ts';

test('help links reject executable and protocol-relative destinations', () => {
  for (const href of ['javascript:alert(1)', 'data:text/html,test', '//example.com', '/\\example.com']) {
    const { pop } = helpTip('Explanation', { href, text: 'More' });
    const doc = new JSDOM(pop).window.document;
    assert.equal(doc.querySelector('a'), null, href);
    assert.equal(doc.body.textContent, 'Explanation');
  }
});

test('help links preserve internal routes and escape external URLs and labels', () => {
  const internal = new JSDOM(helpTip('Explanation', { href: '#/settings' }).pop).window.document.querySelector('a')!;
  assert.equal(internal.getAttribute('href'), '#/settings');
  assert.equal(internal.hasAttribute('target'), false);
  const href = 'https://example.com/?a="test"&b=1';
  const doc = new JSDOM(helpTip('<Explanation>', { href, text: '<More>' }).pop).window.document;
  const external = doc.querySelector('a')!;
  assert.equal(external.getAttribute('href'), href);
  assert.equal(external.textContent, '<More>');
  assert.equal(external.getAttribute('rel'), 'noopener');
  assert.equal(doc.querySelector('More'), null);
});
