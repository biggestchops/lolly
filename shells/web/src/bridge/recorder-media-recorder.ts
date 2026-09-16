// SPDX-License-Identifier: MPL-2.0
import type { RecordEngine } from './recorder-session.ts';
import { RECORDING_MAX_BYTES, type RecordingStorage } from './recorder-storage.ts';

/** MediaRecorder fallback with bounded pending writes and the same temporary sink as WebCodecs. */
export function createMediaRecorderEngine(stream: MediaStream, options: MediaRecorderOptions,
  fallbackType: string, storage: RecordingStorage | null = null, limited = false): RecordEngine {
  let recorder: MediaRecorder;
  try { recorder = new MediaRecorder(stream, options); }
  catch { const { mimeType: _mime, ...hints } = options; recorder = new MediaRecorder(stream, hints); }
  const type = (recorder.mimeType || options.mimeType || fallbackType).split(';')[0]!;
  const chunks: Blob[] = [], writer = storage?.writable.getWriter();
  let stopped = false, aborted = false, failed = false, bytes = 0, queuedBytes = 0;
  let writes = Promise.resolve();
  let resolve!: (blob: Blob) => void, report!: (error: unknown) => void, didEnd!: () => void;
  const finished = new Promise<Blob>(done => { resolve = done; });
  const failure = new Promise<unknown>(done => { report = done; });
  const ended = new Promise<void>(done => { didEnd = done; });
  const fail = (error: unknown) => { failed = true; report(error); };
  recorder.ondataavailable = event => {
    if (aborted || failed || !event.data.size) return;
    const position = bytes; bytes += event.data.size;
    if (limited && bytes > RECORDING_MAX_BYTES) { fail(new Error('Recording size limit reached')); return; }
    if (!writer) { chunks.push(event.data); return; }
    queuedBytes += event.data.size;
    if (queuedBytes > 8 * 1024 * 1024) { fail(new Error('Recording storage is too slow')); return; }
    writes = writes.then(async () => {
      if (!aborted && !failed) await writer.write({ type: 'write', position, data: new Uint8Array(await event.data.arrayBuffer()) });
    }).catch(fail).finally(() => { queuedBytes -= event.data.size; });
  };
  recorder.onerror = event => fail(event);
  recorder.onstop = () => {
    stopped = true; didEnd();
    void writes.then(async () => {
      if (aborted || failed) { resolve(new Blob([])); return; }
      if (writer) await writer.close();
      const blob = storage ? await storage.result() : new Blob(chunks);
      chunks.length = 0;
      resolve(aborted ? new Blob([]) : blob.slice(0, blob.size, type));
    }).catch(error => { fail(error); resolve(new Blob([])); });
  };
  // Regular delivery makes the byte/queue limit effective during a take, not only at Stop.
  try { recorder.start(1000); }
  catch (error) { void storage?.discard(); throw error; }
  return {
    type, failure: storage ? Promise.race([failure, storage.failure]) : failure, ended,
    produceBlob() {
      if (!stopped && recorder.state !== 'inactive') {
        try { recorder.stop(); } catch (error) { fail(error); }
      }
      return finished;
    },
    abort() {
      aborted = true; chunks.length = 0;
      try { if (recorder.state !== 'inactive') recorder.stop(); } catch { /* already stopped */ }
      void storage?.discard(); resolve(new Blob([]));
    },
  };
}
