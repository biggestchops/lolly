// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { median, summarizeUiTimings } from '../scripts/lib/ui-performance.ts';

test('lab summary groups events by interaction and only counts blocking time beyond 50 ms', () => {
  const result = summarizeUiTimings({
    longTasks: [{ startTime: 0, duration: 50 }, { startTime: 70, duration: 120 }],
    events: [
      { startTime: 0, duration: 80, interactionId: 7 },
      { startTime: 10, duration: 96, interactionId: 7 },
      { startTime: 20, duration: 40, interactionId: 14 },
      { startTime: 30, duration: 200, interactionId: 0 },
    ],
  });
  assert.deepEqual(result, { longTaskCount: 2, longTaskMs: 170, longTaskBlockingMs: 70, maxLongTaskMs: 120, observedInteractions: 2, interactionMs: 96 });
  assert.equal(summarizeUiTimings({ longTasks: [], events: [] }).interactionMs, null);
});

test('repeated-run medians include a slow run without letting it dominate the result', () => {
  assert.equal(median([90, 900, 100]), 100);
  assert.equal(median([100, 80, 900, 110]), 105);
  assert.throws(() => median([]));
});
