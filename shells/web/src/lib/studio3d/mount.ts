// SPDX-License-Identifier: MPL-2.0
import { buildStudioScene, studioAnimated } from '../../../../../engine/src/studio3d.ts';
import {
  studioActiveObject,
  studioObjectName,
} from '../../../../../engine/src/studio3d-arrangement.ts';
import {
  type StudioValues,
  studioActiveIndex,
  studioActiveValues,
  studioCollectionRows,
} from '../../../../../engine/src/studio3d-collection.ts';
import type { StudioSceneV1 } from '../../../../../packages/core/src/studio3d-v1.ts';
import { syncStudioControls, wireStudioGestures } from './controls.ts';
import { StudioRenderer } from './renderer.ts';
import type { StudioRead, StudioShaper } from './source.ts';
import { parseFontFamilies } from '../../bridge/font-registry.ts';
import type { TextAPI } from '../../../../../packages/core/src/host-v1/text.ts';

/** Brand roles the studio's font choice may name, each a CSS variable the shell keeps current. */
const FONT_ROLES: Record<string, string> = {
  sans: '--font-brand',
  display: '--font-display',
  mono: '--font-mono',
};

/**
 * A shaper over the host's text API: a brand role or family resolves to a font file the
 * host knows (brand statics, uploads, on-device Google fonts), then HarfBuzz outlines each
 * line. Null when the host cannot outline text at all.
 */
export function studioShaperFor(host: { text?: TextAPI }): StudioShaper | null {
  const text = host.text;
  if (!text?.fontUrl) return null;
  return async (line, font, fontSize, signal) => {
    const role = FONT_ROLES[font.font];
    const variable = (name: string) =>
      getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    // A brand without a display or mono face falls back to its main face, as the CSS does.
    const stack = role ? variable(role) || variable(FONT_ROLES.sans!) : font.font;
    const families = role ? parseFontFamilies(stack) : [font.font];
    let resolved: { url: string; variations?: string[] } | null = null;
    let tried = '';
    for (const family of families) {
      tried = family;
      resolved = await text.fontUrl!(family, { weight: font.weight });
      signal.throwIfAborted();
      if (resolved) break;
    }
    if (!resolved)
      throw new Error(
        `The font "${tried || font.font}" is not available on this device. Add it under Brand fonts, or choose another.`
      );
    const shaped = await text.toPath({
      text: line,
      fontUrl: resolved.url,
      fontSize,
      letterSpacing: font.tracking * fontSize,
      variations: resolved.variations,
    });
    signal.throwIfAborted();
    return { d: shaped.d, advance: shaped.advanceWidth || 0 };
  };
}

