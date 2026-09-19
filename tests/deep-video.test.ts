// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeVideoPlanes } from '../engine/src/deep-video.ts';
import { pqEncode } from '../engine/src/hdr.ts';
test('limited-range 10-bit PQ planes retain absolute highlight luminance',()=>{
  const white=Math.round(64+pqEncode(1000)*876),code=Uint16Array.of(white,white+1,white,white,512,512);
  const frame=decodeVideoPlanes({width:2,height:2,format:'I420P10',bytes:new Uint8Array(code.buffer),layout:[{offset:0,stride:4},{offset:8,stride:2},{offset:10,stride:2}],colorSpace:{primaries:'bt2020',transfer:'pq',matrix:'bt2020-ncl',fullRange:false}});
  assert.equal(frame.space,'rec2020-linear');assert.ok(Math.abs(frame.data[0]!*203-1000)<7);assert.ok(frame.data[4]!>frame.data[0]!);
});
test('opaque padding is not alpha, and invalid plane offsets fail before reads',()=>{
  const input={width:1,height:1,format:'RGBX',bytes:Uint8Array.of(255,0,0,0),layout:[{offset:0,stride:4}],colorSpace:{primaries:'bt709',transfer:'iec61966-2-1'}};
  assert.equal(decodeVideoPlanes(input).data[3],1);
  assert.throws(()=>decodeVideoPlanes({...input,layout:[{offset:9,stride:4}]}),/plane/);
});
