// SPDX-License-Identifier: MPL-2.0
import { buildStudioScene, studioAnimated } from '../../../../../engine/src/studio3d.ts';
import {
  type StudioValues,
  studioActiveIndex,
  studioActiveValues,
  studioCollectionRows,
} from '../../../../../engine/src/studio3d-collection.ts';
import type { StudioSceneV1 } from '../../../../../packages/core/src/studio3d-v1.ts';
import { syncStudioControls, wireStudioGestures } from './controls.ts';
import { StudioRenderer } from './renderer.ts';
import type { StudioRead } from './source.ts';

type FrameCanvas = HTMLCanvasElement & {
  __lollyFrameRender?: (t: number, seconds?: number) => void;
  __lollyFrameDriven?: boolean;
};
export interface StudioMountOptions {
  read: StudioRead;
  isCurrent?: () => boolean;
  setInput?: (id: string, value: unknown) => void;
  reviewCollection?: () => void;
  endGesture?: () => void;
}
interface Entry {
  container: Element;
  marker: HTMLElement;
  canvas: FrameCanvas;
  handle: StudioRenderer;
  options: StudioMountOptions;
  recipe: StudioSceneV1;
  inputCamera: Record<string, unknown>;
  inputValues: StudioValues;
  error: Error | null;
  ready: boolean;
  generation: number;
  frame: number;
  observer: ResizeObserver;
  render(quality: 'preview' | 'export', time?: number, seconds?: number): void;
}
const registry = new Map<Element, Entry>();

function status(entry: Entry, message: string, state: 'loading' | 'ready' | 'error'): void {
  entry.marker.dataset.studioState = state;
  const label = entry.marker.querySelector<HTMLElement>('[data-studio-status]');
  if (label) {
    label.textContent = message;
    label.hidden = state === 'ready';
  }
}

function destroy(entry: Entry): void {
  entry.generation++;
  cancelAnimationFrame(entry.frame);
  entry.observer.disconnect();
  entry.handle.dispose();
  delete entry.canvas.__lollyFrameRender;
  entry.canvas.remove();
  registry.delete(entry.container);
}

