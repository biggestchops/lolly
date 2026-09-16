// SPDX-License-Identifier: MPL-2.0
import { t } from '../../i18n.ts';
import type { PresentationContent } from './source.ts';

/** Explicit adapter for Countdown's existing running instance. No template scripts are cloned. */
export function countdownPresentation(scope: HTMLElement): PresentationContent | null {
  const source = scope.querySelector<HTMLElement>('.ct-root');
  const originalRing = source?.querySelector<SVGCircleElement>('.ct-ring');
  if (!source || !originalRing) return null;
  const subscribers = new Set<() => void>();
  let observer: MutationObserver | null = null;
  const previousInert = source.inert;
  const state = () => source.dataset.state ?? 'set';
  const text = () => source.querySelector('.ct-time')?.textContent ?? source.querySelector<HTMLInputElement>('.ct-input')?.value ?? '5:00';
  const click = (selector: string) => source.querySelector<HTMLElement>(selector)?.click();
  const subscribe = (update: () => void): (() => void) => {
    subscribers.add(update);
    if (!observer) {
      source.inert = true;
      observer = new MutationObserver(() => { for (const paint of subscribers) paint(); });
      observer.observe(source, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-state', 'stroke-dashoffset', 'style'] });
    }
    update();
    return () => { subscribers.delete(update); if (!subscribers.size) { observer?.disconnect(); observer = null; source.inert = previousInert; } };
  };
  return {
    id: 'countdown-timer',
    mount(host): () => void {
      const doc = host.ownerDocument, root = doc.createElement('div'); root.className = 'pr-countdown';
      const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 200 200'); svg.setAttribute('aria-hidden', 'true');
      const track = doc.createElementNS(svg.namespaceURI, 'circle');
      for (const [key, value] of Object.entries({ cx: '100', cy: '100', r: '80', fill: 'none', 'stroke-width': '10' })) track.setAttribute(key, value);
      track.setAttribute('class', 'pr-countdown-track');
      const ring = track.cloneNode(true) as SVGCircleElement; ring.setAttribute('class', 'pr-countdown-ring');
      ring.setAttribute('stroke-dasharray', originalRing.getAttribute('stroke-dasharray') ?? String(2 * Math.PI * 80));
      svg.append(track, ring);
      const time = doc.createElement('div'); time.className = 'pr-countdown-time';
      root.append(svg, time); host.replaceChildren(root);
      const off = subscribe(() => {
        time.textContent = text(); root.dataset.state = state();
        ring.setAttribute('stroke-dashoffset', originalRing.getAttribute('stroke-dashoffset') ?? '0');
      });
      return () => { off(); root.remove(); };
    },
    controls(host): () => void {
      const doc = host.ownerDocument, root = doc.createElement('div'); root.className = 'pr-countdown-controls';
      const label = doc.createElement('label'); label.textContent = t('Countdown');
      const duration = doc.createElement('input'); duration.type = 'text'; duration.value = text(); duration.maxLength = 5;
      duration.setAttribute('aria-label', t('Countdown duration')); label.append(duration);
      const toggle = doc.createElement('button'); toggle.type = 'button'; toggle.className = 'btn btn--ghost';
      const reset = doc.createElement('button'); reset.type = 'button'; reset.className = 'btn btn--ghost'; reset.textContent = t('Reset timer');
      toggle.addEventListener('click', () => {
        if (state() === 'running') click('#ct-canvas');
        else if (state() === 'paused') click('#ct-resume-btn');
        else {
          if (state() === 'done') click('#ct-again-btn');
          const input = source.querySelector<HTMLInputElement>('.ct-input');
          if (input) input.value = duration.value;
          click('#ct-start-btn');
        }
      });
      reset.addEventListener('click', () => {
        if (state() === 'running') click('#ct-canvas');
        click(state() === 'done' ? '#ct-again-btn' : '#ct-reset-btn');
      });
      root.append(label, toggle, reset); host.append(root);
      const off = subscribe(() => {
        const s = state(); duration.disabled = s === 'running' || s === 'paused';
        toggle.textContent = s === 'running' ? t('Pause timer') : s === 'paused' ? t('Resume timer') : t('Start timer');
        reset.disabled = s === 'set';
      });
      return () => { off(); root.remove(); };
    },
    pause(): void { if (state() === 'running') click('#ct-canvas'); },
  };
}
