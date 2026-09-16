// SPDX-License-Identifier: MPL-2.0
/**
 * Async job registry (lib/jobs.ts) - the WP-F contract WP-G's video pipeline
 * drives (plans/124 section 9). DOM-free by design, so this runs headless with
 * no jsdom.
 *
 * Run directly:
 *   node --import ./tests/css-stub.mjs --test shells/web/src/lib/jobs.test.ts
 *
 * The invariants under test: the heavy serial queue (a second heavy job WAITS),
 * the queued→running→terminal transitions from progress/finish/fail/cancel, that
 * cancel fires the caller's callback, and that subscribe/unsubscribe fire on
 * change only. RETENTION_MS is pinned high so the auto-prune timer never removes
 * a job mid-assertion.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as jobs from './jobs.ts';
import { startJob, cancelJob, subscribe, jobsSnapshot, activeJobs, runJob, __resetJobsForTest } from './jobs.ts';

const flush = (): Promise<void> => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
  __resetJobsForTest();
  jobs.RETENTION.ms = 1_000_000; // freeze the list for the duration of a test
});

test('heavy jobs serialise: the second waits until the first settles', async () => {
  const a = startJob({ title: 'A' });
  const b = startJob({ title: 'B' });

  // A takes the single heavy slot; B queues behind it.
  assert.equal(jobsSnapshot().find(j => j.id === a.id)!.status, 'running');
  assert.equal(jobsSnapshot().find(j => j.id === b.id)!.status, 'queued');

  let bStarted = false;
  void b.started.then(() => { bStarted = true; });
  await flush();
  assert.equal(bStarted, false, 'B must not start while A runs');

  a.finish();
  assert.equal(jobsSnapshot().find(j => j.id === a.id)!.status, 'done');
  assert.equal(jobsSnapshot().find(j => j.id === b.id)!.status, 'running', 'B starts when A finishes');
  await flush();
  assert.equal(bStarted, true, 'B.started resolves once it is B\'s turn');
});

test('a light job runs immediately, concurrent with a heavy one', async () => {
  const heavy = startJob({ title: 'video' });
  const light = startJob({ title: 'thumb', heavy: false });
  assert.equal(jobsSnapshot().find(j => j.id === heavy.id)!.status, 'running');
  assert.equal(jobsSnapshot().find(j => j.id === light.id)!.status, 'running');
  let lightStarted = false;
  void light.started.then(() => { lightStarted = true; });
  await flush();
  assert.equal(lightStarted, true);
});

test('progress updates the record; finish marks it done', () => {
  const job = startJob({ title: 'A' });
  assert.equal(jobsSnapshot()[0]!.progress, null);
  job.progress(3, 10, 'frame 3');
  const rec = jobsSnapshot()[0]!;
  assert.deepEqual(rec.progress, { done: 3, total: 10, note: 'frame 3' });
  job.finish({ asset: 'x' });
  assert.equal(jobsSnapshot()[0]!.status, 'done');
  assert.deepEqual(jobsSnapshot()[0]!.result, { asset: 'x' });
});

test('fail marks it failed and flattens the error to a message', () => {
  const job = startJob({ title: 'A' });
  job.fail(new Error('decode blew up'));
  const rec = jobsSnapshot()[0]!;
  assert.equal(rec.status, 'failed');
  assert.equal(rec.error, 'decode blew up');
});

test('progress/finish/fail are no-ops after a terminal state', () => {
  const job = startJob({ title: 'A' });
  job.finish();
  job.progress(9, 9);          // ignored
  job.fail(new Error('late')); // ignored
  const rec = jobsSnapshot()[0]!;
  assert.equal(rec.status, 'done');
  assert.equal(rec.progress, null);
  assert.equal(rec.error, undefined);
});

test('cancel fires the callback and keeps capacity until the driver settles', () => {
  let cancelled = 0;
  const a = startJob({ title: 'A', cancel: () => { cancelled++; } });
  const b = startJob({ title: 'B' });
  cancelJob(a.id);
  assert.equal(cancelled, 1);
  assert.equal(jobsSnapshot().find(j => j.id === a.id)!.status, 'cancelled');
  assert.equal(jobsSnapshot().find(j => j.id === b.id)!.status, 'queued');
  a.settle();
  assert.equal(jobsSnapshot().find(j => j.id === b.id)!.status, 'running');
  // A second cancel is inert - the callback fires once.
  cancelJob(a.id);
  assert.equal(cancelled, 1);
});

test('cancelling a QUEUED heavy job resolves its started promise (so an awaiter unblocks)', async () => {
  const a = startJob({ title: 'A' });
  const b = startJob({ title: 'B', cancel: () => {} });
  assert.equal(jobsSnapshot().find(j => j.id === b.id)!.status, 'queued');
  let bResolved = false;
  void b.started.then(() => { bResolved = true; });
  cancelJob(b.id);
  await flush();
  assert.equal(bResolved, true);
  assert.equal(b.cancelled, true);
  // A still holds the slot; B never took it.
  assert.equal(jobsSnapshot().find(j => j.id === a.id)!.status, 'running');
});

test('cancellable flag reflects whether a cancel callback was given', () => {
  const withCb = startJob({ title: 'A', cancel: () => {} });
  const without = startJob({ title: 'B', heavy: false });
  assert.equal(jobsSnapshot().find(j => j.id === withCb.id)!.cancellable, true);
  assert.equal(jobsSnapshot().find(j => j.id === without.id)!.cancellable, false);
});

test('activeJobs returns only queued/running', () => {
  const a = startJob({ title: 'A' });
  startJob({ title: 'B' });
  a.finish();
  const active = activeJobs();
  assert.equal(active.length, 1);
  assert.equal(active[0]!.title, 'B');
});

test('subscribe fires on change; unsubscribe stops it', () => {
  let calls = 0;
  const off = subscribe(() => { calls++; });
  assert.equal(calls, 0, 'no immediate fire on subscribe');

  const job = startJob({ title: 'A' });
  const afterStart = calls;
  assert.ok(afterStart >= 1, 'startJob emits a change');

  job.progress(1, 4);
  assert.ok(calls > afterStart, 'progress emits a change');

  const afterProgress = calls;
  off();
  job.finish();
  assert.equal(calls, afterProgress, 'no more calls after unsubscribe');
});

test('runJob awaits its turn, runs the work, and finishes with the result', async () => {
  const order: string[] = [];
  const p1 = runJob({ title: 'first' }, async () => { order.push('first'); return 1; });
  const p2 = runJob({ title: 'second' }, async () => { order.push('second'); return 2; });
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r1, 1);
  assert.equal(r2, 2);
  assert.deepEqual(order, ['first', 'second'], 'the serial queue ran them in order');
});

test('runJob fails the job and rethrows when the work throws', async () => {
  await assert.rejects(
    runJob({ title: 'boom' }, async () => { throw new Error('nope'); }),
    /nope/,
  );
  const rec = jobsSnapshot().find(j => j.title === 'boom')!;
  assert.equal(rec.status, 'failed');
  assert.equal(rec.error, 'nope');
});

test('cancelled async work retains its slot through prune time and a late rejection', async () => {
  jobs.RETENTION.ms = 0;
  let reject!: (error: Error) => void;
  const work = runJob({ title: 'first', cancel: () => {} }, () => new Promise<void>((_resolve, no) => { reject = no; }));
  const rejected = assert.rejects(work, /stopped/);
  await flush();
  const first = jobsSnapshot()[0]!;
  const next = startJob({ title: 'next' });
  cancelJob(first.id);
  await flush();
  assert.equal(jobsSnapshot().find(job => job.id === next.id)!.status, 'queued');
  assert.ok(jobs.resourceJobs().some(job => job.id === first.id));
  reject(new Error('stopped'));
  await rejected;
  assert.equal(jobsSnapshot().find(job => job.id === next.id)!.status, 'running');
  next.finish();
});

test('cancellation before an async wrapper starts work releases its reservation', async () => {
  let called = false;
  const work = runJob({ title: 'first', cancel: () => {} }, () => { called = true; });
  cancelJob(jobsSnapshot()[0]!.id);
  const next = startJob({ title: 'next' });
  await work;
  assert.equal(called, false);
  assert.equal(jobsSnapshot().find(job => job.id === next.id)!.status, 'running');
});

test('runJob suppresses a result that arrives after cancellation', async () => {
  let complete!: (value: string) => void;
  const result = runJob({ title: 'slow', cancel() {} }, () => new Promise<string>(resolve => { complete = resolve; }));
  await new Promise(resolve => setImmediate(resolve));
  cancelJob(jobsSnapshot()[0]!.id);
  complete('late result');
  assert.equal(await result, undefined);
});

test('pending heavy admission is bounded; cancelling queued work admits a retry', () => {
  startJob({ title: 'active' });
  const pending = Array.from({ length: jobs.MAX_QUEUED_HEAVY_JOBS }, () => startJob({ title: 'waiting' }));
  assert.throws(() => startJob({ title: 'overflow' }), jobs.JobQueueFullError);
  assert.equal(jobsSnapshot().length, jobs.MAX_QUEUED_HEAVY_JOBS + 1);
  const light = startJob({ title: 'small', heavy: false });
  assert.equal(jobsSnapshot().find(job => job.id === light.id)!.status, 'running');
  cancelJob(pending[0]!.id);
  assert.doesNotThrow(() => startJob({ title: 'retry' }));
});
