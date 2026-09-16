// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { stepCursorSwing, CURSOR_SWING_LIMIT } from './collab-cursor-motion.ts';

test('a fast move leans against travel, stays bounded and settles with a small rebound', () => {
  let state = { angle: 0, velocity: 0 };
  for (let i = 0; i < 30; i++) {
    state = stepCursorSwing(state, 50, 0, 1000 / 60);
    assert.ok(Math.abs(state.angle) <= CURSOR_SWING_LIMIT);
  }
  assert.ok(state.angle < -5);
  let rebound = false;
  for (let i = 0; i < 120; i++) {
    state = stepCursorSwing(state, 0, 0, 1000 / 60);
    if (state.angle > 0) rebound = true;
  }
  assert.equal(rebound, true);
  assert.deepEqual(state, { angle: 0, velocity: 0 });
});

test('the spring gives the same response at different display refresh rates', () => {
  const run = (fps: number) => {
    let state = { angle: 0, velocity: 0 };
    for (let i = 0; i < fps; i++) state = stepCursorSwing(state, 100 / fps, 30 / fps, 1000 / fps);
    return state;
  };
  assert.ok(Math.abs(run(60).angle - run(120).angle) < 0.001);
});

test('suspension and malformed input discard stored motion', () => {
  const state = { angle: 10, velocity: 20 };
  for (const ms of [151, 10_000, Number.NaN]) assert.deepEqual(stepCursorSwing(state, 100, 20, ms), { angle: 0, velocity: 0 });
  assert.deepEqual(stepCursorSwing(state, Infinity, 0, 16), { angle: 0, velocity: 0 });
});
