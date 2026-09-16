// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { softwareName, softwareOrigins, xmlProvenanceFields } from '../engine/src/software-origin.ts';
import { extractFileMetadata } from '../engine/src/file-metadata.ts';
import { embedWavInfo } from '../engine/src/riff-meta.ts';

const bytes = (s: string) => new TextEncoder().encode(s);
const fields = (value: string, label = 'Software') => [{ label, value, group: 'software' as const }];
function pngText(keyword: string, text: string, kind = 'zTXt'): Uint8Array {
  const payload = kind === 'zTXt' ? Buffer.concat([Buffer.from(keyword + '\0\0'), deflateSync(text)])
    : kind === 'iTXt' ? Buffer.concat([Buffer.from(keyword + '\0\x01\0\0\0'), deflateSync(text)])
    : Buffer.from(keyword + '\0' + text);
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(type), data, Buffer.alloc(4)]);
  };
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk(kind, payload), chunk('IEND', Buffer.alloc(0))]);
}

test('specific creative products survive vendor prefixes and versions', () => {
  for (const [raw, expected] of [
    ['Serif Affinity Publisher 2 2.0.0', 'Affinity Publisher'], ['Adobe InDesign 20.2 (Macintosh)', 'Adobe InDesign'],
    ['Adobe Photoshop 26.0', 'Adobe Photoshop'], ['Adobe Photoshop Lightroom Classic 14.0', 'Adobe Photoshop Lightroom'],
    ['CorelDRAW 2025', 'CorelDRAW'], ['GNU Image Manipulation Program', 'GIMP'], ['Krita 5.2', 'Krita'],
    ['Scribus 1.6.3', 'Scribus'], ['Inkscape 1.4 (abcd)', 'Inkscape'], ['Canva', 'Canva'],
    ['Figma', 'Figma'], ['Penpot 2.0', 'Penpot'], ['Blender 4.3', 'Blender'], ['DaVinci Resolve Studio 19', 'DaVinci Resolve'],
    ['Audacity 3.7', 'Audacity'], ['Microsoft PowerPoint 16', 'Microsoft PowerPoint'], ['LibreOffice 24.8', 'LibreOffice'],
    ['Lolly/1.197', 'Lolly'], ['Lavf61.7.100', 'FFmpeg'],
  ]) assert.equal(softwareName(raw!), expected, raw!);
});

test('authoring apps lead a distinct export stack, with exact versions in evidence', () => {
  const apps = softwareOrigins([...fields('iLovePDF', 'PDF producer'), ...fields('Serif Affinity Publisher 2 2.0.0', 'Created with')]);
  assert.deepEqual(apps.map((a) => [a.name, a.role]), [['Affinity Publisher', 'authoring'], ['iLovePDF', 'export']]);
  assert.equal(apps[0]!.evidence[0]!.value, 'Serif Affinity Publisher 2 2.0.0');
  assert.deepEqual(softwareOrigins([...fields('Canva'), ...fields('Canva', 'PDF producer')]).map((a) => [a.name, a.evidence.length]), [['Canva', 2]]);
  assert.equal(softwareOrigins(fields('cairo 1.18', 'Created with'))[0]!.role, 'export');
});

test('unlisted software is retained; ordinary text and author names are not app detections', () => {
  assert.equal(softwareOrigins(fields('A New Studio 9.2'))[0]!.name, 'A New Studio 9.2');
  assert.deepEqual(softwareOrigins([
    { label: 'Title', value: 'Canva for infographics', group: 'description' },
    { label: 'Creator', value: 'Sketch', group: 'authorship' },
    { label: 'Description', value: 'How to use GIMP and Inkscape', group: 'description' },
    { label: 'Digital source type', value: 'trainedAlgorithmicMedia', group: 'software' },
  ]), []);
  assert.equal(softwareOrigins([{ label: 'Comment', value: 'Created with GIMP', group: 'description' }])[0]!.evidence[0]!.kind, 'hint');
});

test('SVG comments and editor markers preserve multiple apps without trusting common RDF namespaces', () => {
  const meta = extractFileMetadata(bytes('<?xml version="1.0"?><!-- Created with Inkscape (http://www.inkscape.org/) --><svg xmlns="http://www.w3.org/2000/svg" inkscape:version="1.4"><!-- Generator: Adobe Illustrator 28.0, SVG Export Plug-In --></svg>'));
  const apps = softwareOrigins(meta.fields);
  assert.deepEqual(apps.map((a) => a.name), ['Inkscape', 'Adobe Illustrator']);
  assert.ok(apps.every((a) => a.evidence.every((e) => e.kind === 'hint')));
  assert.deepEqual(softwareOrigins(extractFileMetadata(bytes('<svg xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"><title>Inkscape manual</title></svg>')).fields), []);
});

