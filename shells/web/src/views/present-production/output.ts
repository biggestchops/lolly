// SPDX-License-Identifier: MPL-2.0
import { cameraCrop, layoutBoxes, OUTPUT, type Placement, type PresentationScene } from './scene.ts';

/** DOM output preserves the existing player's SVG, text, video and animation renderers. */
export function mountProductionOutput(stage: HTMLElement, frames: HTMLElement) {
  const doc = stage.ownerDocument;
  const surface = doc.createElement('div'); surface.className = 'pr-program';
  surface.inert = true;
  const content = doc.createElement('div'); content.className = 'pr-program-content';
  content.append(frames);
  const cameraBox = doc.createElement('div'); cameraBox.className = 'pr-program-camera';
  const video = doc.createElement('video'); video.muted = true; video.playsInline = true; video.autoplay = true;
  cameraBox.append(video);
  const logo = doc.createElement('img'); logo.className = 'pr-program-logo'; logo.alt = '';
  const lower = doc.createElement('div'); lower.className = 'pr-program-lower';
  const title = doc.createElement('strong'), subtitle = doc.createElement('span'); lower.append(title, subtitle);
  const holding = doc.createElement('div'); holding.className = 'pr-program-holding';
  surface.append(content, cameraBox, logo, lower, holding); stage.append(surface);
  stage.classList.add('pr-production');
  let current: PresentationScene;
  let ready = false;
  let held = false;
  const place = (el: HTMLElement, r: Placement) => {
    Object.assign(el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
  };
  function fit(): void {
    const scale = Math.min(window.innerWidth / OUTPUT.w, window.innerHeight / OUTPUT.h);
    surface.style.transform = `translate(-50%, -50%) scale(${scale})`;
  }
  function render(): void {
    if (!current) return;
    const { content: cb, camera: vb } = layoutBoxes(current);
    place(content, cb); place(cameraBox, vb);
    content.hidden = current.layout === 'camera' || current.layout === 'holding' || held;
    cameraBox.hidden = !ready || current.layout === 'content' || current.layout === 'holding' || held;
    holding.hidden = current.layout !== 'holding' && !held;
    const sw = video.videoWidth || 1280, sh = video.videoHeight || 720;
    const crop = cameraCrop(sw, sh, vb, current.camera), scale = vb.w / crop.w;
    Object.assign(video.style, { width: `${sw * scale}px`, height: `${sh * scale}px`, left: `${-crop.x * scale}px`, top: `${-crop.y * scale}px` });
    cameraBox.style.transform = current.camera.mirror ? 'scaleX(-1)' : '';
    cameraBox.style.borderRadius = `${current.layout === 'camera' ? 0 : current.camera.radius}px`;
    cameraBox.style.boxShadow = current.camera.border ? `0 0 0 ${current.camera.border}px #fff` : '';
    logo.style.width = `${current.logo.width}px`; logo.style.left = current.logo.anchor === 'left' ? '32px' : '';
    logo.style.right = current.logo.anchor === 'right' ? '32px' : '';
    title.textContent = current.lower.title; subtitle.textContent = current.lower.subtitle;
    lower.hidden = held || current.layout === 'holding';
  }
  video.addEventListener('resize', render);
  window.addEventListener('resize', fit); fit();
  return {
    surface, video,
    update(scene: PresentationScene): void { current = scene; render(); },
    cameraReady(on: boolean): void { ready = on; render(); },
    hold(on: boolean): void { held = on; render(); },
    logo(url: string | null): void { logo.hidden = !url; if (url) logo.src = url; else logo.removeAttribute('src'); },
    cue(on: boolean): void { lower.classList.toggle('pr-program-lower-on', on); },
    dispose(): void { window.removeEventListener('resize', fit); video.removeEventListener('resize', render); surface.remove(); },
  };
}
