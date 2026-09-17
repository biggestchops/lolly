// SPDX-License-Identifier: MPL-2.0
/**
 * withStudioExport: a studio frame that failed during an export fails the export.
 *
 * Run with:
 *   node --import ./tests/css-stub.mjs --test shells/web/src/lib/studio-export-guard.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type StudioExportHooks, withStudioExport } from './studio-export-guard.ts';

interface Container {
  name: string;
}

/** A stand-in studio module that records calls in order; `error` is what it reports after a capture. */
function fakeStudio(options: { error?: Error | null; prepareThrows?: Error } = {}) {
  const calls: string[] = [];
  let error = options.error ?? null;
  const studio: StudioExportHooks<Container> = {
    prepareToolStudio(container, quality) {
      calls.push(`prepare ${container.name} ${quality}`);
      if (options.prepareThrows) throw options.prepareThrows;
    },
    studioCaptureError(container) {
      calls.push(`check ${container.name}`);
      return error;
    },
  };
  return {
    studio,
    calls,
    fail(next: Error) {
      error = next;
    },
  };
}

const content: Container = { name: 'content' };

test('a capture error recorded while the export ran rejects after run finished, with that error', async () => {
  const { studio, calls, fail } = fakeStudio();
  const failure = new Error('frame 3 failed');
  await assert.rejects(
    withStudioExport(studio, content, async () => {
      calls.push('run');
      fail(failure);
      return 'blob';
    }),
    (error) => error === failure
  );
  assert.deepEqual(calls, ['run', 'check content']);
});

test('prepare draws the frame before the export runs, at the quality asked for', async () => {
  const { studio, calls } = fakeStudio();
  const out = await withStudioExport(
    studio,
    content,
    async () => {
      calls.push('run');
      return 42;
    },
    'export'
  );
  assert.equal(out, 42);
  assert.deepEqual(calls, ['prepare content export', 'run', 'check content']);
});

test('a prepare that throws stops the export before it runs', async () => {
  const refused = new Error('The studio renderer is unavailable.');
  const { studio, calls } = fakeStudio({ prepareThrows: refused });
  let ran = false;
  await assert.rejects(
    withStudioExport(
      studio,
      content,
      async () => {
        ran = true;
      },
      'preview'
    ),
    (error) => error === refused
  );
  assert.equal(ran, false);
  assert.deepEqual(calls, ['prepare content preview']);
});

test('without a studio module the export is a plain run', async () => {
  for (const studio of [null, undefined]) {
    let runs = 0;
    const out = await withStudioExport(studio, content, async () => {
      runs++;
      return 'plain';
    });
    assert.equal(out, 'plain');
    assert.equal(runs, 1);
  }
});

test('a clean capture returns the export output unchanged, and no prepare runs unless asked', async () => {
  const { studio, calls } = fakeStudio();
  const blob = { size: 3 };
  assert.equal(await withStudioExport(studio, content, async () => blob), blob);
  assert.deepEqual(calls, ['check content']);
});

test('an export that throws keeps its own error', async () => {
  const { studio, calls } = fakeStudio({ error: new Error('studio error') });
  const aborted = new Error('The export was cancelled.');
  await assert.rejects(
    withStudioExport(studio, content, async () => {
      throw aborted;
    }),
    (error) => error === aborted
  );
  assert.deepEqual(calls, []);
});
