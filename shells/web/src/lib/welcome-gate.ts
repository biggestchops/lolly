// SPDX-License-Identifier: MPL-2.0
/**
 * When background maintenance may start on a visit that can show the first-run welcome.
 *
 * The rule (Andy, 2026-09-17): housekeeping the visitor does not need right away, such
 * as pruning stale asset blobs or warming the offline cache, waits until the welcome
 * dialog has closed. Everything the gallery shows keeps loading while the dialog is
 * open, so the gallery is ready the moment the visitor closes or dismisses it.
 *
 * Three kinds of hold keep the gate shut, and welcomeSettled() resolves once none is
 * left (at once when there was none):
 *
 *   boot        main.ts, on a gallery visit whose welcome is not settled yet. Taken
 *               before the catalog sync starts, released by the first welcome decision
 *               that finishes, or once the first view has mounted, whichever is first.
 *   decision    decideWelcome(), while a caller works out whether the welcome opens.
 *               Released when that answer is known, including when the work throws.
 *   dialog      components/welcome-dialog.ts, from the moment the dialog opens until it
 *               closes by any route, a navigation teardown included.
 *
 * The gate only decides when maintenance STARTS. Work that is already running carries
 * on if a later welcome opens.
 *
 * No imports, on purpose: main.ts loads this on the boot path, and it must not pull the
 * dialog, its stylesheet or anything behind them into the first-load graph. The
 * dismissed flag lives here for the same reason; welcome-dialog.ts re-exports it.
 */

/** Persisted (localStorage, same tier as the theme) once the welcome is settled. */
export const WELCOME_DISMISSED_KEY = 'lolly-welcome-dismissed';

/** True once the user has settled the welcome (or when storage is unavailable:
 *  asking again on every visit would be worse than never asking). */
export function isWelcomeDismissed(): boolean {
  try { return localStorage.getItem(WELCOME_DISMISSED_KEY) === '1'; }
  catch { return true; }
}

/** Persist the dismissal. Also called by the #/start wizard after an install. */
export function markWelcomeDismissed(): void {
  try { localStorage.setItem(WELCOME_DISMISSED_KEY, '1'); } catch { /* storage off, so it just won't persist */ }
}

let holds = 0;
let waiters: Array<() => void> = [];

/** Hold the gate shut. Returns the release, which is safe to call more than once. */
export function holdWelcomeGate(): () => void {
  holds += 1;
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    holds -= 1;
    if (holds > 0) return;
    const ready = waiters;
    waiters = [];
    for (const resolve of ready) resolve();
  };
}

/** Resolves once nothing holds the gate: immediately when nothing does now. */
export function welcomeSettled(): Promise<void> {
  if (holds === 0) return Promise.resolve();
  return new Promise((resolve) => { waiters.push(resolve); });
}

let bootHold: (() => void) | null = null;

/** Boot: a welcome decision is on its way. Holds the gate until settleWelcomeDecision(). */
export function expectWelcomeDecision(): void {
  bootHold ??= holdWelcomeGate();
}

/** Release the boot hold. A no-op when there is none or it was already released. */
export function settleWelcomeDecision(): void {
  const release = bootHold;
  bootHold = null;
  release?.();
}

/**
 * Run a welcome decision with the gate held, then release it and the boot hold.
 * A decision that opens the dialog hands over to the dialog's own hold, which is
 * taken as the dialog opens. No hold is taken when the welcome was already
 * settled, unless `force` reopens it (the `#/?welcome` deep link).
 */
export async function decideWelcome<T>(decide: () => Promise<T>, force = false): Promise<T> {
  const release = force || !isWelcomeDismissed() ? holdWelcomeGate() : null;
  try {
    return await decide();
  } finally {
    release?.();
    settleWelcomeDecision();
  }
}
