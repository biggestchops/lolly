// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { metadataUrl, metadataLinkHtml, metadataValueHtml, visibleLinkedTextHtml } from './valid-links.ts';
import { auxiliaryMetadataHtml } from './valid-auxiliary.ts';

test('metadata links allow only explicit web destinations without credentials or hidden characters', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd', '//example.com', 'https://good.example@bad.example/', 'https://bad.example/\u202ehidden', 'https://bad.example/\nnext', 'https://' + 'x'.repeat(2048)]) {
    assert.equal(metadataUrl(value), null, value);
    assert.ok(!metadataLinkHtml(value).includes('data-metadata-url'), value);
  }
  assert.equal(metadataUrl('https://creativecommons.org/licenses/by/4.0/'), 'https://creativecommons.org/licenses/by/4.0/');
  assert.ok(metadataLinkHtml('http://example.com').includes('Unverified link'));
});

test('URLs inside prose are clickable and all surrounding metadata remains escaped', () => {
  const html = metadataValueHtml('<img onerror="bad"> Created with Inkscape (https://inkscape.org/). See https://example.com/?a=1&b=2');
  assert.ok(html.includes('&lt;img onerror='));
  assert.equal((html.match(/data-metadata-url=/g) ?? []).length, 2);
  assert.ok(html.includes('href="https://inkscape.org/"'));
  assert.ok(html.includes('href="https://example.com/?a=1&amp;b=2"'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
});

test('embedded RDF has scoped fields and a closed, escaped XML disclosure', () => {
  const html = auxiliaryMetadataHtml({ format: 'JPEG', fields: [], appended: {
    kind: 'HDR gain map', offset: 100, bytes: 50, declared: true,
    metadata: { name: 'Apple HDR gain map', fields: [{ label: 'Source', value: 'https://example.com/', group: 'description', source: 'XMP/RDF dc:source' }], xmp: '<script>bad()</script>' },
  } });
  assert.ok(html.includes('Metadata from the embedded image. Not authenticated.'));
  assert.ok(html.includes('XMP/RDF dc:source') && html.includes('data-metadata-url'));
  assert.ok(html.includes('&lt;script&gt;bad()&lt;/script&gt;'));
  assert.ok(!html.includes('<script>') && !/<details[^>]*\sopen(?:\s|>)/.test(html));
});


test('text extracts link web addresses without hiding invisible-character evidence', () => {
  const html = visibleLinkedTextHtml('Ask https://example.org/path about the hidden \u200b character. <script>');
  assert.ok(html.includes('data-metadata-url="https://example.org/path"'));
  assert.ok(html.includes('valid-invis') && html.includes('U+200B'));
  assert.ok(html.includes('&lt;script&gt;'));
  const tainted = visibleLinkedTextHtml('https://example.org/\u202eevil');
  assert.ok(!tainted.includes('data-metadata-url'));
  assert.ok(tainted.includes('U+202E'));
});
