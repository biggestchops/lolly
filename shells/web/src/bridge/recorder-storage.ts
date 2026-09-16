// SPDX-License-Identifier: MPL-2.0
import type { StreamTargetChunk } from 'mediabunny';
import type { SeekableSink } from './mediabunny-mux.ts';

export const RECORDING_MAX_BYTES = 512 * 1024 * 1024;
const PREFIX = 'lolly-recording-';
const STALE_MS = 24 * 60 * 60_000;

export interface RecordingStorage extends SeekableSink {
  readonly failure: Promise<unknown>;
  discard(): Promise<void>;
}

/** Hold a cross-tab lease until removal. A crashed tab releases its Web Lock automatically. */
async function lease(name: string): Promise<() => void> {
  if (!navigator.locks) return () => {};
  let unlock!: () => void, acquired!: () => void;
  const held = new Promise<void>(resolve => { unlock = resolve; });
  const ready = new Promise<void>(resolve => { acquired = resolve; });
  const request = navigator.locks.request(name, async () => { acquired(); await held; });
  await Promise.race([ready, request]);
  return unlock;
}

/** Reap only old recording files whose owner is gone. No age-only deletion of an active take. */
async function sweep(root: FileSystemDirectoryHandle): Promise<void> {
  if (!navigator.locks) return;
  const directory = root as FileSystemDirectoryHandle & { keys?: () => AsyncIterableIterator<string> };
  if (!directory.keys) return;
  for await (const name of directory.keys()) {
    // Ignore browser-owned swap entries and anything outside our exact naming scheme.
    const match = /^lolly-recording-(\d+)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.exec(name);
    if (!match) continue;
    const stamp = Number(match[1]);
    if (!Number.isFinite(stamp) || Date.now() - stamp < STALE_MS) continue;
    await navigator.locks.request(name, { ifAvailable: true }, async lock => {
      if (lock) await root.removeEntry(name).catch(() => {});
    });
  }
}

/** Stream capture to local storage; retain the existing Blob/provenance seam only at finalization. */
export async function createRecordingStorage(): Promise<RecordingStorage | null> {
  if (!navigator.storage?.getDirectory) return null;
  const root = await navigator.storage.getDirectory();
  await sweep(root).catch(() => {});
  const name = `${PREFIX}${Date.now()}-${crypto.randomUUID()}`;
  const unlock = await lease(name);
  let file: FileSystemFileHandle, writer: FileSystemWritableFileStream;
  try {
    file = await root.getFileHandle(name, { create: true });
    writer = await file.createWritable();
  } catch (error) { await root.removeEntry(name).catch(() => {}); unlock(); throw error; }
  let discarded: Promise<void> | null = null, closed = false;
  let report!: (error: unknown) => void;
  const failure = new Promise<unknown>(resolve => { report = resolve; });
  const discard = () => discarded ??= (async () => {
    try {
      if (!closed) await writer.abort().catch(() => {});
      await root.removeEntry(name).catch(() => {});
    } finally { unlock(); }
  })();
  const writable = new WritableStream<StreamTargetChunk>({
    async write(chunk) {
      try {
        if (discarded) throw new Error('Recording cancelled');
        if (!Number.isSafeInteger(chunk.position) || chunk.position < 0
          || chunk.position + chunk.data.byteLength > RECORDING_MAX_BYTES) throw new Error('Recording size limit reached');
        await writer.write({ type: 'write', position: chunk.position, data: chunk.data });
      } catch (error) { report(error); throw error; }
    },
    async close() {
      try { if (!discarded) { await writer.close(); closed = true; } }
      catch (error) { report(error); throw error; }
    },
    abort: discard,
  });
  return {
    writable, failure, discard,
    async result() {
      try {
        if (discarded) throw new Error('Recording cancelled');
        const blob = await file.getFile();
        // The current provenance path reads the complete file. Copy before unlinking:
        // an OPFS File snapshot is no longer readable once its backing entry is removed.
        return new Blob([await blob.arrayBuffer()]);
      } finally { await discard(); }
    },
  };
}
