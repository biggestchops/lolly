// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { runJxl } from '../packages/node-shell/src/jxl.ts';
import { isJxl } from '../engine/src/jxl.ts';
const pixels = Uint8Array.from({ length: 16 * 12 * 4 }, (_, i) => i % 251);
test('real portable codec preserves RGBA8, including invisible RGB, and rejects broken input', async () => {
  for (let i = 3; i < pixels.length; i += 20) pixels[i] = 0;
  const encoded = await runJxl({ operation: 'encode', bytes: pixels, width: 16, height: 12, options: { lossless: true } });
  assert.ok(isJxl(encoded.bytes));
  const { info } = await runJxl({ operation: 'probe', bytes: encoded.bytes });
  assert.equal(info?.width, 16); assert.equal(info?.height, 12); assert.equal(info?.alphaBits, 8);
  const decoded = await runJxl({ operation: 'decode', bytes: encoded.bytes });
  assert.deepEqual(decoded.bytes, pixels);
  await assert.rejects(runJxl({ operation: 'decode', bytes: encoded.bytes.subarray(0, 20) }), /truncated|Invalid/);
});
test('JPEG recompression verifies complete progressive JPEG bytes including EXIF, ICC and orientation', async () => {
  const jpeg = await sharp(pixels, { raw: { width: 16, height: 12, channels: 4 } }).jpeg({ progressive: true }).withMetadata({ orientation: 6 }).toBuffer();
  const encoded = await runJxl({ operation: 'recompress', bytes: jpeg });
  const probe = await runJxl({ operation: 'probe', bytes: encoded.bytes });
  assert.equal(probe.info?.reconstruction, true);
  const restored = await runJxl({ operation: 'restore', bytes: encoded.bytes });
  assert.deepEqual(restored.bytes, new Uint8Array(jpeg));
});
test('16-bit encoded-domain samples survive without a canvas and all orientations are applied once', async () => {
  const ramp = Uint16Array.from({ length: 16 * 12 * 4 }, (_, i) => (i * 103) % 65536);
  const raw = new Uint8Array(ramp.buffer);
  const encoded = await runJxl({ operation: 'encode', bytes: raw, width: 16, height: 12, sample: 1, options: { lossless: true } });
  const decoded = await runJxl({ operation: 'decode16', bytes: encoded.bytes });
  assert.equal(decoded.info?.bitsPerSample, 16); assert.deepEqual(decoded.bytes, raw);
  for (let orientation = 1; orientation <= 8; orientation++) {
    const oriented = await runJxl({ operation: 'encode', bytes: pixels, width: 16, height: 12, orientation, options: { lossless: true } });
    const header = (await runJxl({ operation: 'probe', bytes: oriented.bytes })).info!;
    const displayed = (await runJxl({ operation: 'decode', bytes: oriented.bytes })).info!;
    assert.equal(header.orientation, orientation); assert.equal(displayed.orientation, 1);
    assert.equal(header.width, orientation >= 5 ? 12 : 16); assert.equal(displayed.width, header.width); assert.equal(displayed.height, header.height);
  }
});
test('Node Convert reports preservation only for verified JPEG operations and uses the portable codec for still targets', async () => {
  const { runNodeFileOperation } = await import('../packages/node-shell/src/file-operations.ts');
  const jpeg = await sharp(pixels, { raw: { width: 16, height: 12, channels: 4 } }).jpeg({ progressive: true }).withMetadata().toBuffer();
  const source = new File([jpeg], 'source.jpg', { type: 'image/jpeg' });
  const packed = await runNodeFileOperation(source, { version: 1, operation: 'convert', target: 'jxl-recompress', options: {} });
  assert.ok(packed.output, JSON.stringify(packed.report)); assert.equal(packed.output.type, 'image/jxl'); assert.equal(packed.report.metadata, 'preserved');
  const restored = await runNodeFileOperation(packed.output, { version: 1, operation: 'convert', target: 'jpeg-original', options: {} });
  assert.ok(restored.output, JSON.stringify(restored.report)); assert.deepEqual(Buffer.from(await restored.output.arrayBuffer()), jpeg);
  const refused = await runNodeFileOperation(source, { version: 1, operation: 'convert', target: 'jxl-recompress', options: { maxEdge: 8 } });
  assert.equal(refused.report.state, 'failed');
  const png = await sharp(pixels, { raw: { width: 16, height: 12, channels: 4 } }).png().toBuffer();
  const pngFile = new File([png], 'source.png', { type: 'image/png' });
  const encoded = await runNodeFileOperation(pngFile, { version: 1, operation: 'convert', target: 'jxl-lossless', options: {} });
  assert.ok(encoded.output, JSON.stringify(encoded.report));
  const decoded = await runJxl({ operation: 'decode', bytes: new Uint8Array(await encoded.output.arrayBuffer()) });
  assert.deepEqual(decoded.bytes, pixels); assert.equal(encoded.report.metadata, 'removed');
  const output = await runNodeFileOperation(encoded.output, { version: 1, operation: 'convert', target: 'png', options: {} });
  assert.ok(output.output, JSON.stringify(output.report));
  assert.deepEqual(new Uint8Array(await sharp(Buffer.from(await output.output.arrayBuffer())).raw().toBuffer()), pixels);
});
test('JXL metadata survives the container wrapper and original asset bytes stay separate from the PNG display', async () => {
  const { jxlWithXmp, jxlXmp } = await import('../engine/src/jxl-container.ts');
  const { prepareJxlAsset } = await import('../packages/node-shell/src/jxl-asset.ts');
  const { bytes } = await runJxl({ operation: 'encode', bytes: pixels, width: 16, height: 12, options: { lossless: true } });
  const { buildExportXmp } = await import('../engine/src/image-meta.ts');
  const boxed = jxlWithXmp(bytes, buildExportXmp({ author: 'JXL fixture', copyright: 'Test copyright', software: 'Lolly test', source: '', tool: '', contact: '', description: '' }));
  assert.match(jxlXmp(boxed)!, /JXL fixture/);
  assert.deepEqual((await runJxl({ operation: 'decode', bytes: boxed })).bytes, pixels);
  const source = `data:image/jxl;base64,${Buffer.from(boxed).toString('base64')}`;
  const ref = await prepareJxlAsset({ id: 'test', source: 'user', type: 'raster', format: 'jxl', url: source }, boxed);
  assert.equal(ref.original?.url, source); assert.equal(ref.format, 'jxl'); assert.match(ref.url, /^data:image\/png/);
  const { assetBytes } = await import('../packages/node-shell/src/asset-bytes.ts');
  assert.deepEqual(await assetBytes(ref), boxed);
  assert.deepEqual(await sharp(await assetBytes(ref.url)).raw().toBuffer(), Buffer.from(pixels));
});
test('real fixtures expose source colour/depth, and refuse animation, auxiliary channels and excessive dimensions', async () => {
  const { readFile } = await import('node:fs/promises');
  const fixture = (name: string) => readFile(new URL(`fixtures/jxl/${name}.jxl`, import.meta.url));
  const gray = await runJxl({ operation: 'decode', bytes: await fixture('gray') });
  assert.equal(gray.info?.colorChannels, 1); assert.equal(gray.bytes.length, 3 * 2 * 4);
  assert.equal(gray.bytes[0], gray.bytes[1]); assert.equal(gray.bytes[1], gray.bytes[2]);
  const p3 = await fixture('p3');
  assert.equal((await runJxl({ operation: 'probe', bytes: p3 })).info?.primaries, 11);
  assert.equal((await runJxl({ operation: 'decode', bytes: p3 })).bytes.length, 24);
  const pq = await fixture('pq-gradient'), original = pq.slice();
  const hdr = await runJxl({ operation: 'probe', bytes: pq });
  assert.equal(hdr.info?.hdr, true); assert.equal(hdr.info?.bitsPerSample, 16); assert.equal(hdr.info?.intensityTarget, 10000);
  const display = await runJxl({ operation: 'decode', bytes: pq });
  assert.equal(display.bytes.length, hdr.info!.width * hdr.info!.height * 4); assert.deepEqual(pq, original);
  assert.equal((await runJxl({ operation: 'probe', bytes: await fixture('animation') })).info?.animated, true);
  await assert.rejects(runJxl({ operation: 'decode', bytes: await fixture('animation') }), /Animated/);
  await assert.rejects(runJxl({ operation: 'decode', bytes: await fixture('auxiliary') }), /auxiliary/);
  await assert.rejects(runJxl({ operation: 'probe', bytes: await fixture('oversized') }), /16384/);
  await assert.rejects(runJxl({ operation: 'restore', bytes: p3 }), /no original JPEG/);
});

test('CLI resolves JXL asset bytes despite missing extensions and incorrect MIME types', async () => {
  const { createServer } = await import('node:http');
  const { once } = await import('node:events');
  const { JSDOM } = await import('jsdom');
  const { createCliBridge } = await import('../shells/cli/src/bridge.ts');
  const { bytes } = await runJxl({ operation: 'encode', bytes: pixels, width: 16, height: 12 });
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/octet-stream' });
    response.end(bytes);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const dom = new JSDOM('<!doctype html><body></body>');
  try {
    const host = await createCliBridge({ dom });
    const address = server.address() as { port: number };
    for (const id of [`http://127.0.0.1:${address.port}/image`, `data:application/octet-stream;base64,${Buffer.from(bytes).toString('base64')}`]) {
      const ref = await host.assets.get(id);
      assert.ok(ref); assert.equal(ref.format, 'jxl'); assert.match(ref.url, /^data:image\/png/);
      assert.deepEqual(await host.assets.bytes!(ref), bytes);
    }
  } finally { dom.window.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
