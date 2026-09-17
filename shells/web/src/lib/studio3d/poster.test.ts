// SPDX-License-Identifier: MPL-2.0
/**
 * The studio poster queue: the debounce per box, the one chain the whole page renders on,
 * the cache of finished pictures and what it evicts (plan 265 milestone 3, lane B).
 *
 * Run directly:  node --test shells/web/src/lib/studio3d/poster.test.ts
 *
 * The renderer is injected, so nothing here opens a WebGL context or loads three; only
 * `createStudioPosterQueue` is imported, and it reaches the pool with an await import()
 * inside the render it never runs here. URL.createObjectURL and revokeObjectURL are
 * stubbed and counted, the way lib/multi-edit-single.test.ts stubs them.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createStudioPosterQueue, type StudioPosterRequest } from './poster.ts';

let urlSeq = 0;
const created: string[] = [];
const revoked: string[] = [];
const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;
URL.createObjectURL = () => {
  const url = `blob:poster/${urlSeq++}`;
  created.push(url);
  return url;
};
URL.revokeObjectURL = (url: string) => {
  revoked.push(url);
};
process.on('exit', () => {
  URL.createObjectURL = realCreate;
  URL.revokeObjectURL = realRevoke;
});

const tick = (ms: number) => new Promise((done) => setTimeout(done, ms));
const ask = (key: string, extra: Partial<StudioPosterRequest> = {}): StudioPosterRequest => ({
  key,
  recipeKey: extra.recipeKey ?? `recipe:${key}`,
  values: { source: 'primitive', primitive: 'badge' },
  width: 320,
  height: 240,
  time: 0,
  quality: 'export',
  ...extra,
});

test('a burst of schedules for one box costs one render', async () => {
  let renders = 0;
  const queue = createStudioPosterQueue({
    debounceMs: 10,
    render: async () => {
      renders++;
      return new Blob(['a']);
    },
  });
  const seen: string[] = [];
  queue.schedule(ask('a'), (poster) => seen.push(poster.url));
  queue.schedule(ask('a'), (poster) => seen.push(poster.url));
  queue.schedule(ask('a'), (poster) => seen.push(poster.url));
  await tick(60);
  assert.equal(renders, 1, 'three rapid schedules collapse to one render');
  assert.equal(seen.length, 1, 'only the surviving schedule is answered');
  queue.dispose();
});

test('renders never overlap: the chain serialises them', async () => {
  let active = 0;
  let mostActive = 0;
  const queue = createStudioPosterQueue({
    debounceMs: 0,
    render: async () => {
      active++;
      mostActive = Math.max(mostActive, active);
      await tick(15);
      active--;
      return new Blob(['a']);
    },
  });
  queue.schedule(ask('a'), () => {});
  queue.schedule(ask('b'), () => {});
  queue.schedule(ask('c'), () => {});
  await tick(120);
  assert.equal(mostActive, 1, 'at most one poster is drawn at a time');
  assert.equal(queue.stats().renders, 3);
  queue.dispose();
});

test('a second box holding the same scene at the same size draws nothing', async () => {
  const queue = createStudioPosterQueue({
    debounceMs: 0,
    render: async () => new Blob(['a']),
  });
  const first = await queue.request(ask('a', { recipeKey: 'shared' }));
  const answered: string[] = [];
  queue.schedule(ask('b', { recipeKey: 'shared' }), (poster) => answered.push(poster.url));
  await tick(20);
  assert.equal(queue.stats().renders, 1, 'the cache answers the second box');
  assert.deepEqual(answered, [first.url], 'and answers it with the same picture');
  // A cache hit is answered without waiting for the debounce at all.
  let immediate: string | null = null;
  queue.schedule(ask('c', { recipeKey: 'shared' }), (poster) => (immediate = poster.url));
  assert.equal(immediate, first.url);
  queue.dispose();
});

test('a different size, time or quality is a different picture', async () => {
  const queue = createStudioPosterQueue({ debounceMs: 0, render: async () => new Blob(['a']) });
  await queue.request(ask('a'));
  await queue.request(ask('a', { width: 640 }));
  await queue.request(ask('a', { time: 0.5 }));
  await queue.request(ask('a', { quality: 'clip' }));
  await queue.request(ask('a'));
  assert.equal(queue.stats().renders, 4, 'four distinct requests, the fifth a cache hit');
  queue.dispose();
});

test('the cache is bounded and revokes what it drops', async () => {
  const queue = createStudioPosterQueue({
    debounceMs: 0,
    capacity: 2,
    render: async () => new Blob(['a']),
  });
  const before = revoked.length;
  const one = await queue.request(ask('a', { recipeKey: 'one' }));
  await queue.request(ask('b', { recipeKey: 'two' }));
  await queue.request(ask('c', { recipeKey: 'three' }));
  assert.deepEqual(revoked.slice(before), [one.url], 'the oldest picture is the one dropped');
  assert.equal(queue.stats().held, 2);
  // Reading a picture bumps it, so the one being looked at is not the next to go.
  const two = queue.cached(ask('b', { recipeKey: 'two' }));
  assert.ok(two, 'the second picture is still held');
  await queue.request(ask('d', { recipeKey: 'four' }));
  assert.ok(queue.cached(ask('b', { recipeKey: 'two' })), 'the bumped picture survived');
  assert.equal(queue.cached(ask('c', { recipeKey: 'three' })), null, 'the unread one went');
  queue.dispose();
});

test('a failed render reports and the line behind it keeps moving', async () => {
  let calls = 0;
  const queue = createStudioPosterQueue({
    debounceMs: 0,
    render: async () => {
      calls++;
      if (calls === 1) throw new Error('This scene has no source.');
      return new Blob(['a']);
    },
  });
  let failure: Error | null = null;
  let after: string | null = null;
  queue.schedule(ask('a'), () => {}, (error) => (failure = error));
  queue.schedule(ask('b'), (poster) => (after = poster.url));
  await tick(40);
  assert.equal((failure as Error | null)?.message, 'This scene has no source.');
  assert.ok(after, 'the next box was still drawn');
  queue.dispose();
});

test('cancel drops queued work for one box and leaves the others', async () => {
  const drawn: string[] = [];
  const queue = createStudioPosterQueue({
    debounceMs: 10,
    render: async (request) => {
      drawn.push(request.key);
      return new Blob(['a']);
    },
  });
  queue.schedule(ask('a'), () => {});
  queue.schedule(ask('b'), () => {});
  queue.cancel('a');
  await tick(60);
  assert.deepEqual(drawn, ['b']);
  queue.dispose();
});

test('dispose revokes every held picture and refuses more work', async () => {
  const queue = createStudioPosterQueue({ debounceMs: 0, render: async () => new Blob(['a']) });
  const poster = await queue.request(ask('a'));
  const before = revoked.length;
  queue.dispose();
  assert.deepEqual(revoked.slice(before), [poster.url]);
  let answered = false;
  queue.schedule(ask('b'), () => (answered = true));
  await tick(20);
  assert.equal(answered, false);
  assert.equal(queue.stats().held, 0);
});
