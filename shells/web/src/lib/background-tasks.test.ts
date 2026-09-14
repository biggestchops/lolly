// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { runBackgroundTasks } from './background-tasks.ts';
import { setFlagMirror } from '../feature-flags.ts';

const drain = () => new Promise<void>(resolve => setImmediate(resolve));

test('performance mode runs two downloads at a time and finishes after a failed asset', async () => {
  const dom = new JSDOM('', { url: 'https://lolly.tools' });
  globalThis.localStorage = dom.window.localStorage;
  setFlagMirror('perf-ui', true);
  const started: number[] = [];
  const finish = new Map<number, () => void>();
  let active = 0, maximum = 0;
  const done = runBackgroundTasks([0, 1, 2, 3, 4], async id => {
    started.push(id); maximum = Math.max(maximum, ++active);
    await new Promise<void>(resolve => finish.set(id, resolve));
    active--;
    if (id === 1) throw new Error('offline asset');
  });
  await drain();
  assert.deepEqual(started, [0, 1]);
  finish.get(1)!(); await drain();
  assert.deepEqual(started, [0, 1, 2]);
  finish.get(0)!(); finish.get(2)!(); await drain();
  assert.deepEqual(started, [0, 1, 2, 3, 4]);
  finish.get(3)!(); finish.get(4)!(); await done;
  assert.equal(maximum, 2);
  localStorage.clear(); dom.window.close();
});

test('a lower live limit lets existing work finish before starting more', async () => {
  let limit = 4;
  const started: number[] = [];
  const finish = new Map<number, () => void>();
  const done = runBackgroundTasks([0, 1, 2, 3, 4, 5], id => {
    started.push(id);
    return new Promise<void>(resolve => finish.set(id, resolve));
  }, () => limit);
  await drain(); limit = 2;
  finish.get(0)!(); finish.get(1)!(); await drain();
  assert.deepEqual(started, [0, 1, 2, 3]);
  finish.get(2)!(); await drain();
  assert.deepEqual(started, [0, 1, 2, 3, 4]);
  finish.get(3)!(); await drain();
  finish.get(4)!(); finish.get(5)!(); await done;
});
