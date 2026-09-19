// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROJECT_RATES, projectRate, frameAt, timeOfFrame, frameSeconds } from '../engine/src/timebase.ts';

for (const fps of PROJECT_RATES) test(`${fps} fps: frame steps survive the millisecond wire over an hour`, () => {
  const rate = projectRate(fps);
  for (const frame of [0, 1, 2, 3, fps - 1, fps, fps * 3599, fps * 3600]) {
    assert.equal(frameAt(frameSeconds(timeOfFrame(frame, rate), rate), rate), frame);
  }
  assert.equal(timeOfFrame(fps * 3600, rate), 3600);
  assert.equal(frameAt(timeOfFrame(1, rate), rate), 1);
});
test('invalid project rates default to 30; rational arithmetic remains exact at NTSC boundaries', () => {
  for (const value of ['', null, 'oops', 0, Infinity, 29.97]) assert.deepEqual(projectRate(value), { numerator: 30, denominator: 1 });
  const ntsc = { numerator: 30000, denominator: 1001 };
  assert.equal(timeOfFrame(30000, ntsc), 1001);
  assert.equal(frameAt(1001, ntsc), 30000);
  assert.equal(frameAt(NaN), 0);
});
