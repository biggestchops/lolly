// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auxiliaryMetadata } from '../engine/src/auxiliary-metadata.ts';
import { extractFileMetadata, readMpfIndex } from '../engine/src/file-metadata.ts';
import { assembleGainMapJpeg, buildXmpApp1, repairMpfOffsets } from '../engine/src/gainmap-jpeg.ts';
import { insertJpegSegments } from '../engine/src/jpeg-segments.ts';
import { softwareOrigins } from '../engine/src/software-origin.ts';

const APPLE = `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="XMP Core 6.0.0"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:apdi="http://ns.apple.com/pixeldatainfo/1.0/" xmlns:HDRGainMap="http://ns.apple.com/HDRGainMap/1.0/">
<apdi:NativeFormat>1278226488</apdi:NativeFormat><apdi:StoredFormat>1278226488</apdi:StoredFormat><apdi:AuxiliaryImageType>urn:com:apple:photo:2020:aux:hdrgainmap</apdi:AuxiliaryImageType><HDRGainMap:HDRGainMapVersion>131072</HDRGainMap:HDRGainMapVersion><HDRGainMap:HDRGainMapHeadroom>3.388724</HDRGainMap:HDRGainMapHeadroom></rdf:Description></rdf:RDF></x:xmpmeta>`;
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0, 1, 2, 3, 0xff, 0xd9]);
const assembled = assembleGainMapJpeg(jpeg, jpeg, { channels: 1, gainMapMin: 0, gainMapMax: 2, gamma: 1, offsetSdr: 0, offsetHdr: 0, hdrCapacityMin: 0, hdrCapacityMax: 2, baseRendition: 'sdr', useBaseColorSpace: true });

function withPacket(packet: string): Uint8Array {
  const start = readMpfIndex(assembled)!.images[1]!.start;
  const map = insertJpegSegments(assembled.subarray(start), [buildXmpApp1(packet)], { replace: true });
  return repairMpfOffsets(Buffer.concat([assembled.subarray(0, start), map]));
}

test('an indexed Apple gain map exposes readable RDF and its original packet', () => {
  const meta = extractFileMetadata(withPacket(APPLE));
  const embedded = meta.appended!.metadata!;
  assert.equal(embedded.name, 'Apple HDR gain map');
  assert.equal(embedded.xmp, APPLE);
  assert.equal(embedded.fields.length, 6);
  assert.equal(embedded.fields.find((f) => f.label === 'Recorded HDR headroom')!.value, '3.388724');
  assert.equal(embedded.fields.find((f) => f.label === 'Native pixel format')!.source, 'XMP/RDF apdi:NativeFormat');
  assert.deepEqual(softwareOrigins(embedded.fields).map((a) => [a.name, a.role]), [['XMP Core', 'export']]);
});

test('embedded software and licences never become primary-image provenance', () => {
  const meta = extractFileMetadata(withPacket(APPLE.replace('</rdf:Description>', '<xmp:CreatorTool>GIMP 3</xmp:CreatorTool><cc:license rdf:resource="https://creativecommons.org/licenses/by/4.0/"/></rdf:Description>')));
  assert.ok(meta.appended!.metadata!.fields.some((f) => f.label === 'Licence'));
  assert.ok(!meta.fields.some((f) => f.value.includes('GIMP') || f.label === 'Licence'));
  assert.deepEqual(softwareOrigins(meta.fields), []);
  const unindexed = Buffer.concat([jpeg, insertJpegSegments(jpeg, [buildXmpApp1(APPLE)])]);
  assert.equal(extractFileMetadata(unindexed).appended!.metadata, undefined);
});

test('Ultra HDR properties, namespace aliases and malformed packets remain bounded', () => {
  const meta = extractFileMetadata(assembled).appended!.metadata!;
  assert.equal(meta.name, 'HDR gain map');
  assert.ok(meta.fields.some((f) => f.label === 'Maximum gain' && f.value === '2'));
  const renamed = auxiliaryMetadata(APPLE.replaceAll('apdi', 'pixel'), true);
  assert.equal(renamed.name, 'Apple HDR gain map');
  const wrong = auxiliaryMetadata(APPLE.replace('http://ns.apple.com/pixeldatainfo/1.0/', 'https://example.com/unrelated'), true);
  assert.equal(wrong.name, 'HDR gain map');
  assert.equal(auxiliaryMetadata('x'.repeat(2 * 1024 * 1024), true).xmp.length, 1024 * 1024);
  assert.doesNotThrow(() => extractFileMetadata(withPacket(APPLE).subarray(0, 250)));
});
