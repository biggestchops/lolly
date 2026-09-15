// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { trackCollabUndo, noteRemoteForUndo, collabHistoryStamp, collabHistoryValue } from './collab-undo.ts';
const origin = { client: 'remote', clock: 5 };
test('undo changes local geometry while preserving later remote styling, including same-value writes', () => {
  const runtime = {}; const stop = trackCollabUndo(runtime), stamp = collabHistoryStamp(runtime);
  const before = [{ id: 'a', x: 0, fill: 'red' }], after = [{ id: 'a', x: 1, fill: 'blue' }];
  noteRemoteForUndo(runtime, [{ k: 'field', col: 'boxes', id: 'a', field: 'fill', value: 'blue', origin }]);
  assert.deepEqual(collabHistoryValue(runtime, 'boxes', after, after, before, stamp), [{ id: 'a', x: 0, fill: 'blue' }]);
  stop();
});
test('undo cannot resurrect a row another participant subsequently deleted', () => {
  const runtime = {}; trackCollabUndo(runtime); const stamp = collabHistoryStamp(runtime);
  noteRemoteForUndo(runtime, [{ k: 'remove', col: 'boxes', id: 'a', origin }]);
  assert.deepEqual(collabHistoryValue(runtime, 'boxes', [], [], [{ id: 'a', x: 1 }], stamp), []);
});
test('scalar undo and redo preserve remote edits; ordinary local undo is unchanged', () => {
  const runtime = {}; const stop = trackCollabUndo(runtime); const stamp = collabHistoryStamp(runtime);
  noteRemoteForUndo(runtime, [{ k: 'param', key: 'title', value: 'ours', origin }]);
  assert.equal(collabHistoryValue(runtime, 'title', 'ours', 'ours', 'before', stamp), 'ours');
  stop();
  assert.equal(collabHistoryValue(runtime, 'title', 'ours', 'ours', 'before', stamp), 'before');
});