test('XMP attributes, alternate namespace prefixes, history and XML entities are read', () => {
  const meta = xmlProvenanceFields('<rdf:Description xmlns:app="http://ns.adobe.com/xap/1.0/" app:CreatorTool="Krita 5.2 &amp; plug-ins"><pdf:Producer>Ghostscript 10</pdf:Producer><stEvt:softwareAgent>GIMP 3</stEvt:softwareAgent></rdf:Description>');
  assert.deepEqual(softwareOrigins(meta).map((a) => [a.name, a.role]), [['Krita', 'authoring'], ['Ghostscript', 'export'], ['GIMP', 'history']]);
  assert.equal(meta[0]!.source, 'XMP/RDF app:CreatorTool');
  assert.equal(meta[0]!.value, 'Krita 5.2 & plug-ins');
  assert.deepEqual(xmlProvenanceFields('<rdf:Description xmlns:xmp="https://example.com/other" xmp:CreatorTool="Canva"/>'), []);
});

test('RDF Creative Commons licence, copyright and usage terms remain distinct', () => {
  const meta = xmlProvenanceFields('<rdf:RDF><cc:Work><cc:license rdf:resource="https://creativecommons.org/licenses/by-sa/4.0/"/><dc:rights><rdf:Alt><rdf:li xml:lang="x-default">© Ada</rdf:li></rdf:Alt></dc:rights><xmpRights:UsageTerms>Credit Ada</xmpRights:UsageTerms></cc:Work></rdf:RDF>');
  assert.deepEqual(meta.map((f) => [f.label, f.value]), [['Rights', '© Ada'], ['Usage terms', 'Credit Ada'], ['Licence', 'https://creativecommons.org/licenses/by-sa/4.0/']]);
});

test('compressed PNG text and compressed iTXt XMP reveal software and licences', () => {
  assert.equal(softwareOrigins(extractFileMetadata(pngText('Software', 'Krita 5.2')).fields)[0]!.name, 'Krita');
  assert.equal(softwareOrigins(extractFileMetadata(pngText('Comment', 'Created with GIMP')).fields)[0]!.name, 'GIMP');
  const xmp = '<rdf:Description xmp:CreatorTool="Scribus 1.6" cc:license="https://creativecommons.org/licenses/by/4.0/"/>';
  const meta = extractFileMetadata(pngText('XML:com.adobe.xmp', xmp, 'iTXt'));
  assert.equal(softwareOrigins(meta.fields)[0]!.name, 'Scribus');
  assert.ok(meta.fields.some((f) => f.label === 'Licence'));
  assert.equal(softwareOrigins(extractFileMetadata(pngText('software', 'Procreate', 'tEXt')).fields)[0]!.name, 'Procreate');
});

test('oversized metadata, malformed XML and truncated compressed chunks stay bounded', () => {
  assert.equal(extractFileMetadata(pngText('Software', 'A'.repeat(2 * 1024 * 1024))).fields.length, 0);
  assert.ok(xmlProvenanceFields('<xmp:CreatorTool>' + 'a'.repeat(3 * 1024 * 1024)).length === 0);
  assert.doesNotThrow(() => extractFileMetadata(pngText('Software', 'Krita').subarray(0, 25)));
  assert.equal(xmlProvenanceFields('<xmp:CreatorTool>&#x110000;Krita</xmp:CreatorTool>')[0]!.value, 'Krita');
  assert.deepEqual(xmlProvenanceFields('<xmp:CreatorTool>'.repeat(50000)), []);
});

test('GIF comments identify a generator without scanning pixels', () => {
  const comment = Buffer.from('Created with GIMP');
  const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.from([1, 0, 1, 0, 0, 0, 0, 0x21, 0xfe, comment.length]), comment, Buffer.from([0, 0x3b])]);
  assert.equal(softwareOrigins(extractFileMetadata(gif).fields)[0]!.name, 'GIMP');
});

test('WAV INFO exposes audio software, artist and copyright without reading samples', () => {
  const wav = Buffer.alloc(44); wav.write('RIFF'); wav.writeUInt32LE(36, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.write('data', 36);
  const meta = extractFileMetadata(embedWavInfo(wav, { software: 'Audacity 3.7.1', artist: 'Ada', copyright: 'CC BY 4.0' }));
  assert.equal(meta.format, 'WAV');
  assert.equal(softwareOrigins(meta.fields)[0]!.name, 'Audacity');
  assert.equal(meta.fields.find((f) => f.label === 'Copyright')?.value, 'CC BY 4.0');
  const truncated = Buffer.from(wav); truncated.writeUInt32LE(0xffffffff, 16);
  assert.doesNotThrow(() => extractFileMetadata(truncated));
});


test('XMP contact fields retain explicit IPTC sources, including namespace aliases', () => {
  const fields = xmlProvenanceFields('<rdf:Description xmlns:i="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/"><i:CreatorContactInfo><i:CiEmailWork>ada@example.org</i:CiEmailWork><i:CiTelWork>+44 7123 456789</i:CiTelWork><i:CiUrlWork>https://example.org/ada</i:CiUrlWork></i:CreatorContactInfo></rdf:Description>');
  assert.deepEqual(fields.map((f) => f.label), ['Contact email', 'Contact phone', 'Contact website']);
  assert.ok(fields.every((f) => f.group === 'authorship' && f.source?.startsWith('XMP/RDF i:Ci')));
});
