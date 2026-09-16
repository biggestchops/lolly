// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSpeechAPI } from './speech.ts';
import { createUpscaleAPI } from './upscale.ts';
import { createWasmMatteAPI } from '../lib/matte-wasm-api.ts';
import { createWasmOcrAPI } from '../lib/ocr-wasm-api.ts';

class WorkerStub extends EventTarget {
  static instances: WorkerStub[] = [];
  onmessage: ((event: { data: Record<string, unknown> }) => void) | null = null;
  onerror: (() => void) | null = null;
  messages: { id: number; type: string }[] = [];
  constructor() { super(); WorkerStub.instances.push(this); }
  terminate() {}
  postMessage(message: { id: number; type: string }) { this.messages.push(message); }
}

test('model bridges retain cancelled work until the worker confirms completion and discard late success', async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  Object.defineProperty(globalThis, 'Worker', { value: WorkerStub, configurable: true });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'Worker', original); else Reflect.deleteProperty(globalThis, 'Worker'); });
  const frame = () => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) });
  const operations = [
    (signal: AbortSignal) => createSpeechAPI().synthesize('Hello', { signal }),
    (signal: AbortSignal) => createUpscaleAPI().run(frame(), { signal }),
    (signal: AbortSignal) => createWasmMatteAPI().run(frame(), { signal }),
    (signal: AbortSignal) => createWasmOcrAPI().run(frame(), { signal }),
  ];
  for (const run of operations) {
    const controller = new AbortController();
    let settled = false;
    const operation = run(controller.signal).finally(() => { settled = true; });
    const rejected = assert.rejects(operation, { name: 'AbortError' });
    const worker = WorkerStub.instances.at(-1)!;
    const id = worker.messages[0]!.id;
    controller.abort();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false, 'abort is a request, not a completion acknowledgment');
    assert.deepEqual(worker.messages.at(-1), { id, type: 'abort' });
    worker.onmessage!({ data: { id, result: {}, frame: frame() } });
    await rejected;
    assert.equal(settled, true);
  }
});