/** Re-adopt one canvas across tool paints; a stale load cannot publish over a newer edit. */
export async function mountToolStudio(
  container: Element,
  options: StudioMountOptions
): Promise<void> {
  for (const entry of registry.values()) if (!entry.container.isConnected) destroy(entry);
  const marker = container.querySelector<HTMLElement>('[data-lolly-studio]');
  let entry = registry.get(container);
  if (!marker) {
    if (entry) destroy(entry);
    return;
  }
  let recipe: StudioSceneV1;
  let raw: { values?: Record<string, unknown> };
  try {
    raw = JSON.parse(marker.dataset.lollyStudio || '{}') as typeof raw;
    recipe = buildStudioScene(raw);
  } catch (error) {
    if (entry) {
      entry.ready = false;
      entry.error = error instanceof Error ? error : new Error(String(error));
    }
    marker.dataset.studioState = 'error';
    const label = marker.querySelector('[data-studio-status]');
    if (label) label.textContent = (error as Error).message;
    throw error;
  }
  if (!entry) {
    const canvas = document.createElement('canvas') as FrameCanvas;
    canvas.className = 'lolly-studio-canvas';
    canvas.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;';
    canvas.setAttribute(
      'aria-label',
      '3D studio preview. Drag or use arrow keys to orbit. Shift moves by ten degrees.'
    );
    let handle: StudioRenderer;
    try {
      handle = new StudioRenderer(canvas);
    } catch (error) {
      const label = marker.querySelector('[data-studio-status]');
      if (label) label.textContent = `Studio unavailable: ${(error as Error).message}`;
      marker.dataset.studioState = 'error';
      throw error;
    }
    const current: Entry = {
      container,
      marker,
      canvas,
      handle,
      options,
      recipe,
      inputCamera: {},
      inputValues: {},
      error: null,
      ready: false,
      generation: 0,
      frame: 0,
      observer: new ResizeObserver(() => {
        if (current.ready && !canvas.__lollyFrameDriven) {
          try {
            current.render('preview');
          } catch {
            /* The preview shows the failure. */
          }
        }
      }),
      render: (quality, time = 0, seconds) => {
        if (current.error) throw current.error;
        if (!current.ready) throw new Error('Wait for the studio preview to finish loading.');
        const bounds = current.marker.getBoundingClientRect();
        current.marker.style.setProperty(
          '--studio-ui-scale',
          String(current.marker.clientWidth / Math.max(1, bounds.width))
        );
        const max = Math.max(bounds.width, bounds.height),
          scale = quality === 'preview' ? Math.min(1, 800 / Math.max(1, max)) : 1;
        try {
          handle.render(
            Math.max(1, Math.round(bounds.width * scale)),
            Math.max(1, Math.round(bounds.height * scale)),
            quality,
            time,
            seconds
          );
        } catch (error) {
          current.error = error instanceof Error ? error : new Error(String(error));
          current.ready = false;
          status(current, current.error.message, 'error');
          throw current.error;
        }
      },
    };
    entry = current;
    registry.set(container, entry);
    wireStudioGestures(entry);
    canvas.__lollyFrameRender = (t, seconds) => current.render('export', t, seconds);
    let last = 0;
    const tick = (now: number) => {
      if (!container.isConnected) {
        destroy(current);
        return;
      }
      if (
        current.ready &&
        !canvas.__lollyFrameDriven &&
        studioAnimated(current.recipe) &&
        now - last > 50
      ) {
        last = now;
        try {
          current.render(
            'preview',
            ((now / 1000) % current.recipe.motion.seconds) / current.recipe.motion.seconds
          );
        } catch {
          /* status carries the failure */
        }
      }
      current.frame = requestAnimationFrame(tick);
    };
    entry.frame = requestAnimationFrame(tick);
  }
  entry.observer.disconnect();
  entry.marker = marker;
  entry.options = options;
  entry.recipe = recipe;
  entry.inputValues = raw.values || {};
  entry.inputCamera = {
    azimuth: recipe.camera.azimuth,
    elevation: recipe.camera.elevation,
    fov: recipe.camera.fov,
    zoom: recipe.camera.zoom,
    ...(studioActiveValues(entry.inputValues).camera as StudioValues),
  };
  const review = marker.querySelector<HTMLButtonElement>('[data-studio-review]');
  if (review) {
    review.hidden = !options.reviewCollection;
    review.onclick = () => options.reviewCollection?.();
  }
  const reset = marker.querySelector<HTMLButtonElement>('[data-studio-shared-camera]');
  if (entry.inputValues.source === 'collection') {
    const selected = studioCollectionRows(entry.inputValues)[studioActiveIndex(entry.inputValues)]!;
    const label = marker.querySelector('[data-studio-item-label]');
    if (label)
      label.textContent = `${selected.index + 1}. ${selected.name}${selected.ownFraming ? ' (own framing)' : ''}`;
    if (reset) {
      reset.hidden = !options.setInput || !selected.ownFraming;
      reset.onclick = () => {
        options.endGesture?.();
        options.setInput?.(
          'subjects',
          (entry!.inputValues.subjects as StudioValues[]).map((item, i) =>
            i === selected.index ? { ...item, ownFraming: false } : item
          )
        );
        options.endGesture?.();
      };
    }
  }
  const generation = ++entry.generation;
  marker.appendChild(entry.canvas);
  entry.observer.observe(marker);
  entry.ready = false;
  syncStudioControls(entry);
  entry.error = null;
  status(entry, 'Preparing the studio...', 'loading');
  try {
    const info = await entry.handle.update(recipe, options.read);
    if (generation !== entry.generation || options.isCurrent?.() === false) return;
    entry.ready = true;
    syncStudioControls(entry);
    entry.render('preview');
    status(entry, '', 'ready');
    const details = marker.querySelector<HTMLElement>('[data-studio-info]');
    if (details) {
      details.textContent = `${info.slots.map((slot, i) => `${i + 1}: ${slot.id}`).join(' / ')}${info.warnings.length ? '\n' + info.warnings.join('\n') : ''}`;
    }
  } catch (error) {
    if (generation !== entry.generation || options.isCurrent?.() === false) return;
    entry.ready = false;
    entry.error = error instanceof Error ? error : new Error(String(error));
    status(entry, entry.error.message, 'error');
    throw entry.error;
  }
}

export function prepareToolStudio(container: Element): void {
  if (!container.querySelector('[data-lolly-studio]')) return;
  const entry = registry.get(container);
  if (!entry) throw new Error('The studio renderer is unavailable.');
  entry.render('export');
}

export function destroyToolStudio(container?: Element): void {
  for (const entry of registry.values())
    if (!container || entry.container === container) destroy(entry);
}
