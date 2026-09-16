// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { analyzePdf } from '../src/pdf.ts';

test('PDF creator and producer retain separate software roles', async () => {
  const doc = await PDFDocument.create();
  doc.addPage(); doc.setCreator('Serif Affinity Publisher 2 2.0.0'); doc.setProducer('iLovePDF');
  const { findings } = await analyzePdf(await doc.save());
  assert.equal(findings.find((f) => f.label === 'Created with')?.detail, 'Serif Affinity Publisher 2 2.0.0');
  assert.equal(findings.find((f) => f.label === 'PDF producer')?.detail, 'iLovePDF');
});

test('PDF generator comments are reported separately from Info fields', async () => {
  const doc = await PDFDocument.create(); doc.addPage();
  const bytes = await doc.save({ useObjectStreams: false });
  const comment = new TextEncoder().encode('\n% Generator: Scribus 1.6\n');
  const annotated = new Uint8Array(bytes.length + comment.length);
  annotated.set(bytes); annotated.set(comment, bytes.length);
  assert.equal((await analyzePdf(annotated)).findings.find((f) => f.label === 'PDF generator comment')?.detail, 'Generator: Scribus 1.6');
});

for (const compressed of [false, true]) test(`PDF XMP ${compressed ? 'compressed' : 'plain'} packets expose software, history and rights`, async () => {
  const doc = await PDFDocument.create(); doc.addPage();
  const xmp = '<rdf:Description xmlns:app="http://ns.adobe.com/xap/1.0/" app:CreatorTool="Adobe InDesign 20.2" pdf:Producer="Adobe PDF Library 17.0"><stEvt:softwareAgent>Adobe Photoshop 26</stEvt:softwareAgent><cc:license rdf:resource="https://creativecommons.org/licenses/by/4.0/"/><dc:rights>© Ada</dc:rights></rdf:Description>';
  const data = new TextEncoder().encode(xmp);
  const stream = compressed ? doc.context.flateStream(data, { Type: 'Metadata', Subtype: 'XML' }) : doc.context.stream(data, { Type: 'Metadata', Subtype: 'XML' });
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(stream));
  const { findings } = await analyzePdf(await doc.save());
  for (const value of ['Adobe InDesign 20.2', 'Adobe PDF Library 17.0', 'Adobe Photoshop 26', 'https://creativecommons.org/licenses/by/4.0/', '© Ada']) assert.ok(findings.some((f) => f.detail === value), value);
});


test('PDF link findings preserve complete URI destinations and bound their count', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const urls = ['https://example.org/full/path?a=1&b=2#part', 'mailto:ada@example.org', 'javascript:alert(1)', 'https://example.org/' + 'a'.repeat(2050), ...Array.from({ length: 70 }, (_, i) => `https://example.org/${i}`)];
  page.node.set(PDFName.of('Annots'), doc.context.obj(urls.map((url) => doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 20, 20], A: { S: 'URI', URI: PDFString.of(url) } })))));
  const links = (await analyzePdf(await doc.save())).findings.filter((f) => f.label === 'Link');
  assert.equal(links.length, 64);
  assert.deepEqual(links.slice(0, 3).map((f) => f.detail), urls.slice(0, 3));
  assert.ok(links.every((f) => f.detail.length <= 2048));
});
