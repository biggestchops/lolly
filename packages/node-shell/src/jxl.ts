// SPDX-License-Identifier: MPL-2.0
/** Each operation has a memory budget and a worker that abort can terminate. */
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { JXL_LIMITS, validateJxlRequest, type JxlRequest, type JxlResult } from '../../../engine/src/jxl.ts';
let queue = Promise.resolve();
let pending = 0;
export function runJxl(request: JxlRequest, signal?: AbortSignal): Promise<JxlResult> {
  validateJxlRequest(request); signal?.throwIfAborted();
  if (pending >= 24) return Promise.reject(new Error('Too many JPEG XL operations are waiting.'));
  pending++;
  const task = queue.then(() => runWorker(request, signal));
  queue = task.then(() => {}, () => {}).finally(() => { pending--; });
  if (!signal) return task;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    task.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
function workerPath(): string {
  const adjacent = fileURLToPath(new URL('../wasm/jxl/vendor/worker.mjs', import.meta.url));
  if (existsSync(adjacent)) return adjacent;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = join(dir, 'packages/node-shell/wasm/jxl/vendor/worker.mjs');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir); if (parent === dir) break; dir = parent;
  }
  throw new Error('The local JPEG XL codec is not installed.');
}
function runWorker(request: JxlRequest, signal?: AbortSignal): Promise<JxlResult> {
  validateJxlRequest(request); signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath(), { workerData: request, execArgv: [] });
    let settled = false;
    const finish = (error?: Error, result?: JxlResult): void => {
      if (settled) return; settled = true;
      clearTimeout(timer); signal?.removeEventListener('abort', abort); void worker.terminate();
      if (error) reject(error); else resolve(result!);
    };
    const abort = () => finish(signal?.reason instanceof Error ? signal.reason : new Error('JPEG XL operation cancelled.'));
    const timer = setTimeout(() => finish(new Error('JPEG XL operation exceeded its two-minute budget.')), JXL_LIMITS.budgetMs);
    signal?.addEventListener('abort', abort, { once: true });
    worker.on('error', error => finish(error instanceof Error ? error : new Error(String(error))));
    worker.on('exit', code => { if (!settled) finish(new Error(`JPEG XL worker stopped (${code}).`)); });
    worker.on('message', (message: { error?: string; result?: JxlResult }) => finish(message.error ? new Error(message.error) : message.result ? undefined : new Error('No JPEG XL result was returned.'), message.result));
  });
}
