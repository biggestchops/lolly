// SPDX-License-Identifier: MPL-2.0
import {
  studioCameraEdit,
  studioFocusEdit,
  type StudioValues,
} from '../../../../../engine/src/studio3d-collection.ts';
import type { StudioSceneV1 } from '../../../../../packages/core/src/studio3d-v1.ts';
import type { StudioRenderer } from './renderer.ts';

export interface StudioControls {
  canvas: HTMLCanvasElement;
  marker: HTMLElement;
  handle: StudioRenderer;
  ready: boolean;
  recipe: StudioSceneV1;
  inputValues: StudioValues;
  inputCamera: StudioValues;
  options: { setInput?: (id: string, value: unknown) => void; endGesture?: () => void };
  render(quality: 'preview'): void;
}
function commit(entry: StudioControls, edit: { id: string; value: unknown }): void {
  const focused = document.activeElement;
  if (focused === entry.canvas) entry.canvas.dataset.restoreFocus = 'canvas';
  else
    for (const name of ['fit', 'reset', 'focus', 'auto-focus'])
      if (focused?.hasAttribute(`data-studio-${name}`)) entry.canvas.dataset.restoreFocus = name;
  entry.options.endGesture?.();
  entry.options.setInput?.(edit.id, edit.value);
  entry.options.endGesture?.();
}
function cameraEdit(entry: StudioControls, values: StudioValues): void {
  commit(entry, studioCameraEdit(entry.inputValues, { ...entry.inputCamera, ...values }));
}
function picking(entry: StudioControls, value: boolean): void {
  entry.canvas.dataset.pickFocus = String(value);
  entry.canvas.style.cursor = value ? 'crosshair' : 'grab';
  entry.marker.querySelector('[data-studio-focus]')?.setAttribute('aria-pressed', String(value));
  const note = entry.marker.querySelector('[data-studio-camera-note]');
  if (note) note.textContent = value ? 'Click the subject to focus. Escape cancels.' : '';
}

export function wireStudioGestures(entry: StudioControls): void {
  let start: { x: number; y: number; azimuth: number; elevation: number } | null = null;
  let pose: { azimuth: number; elevation: number } | null = null;
  const cancel = () => {
    start = null;
    pose = null;
    entry.handle.view(entry.recipe.camera);
    if (entry.ready) entry.render('preview');
  };
  entry.canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !entry.ready || !entry.options.setInput) return;
    entry.canvas.focus({ preventScroll: true });
    if (entry.canvas.dataset.pickFocus === 'true') {
      const box = entry.canvas.getBoundingClientRect();
      const focus = entry.handle.focus(
        box.width / box.height,
        ((e.clientX - box.left) / box.width) * 2 - 1,
        1 - ((e.clientY - box.top) / box.height) * 2
      );
      if (focus !== null) {
        picking(entry, false);
        commit(entry, studioFocusEdit(entry.inputValues, focus));
      } else {
        const note = entry.marker.querySelector('[data-studio-camera-note]');
        if (note)
          note.textContent = 'No subject here. Click the object, or press Escape to cancel.';
      }
      e.preventDefault();
      return;
    }
    start = {
      x: e.clientX,
      y: e.clientY,
      azimuth: entry.recipe.camera.azimuth,
      elevation: entry.recipe.camera.elevation,
    };
    pose = null;
    entry.canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  entry.canvas.addEventListener('pointermove', (e) => {
    if (!start || !entry.ready || Math.hypot(e.clientX - start.x, e.clientY - start.y) < 3) return;
    pose = {
      azimuth: Math.max(-180, Math.min(180, start.azimuth - (e.clientX - start.x) * 0.3)),
      elevation: Math.max(-60, Math.min(80, start.elevation + (e.clientY - start.y) * 0.2)),
    };
    entry.handle.view(pose);
    entry.render('preview');
  });
  entry.canvas.addEventListener('pointerup', () => {
    start = null;
    if (pose) {
      cameraEdit(entry, pose);
      pose = null;
    }
  });
  entry.canvas.addEventListener('pointercancel', cancel);
  entry.canvas.addEventListener('studio-reset-gesture', cancel);
  entry.canvas.addEventListener('lostpointercapture', () => {
    if (start) cancel();
  });
  entry.canvas.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      picking(entry, false);
      cancel();
      return;
    }
    if (
      !entry.ready ||
      !entry.options.setInput ||
      !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)
    )
      return;
    e.preventDefault();
    e.stopPropagation();
    const amount = e.shiftKey ? 10 : 2;
    cameraEdit(entry, {
      azimuth: Math.max(
        -180,
        Math.min(
          180,
          entry.recipe.camera.azimuth +
            (e.key === 'ArrowLeft' ? -amount : e.key === 'ArrowRight' ? amount : 0)
        )
      ),
      elevation: Math.max(
        -60,
        Math.min(
          80,
          entry.recipe.camera.elevation +
            (e.key === 'ArrowUp' ? amount : e.key === 'ArrowDown' ? -amount : 0)
        )
      ),
    });
  });
}

export function syncStudioControls(entry: StudioControls): void {
  if (!entry.ready) entry.canvas.dispatchEvent(new Event('studio-reset-gesture'));
  const actions = entry.marker.querySelector<HTMLElement>('[data-studio-camera-actions]');
  if (actions) actions.hidden = !entry.options.setInput;
  entry.canvas.tabIndex = entry.options.setInput ? 0 : -1;
  const button = (selector: string, action: () => void) => {
    const b = entry.marker.querySelector<HTMLButtonElement>(selector);
    if (b) {
      b.disabled = !entry.ready;
      b.onclick = () => {
        try { action(); }
        catch (error) {
          const note = entry.marker.querySelector('[data-studio-camera-note]');
          if (note) note.textContent = (error as Error).message;
        }
      };
    }
    return b;
  };
  button('[data-studio-fit]', () => {
    const box = entry.canvas.getBoundingClientRect(),
      fit = entry.handle.fit(box.width / box.height);
    if (!fit) return;
    cameraEdit(entry, {
      zoom: fit.zoom,
      ...Object.fromEntries(
        ['panX', 'panY', 'panZ'].map((key, i) => [
          key,
          Number(entry.inputCamera[key] || 0) +
            fit.target.getComponent(i) -
            entry.recipe.camera.target[i]!,
        ])
      ),
    });
  });
  button('[data-studio-reset]', () =>
    cameraEdit(entry, { azimuth: 25, elevation: 14, fov: 29, zoom: 1, panX: 0, panY: 0, panZ: 0 })
  );
  const focus = button('[data-studio-focus]', () => {
    picking(entry, entry.canvas.dataset.pickFocus !== 'true');
    entry.canvas.focus({ preventScroll: true });
  });
  if (focus) focus.disabled = !entry.ready || entry.recipe.camera.aperture === 0;
  button('[data-studio-auto-focus]', () => commit(entry, studioFocusEdit(entry.inputValues, 0)));
  picking(entry, false);
  if (entry.ready && entry.canvas.dataset.restoreFocus) {
    const name = entry.canvas.dataset.restoreFocus;
    const target =
      name === 'canvas'
        ? entry.canvas
        : entry.marker.querySelector<HTMLElement>(`[data-studio-${name}]`);
    target?.focus({ preventScroll: true });
    delete entry.canvas.dataset.restoreFocus;
  }
}
