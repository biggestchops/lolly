// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecordingStorage, RECORDING_MAX_BYTES } from './recorder-storage.ts';

function fixture() {
  const files = new Map<string, Uint8Array>(), locks = new Set<string>();
  let failWrite = false, failClose = false, failRead = false, failOpen = false;
  const root = {
    async *keys() { yield* files.keys(); },
    async removeEntry(name: string) { files.delete(name); },
    async getFileHandle(name: string) {
      files.set(name, new Uint8Array());
      let content = new Uint8Array();
      return {
        async createWritable() {
          if (failOpen) throw new Error('QuotaExceededError');
          return {
            async write(chunk: { position: number; data: Uint8Array }) {
              if (failWrite) throw new Error('QuotaExceededError');
              const next = new Uint8Array(Math.max(content.length, chunk.position + chunk.data.length));
              next.set(content); next.set(chunk.data, chunk.position); content = next;
            },
            async close() { if (failClose) throw new Error('Commit failed'); files.set(name, content); },
            async abort() {},
          };
        },
        async getFile() { if (failRead) throw new Error('Read failed'); return new Blob([content]); },
      };
    },
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    storage: { getDirectory: async () => root },
    locks: { async request(name: string, options: unknown, callback?: (lock: unknown) => Promise<void>) {
      const cb = typeof options === 'function' ? options as (lock: unknown) => Promise<void> : callback!;
      if (locks.has(name)) return cb(null);
      locks.add(name); try { await cb({ name }); } finally { locks.delete(name); }
    } },
  } });
  return { files, locks, fail: (at: string) => { failWrite = at === 'write'; failClose = at === 'close'; failRead = at === 'read'; failOpen = at === 'open'; },
    restore: () => { if (previous) Object.defineProperty(globalThis, 'navigator', previous); } };
}

test('recording storage supports backpatches and removes its file after Blob readback', async () => {
  const f = fixture();
  try {
    const storage = (await createRecordingStorage())!, writer = storage.writable.getWriter();
    await writer.write({ type: 'write', position: 0, data: new Uint8Array([0, 2, 3]) });
    await writer.write({ type: 'write', position: 0, data: new Uint8Array([1]) });
    await writer.close(); const result = await storage.result();
    assert.deepEqual([...new Uint8Array(await result.arrayBuffer())], [1, 2, 3]);
    assert.equal(f.files.size, 0); await Promise.resolve(); assert.equal(f.locks.size, 0);
    await storage.discard();
  } finally { f.restore(); }
});

test('storage rejects disk, commit and readback failures and cleans every temporary file', async () => {
  for (const at of ['open', 'write', 'close', 'read']) {
    const f = fixture(); f.fail(at);
    try {
      if (at === 'open') await assert.rejects(createRecordingStorage());
      else {
        const storage = (await createRecordingStorage())!, writer = storage.writable.getWriter();
        if (at === 'write') await assert.rejects(writer.write({ type: 'write', position: 0, data: new Uint8Array([1]) }));
        else if (at === 'close') await assert.rejects(writer.close());
        else { await writer.close(); await assert.rejects(storage.result()); }
        if (at !== 'read') assert.ok(await storage.failure);
        await storage.discard();
      }
      assert.equal(f.files.size, 0); await Promise.resolve(); assert.equal(f.locks.size, 0);
    } finally { f.restore(); }
  }
});

test('recordings have a size ceiling before a write reaches storage', async () => {
  const f = fixture();
  try {
    const storage = (await createRecordingStorage())!, writer = storage.writable.getWriter();
    await assert.rejects(writer.write({ type: 'write', position: RECORDING_MAX_BYTES, data: new Uint8Array([1]) }), /size limit/);
    await storage.discard(); assert.equal(f.files.size, 0);
  } finally { f.restore(); }
});

test('orphan cleanup never deletes an active recording, export file or unrelated file', async () => {
  const f = fixture();
  try {
    for (const name of ['lolly-recording-1-00000000-0000-0000-0000-000000000001', 'lolly-recording-1-00000000-0000-0000-0000-000000000002', 'lolly-mux-1-export', 'user-file']) f.files.set(name, new Uint8Array([1]));
    f.locks.add('lolly-recording-1-00000000-0000-0000-0000-000000000002');
    const storage = (await createRecordingStorage())!;
    assert.equal(f.files.has('lolly-recording-1-00000000-0000-0000-0000-000000000001'), false);
    for (const name of ['lolly-recording-1-00000000-0000-0000-0000-000000000002', 'lolly-mux-1-export', 'user-file']) assert.ok(f.files.has(name));
    await storage.discard(); assert.equal(f.files.size, 3);
  } finally { f.restore(); }
});
