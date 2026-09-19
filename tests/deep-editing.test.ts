// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readDeepPng } from '../engine/src/deep-png.ts';
import { readDeepExr } from '../engine/src/deep-exr.ts';
import { readDeepTiff } from '../engine/src/deep-tiff.ts';
import { packPng } from '../engine/src/png.ts';
import { packExr } from '../engine/src/exr.ts';
import { packTiff } from '../engine/src/tiff.ts';
import { composeDeep } from '../engine/src/deep-compose.ts';
import { pqDecode, deepPreview } from '../engine/src/deep-image.ts';
import { pqEncode } from '../engine/src/hdr.ts';
import { exportDeepFrame } from '../engine/src/deep-export.ts';
import { runJxl } from '../packages/node-shell/src/jxl.ts';
import { decodeDeepImage } from '../engine/src/deep-decode.ts';
import { convertSpace, type DeepFrame } from '../engine/src/pixels.ts';
const frame: DeepFrame = { width: 2, height: 1, data: Float32Array.of(.12345,.12346,4,.5, 6,2,.25,1), space: 'srgb-linear' };
const near = (a:number,b:number,tolerance = 1e-5) => assert.ok(Math.abs(a-b)<tolerance, `${a} != ${b}`);
test('PNG16 adjacent codes and EXR half/float headroom survive original-byte decoding', () => {
  const png = readDeepPng(packPng(Uint16Array.of(12345,12346,65535,65535), { width:1,height:1,depth:16 }))!;
  assert.notEqual(png.data[0],png.data[1]);
  for (const compression of ['none','zips','zip'] as const) for (const pixelType of ['half','float'] as const) {
    const decoded = readDeepExr(packExr(frame,{compression,pixelType}))!;
    for(let i=0;i<frame.data.length;i++) near(decoded.data[i]!,frame.data[i]!,pixelType==='half'?.002:1e-6);
  }
});
test('TIFF float preserves headroom, and compositing preserves transparent-edge colours', () => {
  const tiff = readDeepTiff(packTiff(Float32Array.of(4,2,-.1),{ width:1,height:1,depth:'float32' }))!;
  near(tiff.data[0]!,4);near(tiff.data[2]!,-.1);
  const source: DeepFrame = {width:2,height:1,space:'srgb-linear',data:Float32Array.of(4,0,0,1,0,999,0,0)};
  const composite = composeDeep(4,1,[{frame:source,matrix:[2,0,0,1,0,0]}]);
  near(composite.data[4]!,4);near(composite.data[5]!,0);assert.ok(composite.data[7]!<1);
  const before = Array.from(composite.data);deepPreview(composite);assert.deepEqual(Array.from(composite.data),before);
});
test('PQ PNG and JPEG XL export reopens with absolute brightness and more than 8-bit precision', async () => {
  near(pqDecode(pqEncode(1000)),1000,.001);
  const source = {...frame,space:'srgb-linear' as const};
  for(const format of ['png','jxl-lossless']) {
    const blob = await exportDeepFrame(source,format,{hdr:true},{jxl:runJxl});
    const decoded = convertSpace(await decodeDeepImage(new Uint8Array(await blob.arrayBuffer()),{jxl:runJxl,sdr:async()=>{throw new Error('Unexpected SDR conversion');}}), 'srgb-linear');
    for(let i=0;i<frame.data.length;i++) near(decoded.data[i]!,frame.data[i]!,.005);
  }
});
test('invalid dimensions and corrupt compressed pixels are refused', () => {
  assert.throws(()=>composeDeep(8193,1024,[]),/8.4 megapixels/);
  const png=packPng(Uint16Array.of(0,1,2,65535),{width:1,height:1,depth:16});png[42]=png[42]!^1;
  assert.throws(()=>readDeepPng(png),/checksum/);
});
