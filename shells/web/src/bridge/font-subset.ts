// SPDX-License-Identifier: MPL-2.0
import { MAX_FONT_BYTES, SKERA_POLICY } from '@lolly-tools/node-shell/font-subset-wasm';

export type SubsetExecutor = (font: Uint8Array, glyphs: number[], signal: AbortSignal) => Promise<Uint8Array>;
type Request = { font: Uint8Array; glyphs: number[]; signal: AbortSignal; resolve(bytes: Uint8Array): void; reject(error: unknown): void; cleanup(): void };

/** One worker, eight admitted requests, 64 MiB pending fonts, 4 MiB cached output. */
export function createFontSubsetter(execute: SubsetExecutor) {
  const queue: Request[] = [];
  const cache = new Map<string, Uint8Array>();
  let active = false, pending = 0, pendingBytes = 0, cacheBytes = 0;
  const stats = () => ({ active, pending, pendingBytes, cacheBytes, cacheEntries: cache.size });
  async function pump(): Promise<void> {
    if (active) return;
    const request = queue.shift();
    if (!request) return;
    active = true;
    try {
      request.signal.throwIfAborted();
      const digest = await crypto.subtle.digest('SHA-256', request.font as Uint8Array<ArrayBuffer>);
      const key = SKERA_POLICY + ':' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') + ':' + request.glyphs.join(',');
      request.signal.throwIfAborted();
      let bytes = cache.get(key);
      if (bytes) { cache.delete(key); cache.set(key, bytes); }
      else {
        bytes = await execute(request.font, request.glyphs, request.signal);
        request.signal.throwIfAborted();
        const cost = bytes.byteLength + key.length * 2;
        if (cost <= 4 * 1024 * 1024) {
          while (cache.size && (cache.size >= 16 || cacheBytes + cost > 4 * 1024 * 1024)) {
            const oldest = cache.keys().next().value!;
            cacheBytes -= cache.get(oldest)!.byteLength + oldest.length * 2; cache.delete(oldest);
          }
          cache.set(key, bytes.slice()); cacheBytes += cost;
        }
      }
      request.resolve(bytes.slice());
    } catch (error) { request.reject(error); }
    finally { request.cleanup(); active = false; void pump(); }
  }
  return {
    stats,
    subset(font: Uint8Array, glyphs: readonly number[], signal?: AbortSignal): Promise<Uint8Array> {
      if (signal?.aborted) return Promise.reject(signal.reason);
      if (!font.length || font.length > MAX_FONT_BYTES || glyphs.length > 65536 || glyphs.some(id => !Number.isInteger(id) || id < 0 || id > 65535)) return Promise.reject(new RangeError('Unsupported font subset input'));
      if (pending >= 8 || pendingBytes + font.byteLength > 64 * 1024 * 1024) return Promise.reject(new Error('Font subset queue is full. Try again after an export finishes.'));
      const admittedBytes = font.byteLength;
      pending++; pendingBytes += admittedBytes;
      return new Promise((resolve, reject) => {
        const controller = new AbortController();
        const request: Request = {
          font: font.slice(), glyphs: [...new Set([0, ...glyphs])].sort((a, b) => a - b), signal: controller.signal, resolve, reject,
          cleanup() { signal?.removeEventListener('abort', abort); pending--; pendingBytes -= admittedBytes; },
        };
        function abort() {
          controller.abort(signal?.reason);
          const index = queue.indexOf(request);
          if (index >= 0) { queue.splice(index, 1); request.cleanup(); reject(controller.signal.reason); }
        }
        signal?.addEventListener('abort', abort, { once: true });
        queue.push(request); void pump();
      });
    },
  };
}

const subsetter = createFontSubsetter((font, glyphs, signal) => new Promise((resolve, reject) => {
  const worker = new Worker(new URL('./font-subset-worker.ts', import.meta.url), { type: 'module' });
  let settled = false;
  const finish = (error?: unknown, bytes?: Uint8Array) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer); signal.removeEventListener('abort', abort); worker.terminate();
    if (error) reject(error); else resolve(bytes!);
  };
  const abort = () => finish(signal.reason ?? new DOMException('Cancelled', 'AbortError'));
  const timer = setTimeout(() => finish(new Error('Font subsetting exceeded its time limit')), 10_000);
  signal.addEventListener('abort', abort, { once: true });
  worker.onmessage = event => event.data.error ? finish(new Error(event.data.error)) : finish(undefined, event.data.bytes);
  worker.onerror = event => finish(new Error(event.message || 'Font subset worker failed'));
  if (signal.aborted) abort();
  else worker.postMessage({ font, glyphs }, [font.buffer]);
}));

export const subsetFont = subsetter.subset;
