// SPDX-License-Identifier: MPL-2.0
import { perfUiOn } from '../feature-flags.ts';

/** Best-effort background work. Re-read the limit before starting each job so a
 * live policy change also applies to the remainder of a large offline refresh. */
export function runBackgroundTasks<T>(
  items: readonly T[],
  run: (item: T) => Promise<unknown>,
  limit: () => number = () => perfUiOn() ? 2 : 6,
): Promise<void> {
  return new Promise(resolve => {
    let next = 0, active = 0;
    const pump = (): void => {
      while (next < items.length && active < Math.max(1, limit())) {
        const item = items[next++]!;
        active++;
        void Promise.resolve().then(() => run(item)).catch(() => {
          // A failed asset must not strand the rest of an offline download.
        }).finally(() => { active--; pump(); });
      }
      if (next === items.length && active === 0) resolve();
    };
    pump();
  });
}
