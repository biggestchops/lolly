// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSequenceMarks, serialiseSequenceMarks, sequenceRange, chaptersVtt } from '../engine/src/sequence-marks.ts';
import { sequenceExportSize } from '../shells/web/src/bridge/sequence-preflight.ts';
import { offsetMix } from '../shells/web/src/bridge/sequence-range.ts';
import { mixWindow } from '../shells/web/src/bridge/mix-window.ts';

test('marker wire round-trips labels, ranges and chapters through a URL', () => {
  const marks = { inMs: 500, outMs: 3000, markers: [
    { kind: 'c' as const, ms: 500, color: '123abc', label: 'A | B, 100% / 日本語' },
    { kind: 'r' as const, ms: 1000, endMs: 2500, color: 'ff0000', label: '<title>' },
  ] };
  const params = new URLSearchParams({ sequenceMarks: serialiseSequenceMarks(marks) });
  assert.deepEqual(parseSequenceMarks(new URLSearchParams(params.toString()).get('sequenceMarks')), marks);
});
test('malformed, oversized and future marker wires do not manufacture marks', () => {
  assert.deepEqual(parseSequenceMarks('v2|m,100,,ffffff,x'), { markers: [] });
  assert.deepEqual(parseSequenceMarks(`v1|${'x'.repeat(65_536)}`), { markers: [] });
  assert.deepEqual(parseSequenceMarks('v1|m,NaN,,ffffff,x|m,-1,,ffffff,x|m,1,,ffffff,%zz'), { markers: [] });
  assert.equal(parseSequenceMarks('v1|m,1,,oops,text').markers[0]?.color, '888888');
});
test('marks beyond a shortened project never extend its duration or produce an empty export', () => {
  assert.deepEqual(sequenceRange({ markers: [], inMs: 200, outMs: 9000 }, 1000), { fromMs: 200, toMs: 1000 });
  assert.deepEqual(sequenceRange({ markers: [], inMs: 2000, outMs: 9000 }, 1000), { fromMs: 0, toMs: 1000 });
  assert.deepEqual(sequenceRange({ markers: [], inMs: 600, outMs: 200 }, 1000), { fromMs: 0, toMs: 1000 });
});
test('chapter sidecar uses absolute times and excludes notes and markers', () => {
  const marks = parseSequenceMarks('v1|c,0,,ffffff,Start|n,500,,ffffff,Note|c,1250,,ffffff,Next');
  assert.equal(chaptersVtt(marks, 3000), 'WEBVTT\n\n00:00:00.000 --> 00:00:01.250\nStart\n\n00:00:01.250 --> 00:00:03.000\nNext\n');
});
test('range audio is sample-identical to the corresponding full mix, including bed phase and fades', () => {
  const rate = 1000;
  const spec = { rate, clips: [{ pcm: [Float32Array.from({ length: 2000 }, (_, i) => Math.sin(i) * 0.1)], startMs: 0,
    events: [{ ramp: false, t: 0, v: 0 }, { ramp: true, t: 2, v: 1 }] }],
    beds: [{ pcm: [Float32Array.from([0.02, 0.01, -0.02])], events: [], startSample: 0 }] };
  const full = mixWindow(spec, 500, 1500);
  const ranged = mixWindow(offsetMix(spec, 500)!, 0, 1000);
  assert.deepEqual(ranged, full);
});
test('export preflight preserves portrait class and bounds expensive long exports', () => {
  assert.deepEqual(sequenceExportSize(2160, 3840, 20), { width: 2160, height: 3840, reduced: false });
  assert.deepEqual(sequenceExportSize(4320, 7680, 20), { width: 2160, height: 3840, reduced: true });
  assert.deepEqual(sequenceExportSize(2160, 3840, 301, 'av01.0.08M.08'), { width: 1080, height: 1920, reduced: true });
  assert.equal(sequenceExportSize(641, 361, 10).width % 2, 0);
  assert.throws(() => sequenceExportSize(Infinity, 100, 1), RangeError);
});


test('marker serialization stays readable at the wire limit and at a split surrogate', () => {
  const wire = serialiseSequenceMarks({ markers: Array.from({ length: 256 }, (_, i) => ({
    kind: 'm' as const, ms: i, label: '界'.repeat(160) + '\ud800', color: '888888',
  })), inMs: 10, outMs: 100 });
  assert.ok(wire.length <= 65_536);
  const read = parseSequenceMarks(wire);
  assert.ok(read.markers.length > 0); assert.equal(read.inMs, 10); assert.equal(read.outMs, 100);
  assert.doesNotThrow(() => serialiseSequenceMarks({ markers: [{kind:'n',ms:0,label:'\ud800',color:'000000'}] }));
});
