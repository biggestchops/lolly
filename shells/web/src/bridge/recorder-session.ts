// SPDX-License-Identifier: MPL-2.0
import type { AudioLevel, RecordSession } from '@lolly-tools/core/host-v1';

/** Shell-only encoder contract. Failure resolves, so an early device error cannot reject unobserved. */
export interface RecordEngine {
  readonly type: string;
  readonly failure?: Promise<unknown>;
  readonly ended?: Promise<void>;
  produceBlob(): Promise<Blob>;
  abort(): void;
}

/** Completion also covers the browser's Stop sharing button, duration limit and encoder failure. */
export interface RecordingSession extends RecordSession {
  readonly finished: Promise<Blob>;
}

interface SessionOwner {
  micActive: boolean;
  release(): void;
  subscribe(cb: (level: AudioLevel) => void): () => void;
  onSourceEnded?: (finish: () => void) => void;
}

/** One terminal path; cancellation and late encoder completions cannot publish a discarded take. */
export function createRecordingSession(engine: RecordEngine, owner: SessionOwner,
  maxMs?: number, finalizeMs = 30_000): RecordingSession {
  let state: 'recording' | 'finishing' | 'done' = 'recording';
  let maxTimer: ReturnType<typeof setTimeout> | undefined;
  let finalizeTimer: ReturnType<typeof setTimeout> | undefined;
  let settle!: (blob: Blob) => void;
  const finished = new Promise<Blob>(resolve => { settle = resolve; });
  const complete = (blob: Blob, abort = false) => {
    if (state === 'done') return;
    state = 'done'; clearTimeout(maxTimer); clearTimeout(finalizeTimer);
    try { if (abort) engine.abort(); } catch { /* teardown still releases the source */ }
    try { owner.release(); } catch { /* a device disappearing must not strand Stop */ }
    settle(blob);
  };
  const fail = () => complete(new Blob([], { type: engine.type }), true);
  const finish = () => {
    if (state !== 'recording') return;
    state = 'finishing'; clearTimeout(maxTimer);
    // A wedged encoder must not keep the camera/microphone and a pending Stop alive forever.
    finalizeTimer = setTimeout(fail, finalizeMs);
    try { void engine.produceBlob().then(blob => complete(blob), fail); } catch { fail(); }
  };
  if (maxMs && maxMs > 0) maxTimer = setTimeout(finish, maxMs);
  void engine.failure?.then(fail);
  void engine.ended?.then(finish);
  owner.onSourceEnded?.(finish);
  return {
    micActive: owner.micActive, finished,
    subscribe: owner.subscribe,
    stop: () => { finish(); return finished; },
    cancel: () => complete(new Blob([]), true),
  };
}