type FrameCanvas = HTMLCanvasElement & {
  __lollyFrameRender?: (
    t: number,
    seconds?: number,
    size?: { width: number; height: number }
  ) => void;
  __lollyFrameDriven?: boolean;
};
/** The capture's hard limits; a larger request renders at the cap and the capture scales the rest. */
const MAX_SIDE = 4096;
const MAX_PIXELS = 12_000_000;
function boundedSize(width: number, height: number): { width: number; height: number } {
  let w = Math.max(1, Math.round(width)),
    h = Math.max(1, Math.round(height));
  const factor = Math.min(1, MAX_SIDE / w, MAX_SIDE / h, Math.sqrt(MAX_PIXELS / (w * h)));
  if (factor < 1) {
    w = Math.max(1, Math.floor(w * factor));
    h = Math.max(1, Math.floor(h * factor));
  }
  return { width: w, height: h };
}
export interface StudioMountOptions {
  read: StudioRead;
  isCurrent?: () => boolean;
  setInput?: (id: string, value: unknown) => void;
  reviewCollection?: () => void;
  /** Open the library to add several sources at once to the arrangement or collection. */
  addObjects?: () => void;
  /** Outlines words in a brand font; without it a text source reports that it cannot. */
  shapeText?: StudioShaper | null;
  /** Quality of the frames the export clock asks for: a tile takes preview samples. */
  frameQuality?: 'preview' | 'export';
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
  render(
    quality: 'preview' | 'export' | 'clip',
    time?: number,
    seconds?: number,
    size?: { width: number; height: number }
  ): void;
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
      render: (quality, time = 0, seconds, size) => {
        if (current.error) throw current.error;
        if (!current.ready) throw new Error('Wait for the studio preview to finish loading.');
        const bounds = current.marker.getBoundingClientRect();
        current.marker.style.setProperty(
          '--studio-ui-scale',
          String(current.marker.clientWidth / Math.max(1, bounds.width))
        );
        const max = Math.max(bounds.width, bounds.height),
          scale = quality === 'preview' ? Math.min(1, 800 / Math.max(1, max)) : 1;
        // An export names its pixel size; the frame is resampled at that size (within
        // the capture limits) so a larger output is not an enlarged preview.
        const target =
          quality !== 'preview' && size && size.width > 0 && size.height > 0
            ? boundedSize(size.width, size.height)
            : {
                width: Math.max(1, Math.round(bounds.width * scale)),
                height: Math.max(1, Math.round(bounds.height * scale)),
              };
        try {
          handle.render(target.width, target.height, quality, time, seconds);
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
    // The export clock names a clip length only for video and GIF frames; those take the
    // clip sample count, a still keeps the full export count, and a tile stays a preview.
    canvas.__lollyFrameRender = (t, seconds, size) =>
      current.render(
        current.options.frameQuality === 'preview' ? 'preview' : seconds !== undefined ? 'clip' : 'export',
        t,
        seconds,
        size
      );
    let last = 0;
    // Only an interactive mount plays motion: a template preview, a batch stage or a
    // contact sheet renders its first frame once, otherwise every preview of an
    // animated scene would run a full WebGL loop and starve the page.
    const tick = (now: number) => {
      if (!container.isConnected) {
        destroy(current);
        return;
      }
      if (
        current.ready &&
        !canvas.__lollyFrameDriven &&
        current.options.setInput !== undefined &&
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
  if (entry.inputValues.source === 'arrangement') {
    const label = marker.querySelector('[data-studio-object-label]');
    if (label) {
      try {
        const index = studioActiveObject(entry.inputValues);
        const row = (entry.inputValues.objects as StudioValues[])[index] ?? {};
        const count = (entry.inputValues.objects as StudioValues[]).length;
        const missing =
          (row.kind === 'artwork' || row.kind === 'model') &&
          !(row.asset && (typeof row.asset === 'string' || (row.asset as { url?: string }).url));
        label.textContent = `${index + 1} of ${count}: ${studioObjectName(row, index)}${row.visible === false ? ' (hidden)' : missing ? ' (no file yet)' : ''}`;
      } catch (error) {
        label.textContent = (error as Error).message;
      }
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
    const info = await entry.handle.update(recipe, options.read, options.shapeText ?? undefined);
    if (generation !== entry.generation || options.isCurrent?.() === false) return;
    entry.ready = true;
    syncStudioControls(entry);
    entry.render('preview');
    status(entry, '', 'ready');
    const details = marker.querySelector<HTMLElement>('[data-studio-info]');
    if (details) {
      const prefix =
        recipe.objects
          ? `${recipe.objects.filter((object) => object.visible && !object.pending).length} of ${recipe.objects.length} objects visible, ${Math.round(info.triangles).toLocaleString()} triangles. Selected object slots: `
          : '';
      details.textContent = `${prefix}${info.slots.map((slot, i) => `${i + 1}: ${slot.id}`).join(' / ')}${info.warnings.length ? '\n' + info.warnings.join('\n') : ''}`;
    }
  } catch (error) {
    if (generation !== entry.generation || options.isCurrent?.() === false) return;
    entry.ready = false;
    entry.error = error instanceof Error ? error : new Error(String(error));
    status(entry, entry.error.message, 'error');
    throw entry.error;
  }
}

export function prepareToolStudio(container: Element, quality: 'preview' | 'export' = 'export'): void {
  if (!container.querySelector('[data-lolly-studio]')) return;
  const entry = registry.get(container);
  if (!entry) throw new Error('The studio renderer is unavailable.');
  entry.render(quality);
}

/** Frame every object once the studio is ready, as the Frame all button would (one undo step). */
export function frameToolStudio(container: Element, timeoutMs = 15_000): Promise<boolean> {
  const started = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      const entry = registry.get(container);
      if (!entry || !container.isConnected || Date.now() - started > timeoutMs) return resolve(false);
      if (entry.ready && !entry.error) {
        const fit = entry.marker.querySelector<HTMLButtonElement>('[data-studio-fit]');
        if (fit && !fit.disabled) {
          fit.click();
          return resolve(true);
        }
      }
      setTimeout(tick, 120);
    };
    tick();
  });
}

export function destroyToolStudio(container?: Element): void {
  for (const entry of registry.values())
    if (!container || entry.container === container) destroy(entry);
}
