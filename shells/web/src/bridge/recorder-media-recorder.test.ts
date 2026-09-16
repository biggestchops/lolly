// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaRecorderEngine } from './recorder-media-recorder.ts';
import { createRecordingSession } from './recorder-session.ts';
import type { RecordingStorage } from './recorder-storage.ts';

function fixture() {
  let recorder!: Recorder;
  class Recorder {
    state = 'inactive'; mimeType = 'video/webm;codecs=vp8'; timeslice = 0;
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: ((error: Error) => void) | null = null;
    constructor() { recorder = this; }
    start(timeslice: number) { this.state = 'recording'; this.timeslice = timeslice; }
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(['last']) }); this.onstop?.(); });
    }
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'MediaRecorder');
  Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: Recorder });
  return { recorder: () => recorder, restore: () => {
    if (previous) Object.defineProperty(globalThis, 'MediaRecorder', previous);
    else Reflect.deleteProperty(globalThis, 'MediaRecorder');
  } };
}

test('MediaRecorder keeps its last data event and normalizes the final container MIME', async () => {
  const f = fixture();
  try {
    const engine = createMediaRecorderEngine({} as MediaStream, {}, 'video/webm');
    f.recorder().ondataavailable?.({ data: new Blob(['first']) });
    const blob = await engine.produceBlob();
    assert.equal(await blob.text(), 'firstlast'); assert.equal(blob.type, 'video/webm');
    assert.equal(f.recorder().timeslice, 1000);
  } finally { f.restore(); }
});

test('MediaRecorder byte ceiling fails during capture and ignores data delivered after cancellation', async () => {
  const f = fixture();
  try {
    const engine = createMediaRecorderEngine({} as MediaStream, {}, 'video/webm', null, true);
    let released = 0;
    const session = createRecordingSession(engine, { micActive: false, release: () => { released++; }, subscribe: () => () => {} });
    const data = new Blob([new Uint8Array(8 * 1024 * 1024)]);
    for (let i = 0; i < 65; i++) f.recorder().ondataavailable?.({ data });
    assert.equal((await session.finished).size, 0); assert.equal(released, 1);
    assert.equal(f.recorder().state, 'inactive');
    assert.equal((await session.stop()).size, 0);
  } finally { f.restore(); }
});

test('a stalled writable cannot accumulate unlimited MediaRecorder events', async () => {
  const f = fixture();
  try {
    let discarded = 0;
    const storage: RecordingStorage = {
      writable: new WritableStream({ write: () => new Promise(() => {}) }),
      failure: new Promise(() => {}), result: async () => new Blob([]),
      discard: async () => { discarded++; },
    };
    const engine = createMediaRecorderEngine({} as MediaStream, {}, 'video/webm', storage, true);
    const data = new Blob([new Uint8Array(5 * 1024 * 1024)]);
    f.recorder().ondataavailable?.({ data }); f.recorder().ondataavailable?.({ data });
    assert.match(String(await engine.failure), /storage is too slow/);
    engine.abort(); assert.ok(discarded); assert.equal((await engine.produceBlob()).size, 0);
  } finally { f.restore(); }
});
