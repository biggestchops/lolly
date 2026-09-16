// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { provenanceOverview, provenanceOverviewHtml, provenanceSummaryHtml, pdfProvenanceField } from './valid-provenance.ts';
import type { VerifyReport } from './valid-verdict.ts';
import type { FileMetadata } from '@lolly/engine';

const report = (overrides: Partial<VerifyReport> = {}): VerifyReport => ({
  found: false, state: 'none', trusted: false, madeWithLolly: false, likelyMadeWithLolly: false,
  partsMadeWithLolly: false, delivered: false, format: 'pdf', checks: [], ...overrides,
});
const claim = { title: '', format: '', claimGenerator: 'Adobe InDesign 20.2', generatorInfo: null, instanceId: '', manifestLabel: '', actions: [] };
const metadata: FileMetadata = { format: 'PDF', fields: [
  { label: 'Created with', value: 'Serif Affinity Publisher 2 2.0.0', group: 'software', source: 'PDF Info Creator' },
  { label: 'PDF producer', value: 'iLovePDF', group: 'software', source: 'PDF Info Producer' },
  { label: 'Author', value: 'Ada', group: 'authorship' },
  { label: 'Created', value: '2025-01-02', group: 'timestamps' },
  { label: 'Licence', value: 'https://creativecommons.org/licenses/by-sa/4.0/', group: 'authorship' },
] };

test('unsigned file gives authoring software, export stack, licence and key facts equal access', () => {
  const model = provenanceOverview(report(), metadata);
  assert.deepEqual(model.apps.map((a) => [a.name, a.role]), [['Affinity Publisher', 'authoring'], ['iLovePDF', 'export']]);
  assert.equal(model.rights[0]!.name, 'CC BY-SA 4.0');
  assert.deepEqual(model.facts.map((f) => f.label), ['Creator', 'Created']);
  const html = provenanceOverviewHtml(report(), metadata);
  for (const label of ['Affinity Publisher', 'iLovePDF', 'CC BY-SA 4.0', 'PDF Info Creator', '2.0.0', 'Metadata', 'Evidence (2)']) assert.ok(html.includes(label), label);
  assert.ok(!html.includes('is-credential'));
  const compact = provenanceSummaryHtml(report(), metadata);
  assert.ok(compact.includes('Affinity Publisher +1') && compact.includes('CC BY-SA 4.0'));
});

test('only an intact credential with a checked binding earns the intact evidence label', () => {
  for (const overrides of [{}, { found: true, state: 'invalid' as const }, { found: true, state: 'valid' as const }]) {
    const model = provenanceOverview(report({ claim, ...overrides }));
    assert.ok(model.apps.every((a) => a.evidence.every((e) => e.kind !== 'credential')));
  }
  const valid = report({ claim, found: true, state: 'valid', checks: [{ code: 'assertion.dataHash.match', ok: true, explanation: '' }] });
  const model = provenanceOverview(valid, metadata);
  assert.equal(model.apps.find((a) => a.name === 'Adobe InDesign')!.evidence[0]!.kind, 'credential');
  assert.equal(model.apps.find((a) => a.name === 'Affinity Publisher')!.evidence[0]!.kind, 'metadata');
  const broken = provenanceOverview({ ...valid, state: 'invalid', checks: [{ code: 'assertion.dataHash.mismatch', ok: false, explanation: '' }] });
  assert.equal(broken.apps[0]!.evidence[0]!.kind, 'unverified-credential');
});

test('delivery software and history never become the authoring app by inference', () => {
  const model = provenanceOverview(report({ found: true, claim, delivered: true, history: [{ action: 'edited', when: '', softwareAgent: 'Adobe Photoshop 26' }] }));
  assert.deepEqual(model.apps.map((a) => a.role), ['export', 'history']);
});

test('PDF XMP fields retain source names and classify software history', () => {
  assert.equal(pdfProvenanceField('XMP/RDF app:CreatorTool').group, 'software');
  assert.equal(pdfProvenanceField('XMP/RDF cc:license').group, 'authorship');
  assert.equal(pdfProvenanceField('XMP/RDF stEvt:softwareAgent').label, 'Software history');
});

test('iPhone model leads the report; a numeric EXIF Software value is an OS version', () => {
  const photo: FileMetadata = { format: 'JPEG', fields: [
    { label: 'Camera', value: 'Apple iPhone 16 Pro Max', group: 'device' },
    { label: 'Software', value: '27', group: 'software', source: 'JPEG EXIF Software' },
    { label: 'Taken', value: '2026:09:15 12:00:00', group: 'timestamps' },
  ] };
  const model = provenanceOverview(report(), photo);
  assert.equal(model.devices[0]!.name, 'Apple iPhone 16 Pro Max');
  assert.deepEqual(model.apps.map((a) => [a.name, a.role]), [['iOS 27', 'system']]);
  assert.equal(model.apps[0]!.evidence[0]!.value, '27');
  assert.equal(model.facts[0]!.label, 'Captured');
  const html = provenanceOverviewHtml(report(), photo);
  assert.ok(html.indexOf('iPhone 16 Pro Max') < html.indexOf('iOS 27'));
  assert.ok(provenanceSummaryHtml(report(), photo).includes('Apple iPhone 16 Pro Max'));
  assert.ok(provenanceSummaryHtml(report(), { ...photo, fields: photo.fields.slice(0, 1) }).includes('iPhone 16 Pro Max'));
  assert.equal(provenanceOverview(report(), { format: 'TIFF', fields: photo.fields.slice(1) }).apps.length, 0, 'a bare version never becomes an unknown app name');
});

test('unknown generator and absent licence remain unknown', () => {
  const html = provenanceOverviewHtml(report());
  assert.ok(html.includes('Generator not identified'));
  assert.ok(html.includes('No licence recorded'));
  assert.ok(!html.includes('Evidence ('));
  assert.equal(provenanceSummaryHtml(report()), '');
});

test('rights declarations retain conflicting notices and never imply permission', () => {
  const model = provenanceOverview(report({ found: true, rights: 'All rights reserved' }), metadata);
  assert.equal(model.rights.length, 2);
  assert.equal(model.rights[0]!.evidence[0]!.kind, 'unverified-credential');
  assert.ok(provenanceOverviewHtml(report(), metadata).includes('Permission to reuse is not verified.'));
});

test('all metadata, app names, licences and evidence are escaped and bounded', () => {
  const malicious = '<img src=x onerror=alert(1)>';
  const meta: FileMetadata = { format: 'SVG', fields: [
    { label: 'Software', value: malicious, group: 'software', source: malicious },
    { label: 'Licence', value: malicious, group: 'authorship' },
  ] };
  for (const html of [provenanceOverviewHtml(report(), meta), provenanceSummaryHtml(report(), meta)]) {
    assert.ok(!html.includes('<img'));
    assert.ok(html.includes('&lt;img'));
  }
  assert.ok(provenanceOverview(report(), { format: 'PNG', fields: [{ label: 'Software', value: 'z'.repeat(10000), group: 'software' }] }).apps[0]!.name.length <= 2048);
});
