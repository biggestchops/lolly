// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecordingSession, type RecordEngine } from './recorder-session.ts';

function fixture(produce: () => Promise<Blob> = async () => new Blob(['take'])) {
  let produced = 0, aborted = 0, released = 0, sourceEnded = () => {}, error!: (reason: unknown) => void;
  const engine: RecordEngine = { type: 'video/webm', failure: new Promise(resolve => { error = resolve; }),
    produceBlob: () => { produced++; return produce(); }, abort: () => { aborted++; } };
  const owner = { micActive: true, release: () => { released++; }, subscribe: () => () => {},
    onSourceEnded: (finish: () => void) => { sourceEnded = finish; } };
  return { engine, owner, error: () => error(new Error('encoder failed')), end: () => sourceEnded(),
    counts: () => ({ produced, aborted, released }) };
}

test('source ending and repeated Stop finalize once and share automatic completion', async () => {
  const f = fixture(), session = createRecordingSession(f.engine, f.owner);
  f.end(); f.end();
  assert.equal(session.stop(), session.finished);
  assert.equal(await (await session.stop()).text(), 'take');
  session.cancel(); f.error(); await Promise.resolve();
  assert.deepEqual(f.counts(), { produced: 1, aborted: 0, released: 1 });
});

test('duration limit notifies consumers and releases without a manual Stop', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(), session = createRecordingSession(f.engine, f.owner, 1000);
  t.mock.timers.tick(1000);
  assert.equal((await session.finished).size, 4);
  assert.deepEqual(f.counts(), { produced: 1, aborted: 0, released: 1 });
});

test('cancel while finalizing discards the late Blob and releases exactly once', async () => {
  let resolve!: (blob: Blob) => void;
  const f = fixture(() => new Promise(done => { resolve = done; }));
  const session = createRecordingSession(f.engine, f.owner), stopped = session.stop();
  session.cancel(); session.cancel();
  resolve(new Blob(['must not save']));
  assert.equal((await stopped).size, 0);
  await Promise.resolve();
  assert.deepEqual(f.counts(), { produced: 1, aborted: 1, released: 1 });
});

test('encoder failure and rejected finalization both release and settle empty', async () => {
  for (const liveError of [true, false]) {
    const f = fixture(async () => { throw new Error('finalize failed'); });
    const session = createRecordingSession(f.engine, f.owner);
    if (liveError) f.error(); else void session.stop();
    assert.equal((await session.finished).size, 0);
    assert.deepEqual(f.counts(), { produced: liveError ? 0 : 1, aborted: 1, released: 1 });
  }
});

test('a stalled finalizer times out and ignores its late result', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let resolve!: (blob: Blob) => void;
  const f = fixture(() => new Promise(done => { resolve = done; }));
  const session = createRecordingSession(f.engine, f.owner, undefined, 100);
  void session.stop(); t.mock.timers.tick(100);
  assert.equal((await session.finished).size, 0);
  resolve(new Blob(['late'])); await Promise.resolve();
  assert.deepEqual(f.counts(), { produced: 1, aborted: 1, released: 1 });
});
