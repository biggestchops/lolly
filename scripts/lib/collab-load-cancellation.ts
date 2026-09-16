// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import type { APIRequestContext } from 'playwright-core';

/** Cancel occupied Chromium slots through the durable API, then observe release. */
export async function measureRenderCancellation(request: APIRequestContext, base: string, worker: string, boxes: unknown[], active: () => number) {
  const pause = () => new Promise(resolve => setTimeout(resolve, 20));
  const readiness = async () => {
    const response = await fetch(`${worker}/readyz`);
    assert.ok([200, 503].includes(response.status));
    return await response.json() as { active: number; capacity: number };
  };
  const waitFor = async (expected: number) => {
    const deadline = performance.now() + 20_000;
    let last = -1;
    while (performance.now() < deadline) {
      const state = await readiness();
      assert.equal(state.capacity, 2);
      if (state.active !== last) console.log('Cancellation worker slots', { expected, active: state.active, runner: active() });
      last = state.active;
      if (state.active === expected) return performance.now();
      await pause();
    }
    throw new Error(`worker did not reach ${expected} occupied slots; last=${last}, runner=${active()}`);
  };
  const trials = [];
  for (let trial = 0; trial < 3; trial++) {
    console.log('Cancellation trial', trial + 1);
    await waitFor(0);
    const ids: string[] = [];
    for (let slot = 0; slot < 2; slot++) {
      const response = await request.post(`${base}/api/v1/renders`, { data: {
        toolId: 'design', format: 'svg', inputs: { boxes, background: `#f${trial}${slot}fff` }, maxAttempts: 1,
      } });
      assert.equal(response.status(), 202, await response.text());
      ids.push((await response.json()).id);
    }
    await waitFor(2);
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal((await readiness()).active, 2, 'both slots remain occupied before cancellation');
    const at = Date.now(), started = performance.now();
    const released = waitFor(0).then(end => end - started);
    const runnerReleased = (async () => {
      const deadline = performance.now() + 20_000;
      while (active() > 0 && performance.now() < deadline) await pause();
      assert.equal(active(), 0, 'control runner releases its active jobs');
      return performance.now() - started;
    })();
    // Observe immediately, including releases that precede the HTTP acknowledgements.
    void released.catch(() => {});
    void runnerReleased.catch(() => {});
    const acknowledgementsMs = await Promise.all(ids.map(async id => {
      const response = await request.delete(`${base}/api/v1/renders/${id}`);
      assert.equal(response.status(), 200, await response.text());
      assert.equal((await response.json()).state, 'cancelled');
      console.log('Cancellation acknowledged', { id, elapsedMs: performance.now() - started });
      return performance.now() - started;
    }));
    const workerReleasedMs = await released;
    const runnerReleasedMs = await runnerReleased;
    for (const id of ids) {
      const record = await request.get(`${base}/api/v1/renders/${id}`);
      assert.equal(record.status(), 200);
      assert.equal((await record.json()).state, 'cancelled');
      const output = await request.get(`${base}/api/v1/renders/${id}/output/default`);
      assert.equal(output.status(), 409, 'cancelled jobs must not publish a successful output');
    }
    trials.push({ at, ids, acknowledgementsMs, workerReleasedMs, runnerReleasedMs });
  }
  return { trials, occupiedDwellMs: 250, pollingIntervalMs: 20, measurement: 'Cancel request to observed zero worker permits; permits remain held until Chromium context.close resolves. Runner release is observed separately. This does not measure RSS reclamation.' };
}
