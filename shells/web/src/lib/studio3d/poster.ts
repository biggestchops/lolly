// SPDX-License-Identifier: MPL-2.0
/**
 * Posters: one still picture of a studio scene, drawn through the renderer pool.
 *
 * A host that shows many scenes at once (the Design canvas, plan 265 milestone 3) keeps
 * one live renderer and a poster for every other scene. A poster is the same render the
 * live mount would have drawn, taken off screen through a leased context and handed back
 * as a PNG blob, so the number of scenes on a page is not the number of WebGL contexts.
 *
 * The queue below is the scheduler around it, in the shape lib/multi-edit-single.ts uses:
 * one debounce per box so a burst of edits costs one render, one chain for the whole page
 * so two renders never share a leased context, and a small cache of finished pictures keyed
 * by what was drawn rather than by which box asked for it, so two boxes holding the same
 * scene at the same size draw once and a repaint redraws nothing at all.
 *
 * The renderer is injected, and `three` is reached through `await import()` inside the
 * render, so the queue's own behaviour is testable in Node without a GPU
 * (lib/studio3d/poster.test.ts).
 */
import { buildStudioScene } from '../../../../../engine/src/studio3d.ts';
import type { StudioValues } from '../../../../../engine/src/studio3d-collection.ts';
import type { StudioSceneQuality } from './scene-host.ts';
import type { StudioRead, StudioShaper } from './source.ts';

/**
 * Draw one scene and give back its bytes. The lease is released in a finally block, so a
 * refused source or an aborted caller never keeps a context out of the pool.
 */
export async function renderStudioPoster(
  values: StudioValues,
  width: number,
  height: number,
  time: number,
  quality: StudioSceneQuality,
  read: StudioRead,
  shaper: StudioShaper | null | undefined,
  signal: AbortSignal
): Promise<Blob> {
  signal.throwIfAborted();
  // Built before a context is asked for: values that do not make a scene fail here, with
  // the studio's own message, and hold nothing.
  const recipe = buildStudioScene({ version: 1, values });
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const pixels = Math.max(w, h);
  const [{ acquireStudioRenderer }, { studioAssetKeys }] = await Promise.all([
    import('./pool.ts'),
    import('./renderer.ts'),
  ]);
  signal.throwIfAborted();
  const lease = await acquireStudioRenderer('sheet');
  try {
    signal.throwIfAborted();
    // The keys are asked for at the same pixel target the update builds against: a source
    // whose curve detail follows the output is one asset per target, and the pair has to
    // name the same one or the retain list misses it.
    await lease.renderer.update(
      recipe,
      (url, inner) => read(url, AbortSignal.any([signal, inner])),
      shaper ?? undefined,
      { retain: studioAssetKeys(recipe, pixels), pixels }
    );
    signal.throwIfAborted();
    lease.renderer.render(w, h, quality, time, recipe.motion.seconds);
    signal.throwIfAborted();
    return await new Promise<Blob>((resolve, reject) =>
      lease.canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error('This scene could not be captured.'))),
        'image/png'
      )
    );
  } finally {
    lease.release();
  }
}

/** One picture asked for: what to draw, how big, at what moment and to what standard. */
export interface StudioPosterRequest {
  /** The thing being drawn, so repeat schedules for it coalesce. The Design box id. */
  key: string;
  /** The scene's identity. Two boxes holding the same scene share one cached picture. */
  recipeKey: string;
  values: StudioValues;
  width: number;
  height: number;
  /** Normalised time within the recipe's own clip length, 0 for a still poster. */
  time: number;
  quality: StudioSceneQuality;
}

/** A finished picture: the bytes, and an object URL an `<img>` can carry. */
export interface StudioPoster {
  blob: Blob;
  url: string;
}

export interface StudioPosterQueue {
  /**
   * Draw this request after the debounce. Repeat schedules for one key replace each other,
   * so a drag costs one render. A cached picture answers at once and runs no render.
   */
  schedule(
    request: StudioPosterRequest,
    onReady: (poster: StudioPoster) => void,
    onError?: (error: Error) => void
  ): void;
  /** The finished picture for this exact request, or null. */
  cached(request: StudioPosterRequest): StudioPoster | null;
  /** Draw now, past the debounce but still in the queue's order. What an export asks. */
  request(request: StudioPosterRequest): Promise<StudioPoster>;
  /** Drop queued work for one key: its box went live, or left the document. */
  cancel(key: string): void;
  /** Renders run and pictures held, for the tests. */
  stats(): { renders: number; held: number };
  dispose(): void;
}

