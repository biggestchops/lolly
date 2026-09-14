// SPDX-License-Identifier: MPL-2.0
/** Lab instrumentation only; never imported by the application. */
export interface UiTiming {
  startTime: number;
  duration: number;
  interactionId?: number;
}

export interface UiTimings {
  longTasks: UiTiming[];
  events: UiTiming[];
}

declare global {
  interface Window {
    __lollyUiMetrics: { begin(): void; read(): UiTimings };
  }
}

/** Passed to Playwright's addInitScript: keep this function self-contained. */
export function installUiMetrics(): void {
  if (window.top !== window) return;
  for (const type of ['longtask', 'event']) {
    if (!PerformanceObserver.supportedEntryTypes.includes(type)) {
      throw new Error(`UI performance measurements require PerformanceObserver ${type}`);
    }
  }
  let start = performance.now();
  let timings: UiTimings = { longTasks: [], events: [] };
  const collect = (entries: PerformanceEntry[]) => {
    for (const entry of entries) {
      if (entry.startTime < start) continue;
      const event = entry as PerformanceEventTiming & { interactionId: number };
      const timing = { startTime: entry.startTime, duration: entry.duration, interactionId: event.interactionId };
      if (entry.entryType === 'longtask') timings.longTasks.push(timing);
      else if (event.interactionId > 0) timings.events.push(timing);
    }
  };
  const tasks = new PerformanceObserver(list => collect(list.getEntries()));
  const events = new PerformanceObserver(list => collect(list.getEntries()));
  tasks.observe({ type: 'longtask' });
  const eventOptions = { type: 'event', durationThreshold: 16 };
  events.observe(eventOptions);
  window.__lollyUiMetrics = {
    begin() {
      tasks.takeRecords(); events.takeRecords();
      timings = { longTasks: [], events: [] };
      start = performance.now();
    },
    read() {
      collect(tasks.takeRecords()); collect(events.takeRecords());
      return timings;
    },
  };
}

export function summarizeUiTimings(timings: UiTimings) {
  // Multiple events (pointerdown/up/click, keydown/up) can belong to ONE interaction.
  const interactions = new Map<number, number>();
  for (const event of timings.events) {
    if (!event.interactionId) continue;
    interactions.set(event.interactionId, Math.max(interactions.get(event.interactionId) ?? 0, event.duration));
  }
  return {
    longTaskCount: timings.longTasks.length,
    longTaskMs: timings.longTasks.reduce((sum, task) => sum + task.duration, 0),
    longTaskBlockingMs: timings.longTasks.reduce((sum, task) => sum + Math.max(0, task.duration - 50), 0),
    maxLongTaskMs: Math.max(0, ...timings.longTasks.map(task => task.duration)),
    observedInteractions: interactions.size,
    // No qualifying Event Timing entry is missing data, not a measured zero.
    // This short scripted sample is NOT field INP or a page-lifetime percentile.
    interactionMs: interactions.size ? Math.max(...interactions.values()) : null,
  };
}

export function median(values: number[]): number {
  if (!values.length) throw new Error('Cannot take the median of an empty sample');
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
