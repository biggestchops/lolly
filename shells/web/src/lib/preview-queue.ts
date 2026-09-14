// SPDX-License-Identifier: MPL-2.0
/** One serial idle queue shared by the gallery grid and featured strips. */
export interface PreviewTask {
  /** Lower runs first; null parks the task until the view makes it relevant. */
  priority(): number | null;
  stale?(): boolean;
  run(): Promise<void>;
}

const idle = (callback: () => void): (() => void) => {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(callback, { timeout: 3000 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(callback, 60);
  return () => clearTimeout(id);
};

export function createPreviewQueue(
  schedule: (callback: () => void) => () => void = idle,
  onError: (error: unknown) => void = error => console.warn('Preview render failed', error),
  timeoutMs = 60_000,
) {
  let tasks: PreviewTask[] = [];
  let cancel: (() => void) | undefined;
  let running = false;
  let destroyed = false;

  function wake(): void {
    if (destroyed || running || cancel || !tasks.length) return;
    cancel = schedule(() => {
      cancel = undefined;
      if (destroyed) return;
      // Choose AFTER yielding: a newly queued cover always outranks an extra
      // template, including one that was waiting when this idle was requested.
      tasks = tasks.filter(task => !task.stale?.());
      let chosen = -1;
      let best = Infinity;
      tasks.forEach((task, i) => {
        const priority = task.priority();
        if (priority !== null && priority < best) { chosen = i; best = priority; }
      });
      if (chosen < 0) return;
      const task = tasks.splice(chosen, 1)[0]!;
      running = true;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      void Promise.race([
        Promise.resolve().then(() => task.run()),
        new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error('Preview render timed out')), timeoutMs); }),
      ]).catch(onError).finally(() => {
        clearTimeout(deadline);
        running = false;
        wake();
      });
    });
  }

  return {
    add(task: PreviewTask): void { if (!destroyed) { tasks.push(task); wake(); } },
    wake,
    destroy(): void { destroyed = true; tasks = []; cancel?.(); cancel = undefined; },
  };
}

export type PreviewQueue = ReturnType<typeof createPreviewQueue>;
