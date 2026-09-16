// SPDX-License-Identifier: MPL-2.0
import { t } from '../../i18n.ts';
import { cameraCrop, layoutBoxes, OUTPUT, readScene, type Placement, type PresentationScene } from './scene.ts';

/** Private direct manipulation: output coordinates stay independent of preview size. */
export function mountCameraFraming(doc: Document, host: HTMLElement, change: (box: Placement) => void) {
  const root = doc.createElement('div'); root.className = 'pr-framing-canvas';
  const content = doc.createElement('div'); content.className = 'pr-framing-content'; content.textContent = t('Content');
  const camera = doc.createElement('div'); camera.className = 'pr-framing-camera'; camera.tabIndex = 0;
  camera.setAttribute('role', 'group'); camera.setAttribute('aria-label', t('Move camera'));
  const video = doc.createElement('video'); video.muted = true; video.playsInline = true;
  const feed = doc.createElement('div'); feed.className = 'pr-framing-feed'; feed.append(video);
  const label = doc.createElement('span'); label.textContent = t('Camera');
  const resize = doc.createElement('button'); resize.type = 'button'; resize.className = 'pr-framing-resize'; resize.setAttribute('aria-label', t('Resize camera'));
  camera.append(feed, label, resize); root.append(content, camera); host.append(root);
  const hint = doc.createElement('p'); hint.textContent = t('Drag to position. Use the corner to resize. Arrow keys move by 1 pixel; Shift moves by 10.'); host.append(hint);
  let scene = readScene(), disposed = false;
  let drag: { id: number; x: number; y: number; width: number; height: number; box: Placement; resize: boolean } | null = null;
  function commit(box: Placement): void {
    const rounded = { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h) };
    scene = readScene({ ...scene, camera: { ...scene.camera, box: rounded } }); change(scene.camera.box); render();
  }
  function render(): void {
    const boxes = layoutBoxes(scene), box = boxes.camera;
    const place = (el: HTMLElement, value: Placement) => Object.assign(el.style, {
      left: `${value.x / OUTPUT.w * 100}%`, top: `${value.y / OUTPUT.h * 100}%`, width: `${value.w / OUTPUT.w * 100}%`, height: `${value.h / OUTPUT.h * 100}%`,
    });
    place(content, boxes.content); place(camera, box);
    content.hidden = scene.layout === 'camera' || scene.layout === 'holding';
    camera.hidden = scene.layout === 'content' || scene.layout === 'holding';
    camera.setAttribute('aria-disabled', String(scene.layout !== 'inset')); resize.disabled = scene.layout !== 'inset';
    hint.hidden = scene.layout !== 'inset';
    camera.style.borderRadius = `${scene.camera.radius / OUTPUT.w * root.clientWidth}px`;
    const sw = video.videoWidth || 1280, sh = video.videoHeight || 720, crop = cameraCrop(sw, sh, box, scene.camera);
    Object.assign(video.style, { width: `${sw / crop.w * 100}%`, height: `${sh / crop.h * 100}%`, left: `${-crop.x / crop.w * 100}%`, top: `${-crop.y / crop.h * 100}%` });
    feed.style.transform = scene.camera.mirror ? 'scaleX(-1)' : '';
    label.hidden = !!video.srcObject;
  }
  camera.addEventListener('pointerdown', event => {
    if (scene.layout !== 'inset' || event.button !== 0) return;
    const rect = root.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    const resizing = event.target === resize;
    event.preventDefault(); event.stopPropagation(); (resizing ? resize : camera).focus();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, width: rect.width, height: rect.height, box: { ...scene.camera.box }, resize: resizing };
    camera.setPointerCapture(event.pointerId);
  });
  camera.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const dx = (event.clientX - drag.x) * OUTPUT.w / drag.width, dy = (event.clientY - drag.y) * OUTPUT.h / drag.height;
    const box = drag.box;
    commit(drag.resize ? { ...box, w: Math.min(OUTPUT.w - box.x, box.w + dx), h: Math.min(OUTPUT.h - box.y, box.h + dy) }
      : { ...box, x: box.x + dx, y: box.y + dy });
  });
  camera.addEventListener('lostpointercapture', () => { drag = null; });
  camera.addEventListener('pointerup', event => { if (camera.hasPointerCapture(event.pointerId)) camera.releasePointerCapture(event.pointerId); drag = null; });
  camera.addEventListener('keydown', event => {
    if (scene.layout !== 'inset' || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const step = event.shiftKey ? 10 : 1, dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0, box = scene.camera.box;
    commit(event.target === resize ? { ...box, w: Math.min(OUTPUT.w - box.x, box.w + dx), h: Math.min(OUTPUT.h - box.y, box.h + dy) }
      : { ...box, x: box.x + dx, y: box.y + dy });
  });
  video.addEventListener('resize', render);
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(render); observer?.observe(root);
  return {
    update(value: PresentationScene): void { if (!disposed) { scene = readScene(value); render(); } },
    preview(stream: MediaStream | null): void { video.srcObject = stream; if (stream) void video.play().catch(() => {}); render(); },
    dispose(): void { disposed = true; drag = null; observer?.disconnect(); video.srcObject = null; root.remove(); hint.remove(); },
  };
}
