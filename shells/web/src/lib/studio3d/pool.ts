// SPDX-License-Identifier: MPL-2.0
/**
 * A bounded pool of studio renderers for work that is not the interactive mount: batch
 * rows, contact sheets, composed children and preview tiles.
 *
 * Each renderer owns a WebGL context, and a browser keeps only about sixteen alive before
 * it drops the oldest one (the same cap lib/viz-tool-mount.ts documents). Opening one per
 * batch row spent that budget on work that finishes in a second, and threw away the
 * environment map, the backdrop and every loaded source with it. Two contexts are lent out
 * here, beside the one an interactive mount holds, and a returned renderer keeps its
 * environment and backdrop for the next caller.
 *
 * A lease is held for one document: acquire, mount, export, release in a finally block. A
 * caller that cannot get one within the wait below is given a renderer of its own rather
 * than being left to hang, because an export must finish even when something else forgot
 * to release.
 */
import { StudioRenderer } from './renderer.ts';

/** Contexts this pool lends out at once, beside the interactive mount's own. */
export const STUDIO_POOL_BUDGET = 2;
/** How long an idle renderer is kept warm before the pool closes its context. */
export const STUDIO_POOL_IDLE_MS = 30_000;
/** How long a caller waits for a free renderer before one is made outside the budget. */
export const STUDIO_POOL_WAIT_MS = 20_000;

/** What a lease is for; the budget is shared, the purpose is for reporting. */
export type StudioPurpose = 'batch' | 'sheet';

export interface StudioLease {
  readonly renderer: StudioRenderer;
  /** The renderer's own canvas; the mount adopts it instead of making one. */
  readonly canvas: HTMLCanvasElement;
  readonly purpose: StudioPurpose;
  /**
   * Give the renderer back. It keeps its environment and backdrop, and drops every source
   * the last update did not place, so a sheet's twelve icons do not stay on the GPU.
   */
  release(): void;
}

interface Entry {
  renderer: StudioRenderer;
  canvas: HTMLCanvasElement;
  busy: boolean;
  /** Set when the browser drops this renderer's context; it is closed, never lent again. */
  lost: boolean;
  idleTimer: ReturnType<typeof setTimeout> | undefined;
}

const entries: Entry[] = [];
const waiting: { grant: (entry: Entry) => void; timer: ReturnType<typeof setTimeout> }[] = [];
let created = 0;

function close(entry: Entry): void {
  clearTimeout(entry.idleTimer);
  const at = entries.indexOf(entry);
  if (at >= 0) entries.splice(at, 1);
  entry.renderer.dispose();
}

function idle(entry: Entry): void {
  clearTimeout(entry.idleTimer);
  entry.idleTimer = setTimeout(() => {
    if (!entry.busy) close(entry);
  }, STUDIO_POOL_IDLE_MS);
}

function make(): Entry {
  const canvas = document.createElement('canvas');
  const entry: Entry = {
    renderer: new StudioRenderer(canvas),
    canvas,
    busy: true,
    lost: false,
    idleTimer: undefined,
  };
  canvas.addEventListener('webglcontextlost', () => {
    entry.lost = true;
    if (!entry.busy) close(entry);
  });
  created++;
  entries.push(entry);
  return entry;
}

function lease(entry: Entry, purpose: StudioPurpose): StudioLease {
  let open = true;
  return {
    renderer: entry.renderer,
    canvas: entry.canvas,
    purpose,
    release: () => {
      if (!open) return;
      open = false;
      entry.busy = false;
      // A held frame and a set's retained sources belong to the lease that ends here.
      entry.renderer.freeze(false);
      if (entry.lost) close(entry);
      else entry.renderer.trimAssets();
      const next = waiting.shift();
      if (!next) {
        if (!entry.lost) idle(entry);
        return;
      }
      clearTimeout(next.timer);
      // A lost context is replaced rather than passed on.
      if (entry.lost) next.grant(make());
      else {
        entry.busy = true;
        next.grant(entry);
      }
    },
  };
}

/**
 * A renderer for one document's worth of work. Release it in a finally block: until then
 * it counts against the budget.
 */
export function acquireStudioRenderer(purpose: StudioPurpose): Promise<StudioLease> {
  const free = entries.find((entry) => !entry.busy && !entry.lost);
  if (free) {
    clearTimeout(free.idleTimer);
    free.busy = true;
    return Promise.resolve(lease(free, purpose));
  }
  if (entries.length < STUDIO_POOL_BUDGET) return Promise.resolve(lease(make(), purpose));
  return new Promise<StudioLease>((resolve) => {
    const request = {
      grant: (entry: Entry) => resolve(lease(entry, purpose)),
      timer: setTimeout(() => {
        const at = waiting.indexOf(request);
        if (at >= 0) waiting.splice(at, 1);
        console.warn(
          `The studio renderer pool was busy for ${Math.round(STUDIO_POOL_WAIT_MS / 1000)} s, so this ${purpose} render opened a context of its own.`
        );
        resolve(lease(make(), purpose));
      }, STUDIO_POOL_WAIT_MS),
    };
    waiting.push(request);
  });
}

/** What the pool holds now. The lifecycle suite asserts the context count against this. */
export function studioPoolState(): {
  size: number;
  busy: number;
  waiting: number;
  created: number;
} {
  return {
    size: entries.length,
    busy: entries.filter((entry) => entry.busy).length,
    waiting: waiting.length,
    created,
  };
}

/** Close every renderer the pool holds. Only a released one can be closed. */
export function drainStudioPool(): void {
  for (const entry of [...entries]) if (!entry.busy) close(entry);
}
