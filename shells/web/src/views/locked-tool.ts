// SPDX-License-Identifier: MPL-2.0
import type { HostV1 } from '@lolly-tools/core/host-v1';
import type { Runtime } from '../../../../engine/src/runtime.ts';
import type { DesignToolPolicyV1 } from '@lolly-tools/core/design-tool-v1';
import { checkTextLayout } from '../lib/text-layout-check.ts';
import { announce } from '../a11y.ts';
import { t } from '../i18n.ts';
import '../styles/parts/locked-tool.css';

/** Presentation only. The engine owns the editable fields and output rules. */
export function mountLockedTool(opts: { view: HTMLElement; canvas: HTMLElement; sidebar: HTMLElement; stage: HTMLElement; runtime: Runtime; host: HostV1; policy: DesignToolPolicyV1 }): () => void {
  const { view, canvas, sidebar, stage, policy } = opts;
  const trigger = document.createElement('button');
  trigger.type = 'button'; trigger.className = 'btn btn--glass locked-edit-inputs';
  trigger.textContent = t('Edit inputs');
  trigger.setAttribute('aria-controls', sidebar.id);
  const onCanvas = policy.presentation === 'on-canvas';
  view.classList.add('is-locked-tool');
  view.classList.toggle('locked-on-canvas', onCanvas);
  stage.append(trigger); trigger.hidden = !onCanvas;
  const feedback=document.createElement('p');feedback.className='locked-fit-feedback';feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');stage.append(feedback);
  const toggle = (): void => {
    const open = !view.classList.contains('locked-inputs-open');
    view.classList.toggle('locked-inputs-open', open); trigger.setAttribute('aria-expanded', String(open));
    if (open) sidebar.querySelector<HTMLElement>('input,textarea,select,button')?.focus();
  };
  const click = (event: MouseEvent): void => {
    const id = (event.target as Element).closest<HTMLElement>('[data-public-input]')?.dataset.publicInput;
    if (!id) return;
    view.classList.add('locked-inputs-open'); trigger.setAttribute('aria-expanded', 'true');
    sidebar.querySelector<HTMLElement>(`[data-input="${CSS.escape(id)}"] input, [data-input="${CSS.escape(id)}"] textarea, [data-input="${CSS.escape(id)}"] select, [data-input-id="${CSS.escape(id)}"]`)?.focus();
  };
  const key = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && onCanvas && view.classList.contains('locked-inputs-open') && !document.querySelector('dialog[open]')) {
      event.preventDefault(); event.stopPropagation(); view.classList.remove('locked-inputs-open'); trigger.setAttribute('aria-expanded', 'false'); trigger.focus();
    }
  };
  trigger.addEventListener('click', toggle); canvas.addEventListener('click', click); view.addEventListener('keydown', key);
  const measure = (): void => { const at=canvas.lastElementChild; void checkTextLayout(canvas, opts.host.text).then(result => { if (!canvas.isConnected || at!==canvas.lastElementChild) return; const sizes=[...canvas.querySelectorAll<HTMLElement>('[data-effective-size]')].filter(el=>Number(el.dataset.effectiveSize)<Number(el.dataset.requestedSize)-.1).map(el=>`${policy.inputs.find(f=>f.input.id===el.dataset.publicInput)?.input.label || t('Text')}: ${Number(el.dataset.requestedSize).toFixed(0)} → ${Number(el.dataset.effectiveSize).toFixed(1)} px`);feedback.textContent=result.ok?sizes.join(' · '):result.issues[0]!; }).catch(err => { if (canvas.isConnected) announce(String(err.message)); }); };
  const observer = new MutationObserver(measure);
  observer.observe(canvas, { childList: true, subtree: true });
  measure();
  return () => { observer.disconnect(); trigger.remove(); feedback.remove(); canvas.removeEventListener('click', click); view.removeEventListener('keydown', key); view.classList.remove('is-locked-tool', 'locked-on-canvas', 'locked-inputs-open'); };
}