const DEBOUNCE_MS = 120;
/** Finished pictures kept. Each is one PNG of a box, so this is a few megabytes at most. */
const POSTER_CAPACITY = 24;

function cacheKey(request: StudioPosterRequest): string {
  return [request.recipeKey, request.width, request.height, request.time, request.quality].join(
    '|'
  );
}

/**
 * The scheduler. `render` is injected so the debounce, the serial order and the cache can
 * be exercised without a GPU; the default draws through renderStudioPoster.
 */
export function createStudioPosterQueue(opts: {
  render: (request: StudioPosterRequest, signal: AbortSignal) => Promise<Blob>;
  debounceMs?: number;
  capacity?: number;
}): StudioPosterQueue {
  const draw = opts.render;
  const debounceMs = opts.debounceMs ?? DEBOUNCE_MS;
  const capacity = Math.max(1, opts.capacity ?? POSTER_CAPACITY);
  // One chain for the whole page: the pool lends two contexts, and a second render
  // starting while the first holds one would wait on the pool rather than in line here.
  let chain: Promise<unknown> = Promise.resolve();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const held = new Map<string, StudioPoster>();
  let renders = 0;
  let disposed = false;

  const remember = (key: string, poster: StudioPoster): void => {
    held.set(key, poster);
    while (held.size > capacity) {
      const oldest = held.keys().next().value as string;
      const gone = held.get(oldest)!;
      held.delete(oldest);
      try {
        URL.revokeObjectURL(gone.url);
      } catch {
        /* already gone */
      }
    }
  };

  /** The finished picture for this request, bumped so what is asked for is not evicted. */
  const cachedFor = (request: StudioPosterRequest): StudioPoster | null => {
    const key = cacheKey(request);
    const hit = held.get(key);
    if (!hit) return null;
    held.delete(key);
    held.set(key, hit);
    return hit;
  };

  const run = (request: StudioPosterRequest): Promise<StudioPoster> => {
    const key = cacheKey(request);
    const hit = cachedFor(request);
    if (hit) return Promise.resolve(hit);
    const controller = new AbortController();
    const started = chain.then(async () => {
      if (disposed) throw new Error('The poster queue is closed.');
      const again = held.get(key);
      if (again) return again;
      renders++;
      const blob = await draw(request, controller.signal);
      if (disposed) throw new Error('The poster queue is closed.');
      const poster = { blob, url: URL.createObjectURL(blob) };
      remember(key, poster);
      return poster;
    });
    // One failure must not stall the line behind it.
    chain = started.catch(() => {});
    return started;
  };

  return {
    schedule(request, onReady, onError) {
      if (disposed) return;
      const hit = cachedFor(request);
      if (hit) {
        onReady(hit);
        return;
      }
      const pending = timers.get(request.key);
      if (pending) clearTimeout(pending);
      timers.set(
        request.key,
        setTimeout(() => {
          timers.delete(request.key);
          run(request).then(onReady, (error: unknown) =>
            onError?.(error instanceof Error ? error : new Error(String(error)))
          );
        }, debounceMs)
      );
    },
    cached: cachedFor,
    request(request) {
      const pending = timers.get(request.key);
      if (pending) {
        clearTimeout(pending);
        timers.delete(request.key);
      }
      return run(request);
    },
    cancel(key) {
      const pending = timers.get(key);
      if (pending) {
        clearTimeout(pending);
        timers.delete(key);
      }
    },
    stats: () => ({ renders, held: held.size }),
    dispose() {
      disposed = true;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      for (const poster of held.values())
        try {
          URL.revokeObjectURL(poster.url);
        } catch {
          /* already gone */
        }
      held.clear();
    },
  };
}

/** The queue every Design canvas poster goes through, drawing through the pool. */
export function createStudioPosters(
  read: StudioRead,
  shaper: StudioShaper | null | undefined,
  debounceMs?: number
): StudioPosterQueue {
  return createStudioPosterQueue({
    debounceMs,
    render: (request, signal) =>
      renderStudioPoster(
        request.values,
        request.width,
        request.height,
        request.time,
        request.quality,
        read,
        shaper,
        signal
      ),
  });
}
