// SPDX-License-Identifier: MPL-2.0
import type { DesignToolDraftV1 } from '@lolly-tools/core/design-tool-v1';
import type { DesignCanvasPorts } from './design-ports.ts';
import { mountModal } from '../components/modal.ts';
import { t } from '../i18n.ts';

/** Select artwork without exposing the geometry editing layer. */
export function mountRulesSelection(opts: {canvas: HTMLElement; stage: HTMLElement; ports: DesignCanvasPorts; active(): boolean; draft(): DesignToolDraftV1 | undefined}) {
  let show = true;
  let hover: HTMLElement | undefined;
  let cycle = 0;
  let lastPoint = '';
  let drag: {x: number; y: number; pointer: number; prior: string[]} | undefined;
  const marquee = document.createElement('div'); marquee.className = 'dr-marquee'; marquee.hidden = true; document.body.append(marquee);
  const selectable = (id: string): boolean => { const box=opts.ports.model.getBoxes().find(b=>b.id===id);return Boolean(box&&box.kind!=='frame'&&!box.hidden); };
  const eligible = (id: string): boolean => {
    const box = opts.ports.model.getBoxes().find(b => b.id === id);
    return Boolean(box && box.kind !== 'frame' && !box.hidden && (box.kind === 'text' || box.text || box.image));
  };
  const paint = (): void => {
    const linked = new Set([...(opts.draft()?.inputs.flatMap(f => f.targets.map(target => target.layerId)) || []),...(opts.draft()?.recipes.map(r=>r.target.layerId)||[])]);
    for (const el of opts.canvas.querySelectorAll<HTMLElement>('[data-box-id]')) el.classList.toggle('dr-editable-area', opts.active() && show && linked.has(el.dataset.boxId!));
  };
  const pick = (event: PointerEvent): void => {
    if (!opts.active() || event.button !== 0 || opts.stage.classList.contains('is-grabbable')) return;
    const hits = document.elementsFromPoint(event.clientX, event.clientY).map(el => el.closest<HTMLElement>('[data-box-id]')).filter((el): el is HTMLElement => Boolean(el && opts.canvas.contains(el) && selectable(el.dataset.boxId!)));
    const ids = [...new Set(hits.map(el => el.dataset.boxId!))];
    const point = `${Math.round(event.clientX / 4)},${Math.round(event.clientY / 4)}`;
    cycle = event.altKey && point === lastPoint ? (cycle + 1) % Math.max(1, ids.length) : 0; lastPoint = point;
    if (ids.length) {
      const id = ids[cycle]!; const boxes = opts.ports.model.getBoxes(); const box = boxes.find(b => b.id === id);
      const members = !event.altKey && box?.group ? boxes.filter(b => b.group === box.group && selectable(String(b.id))).map(b => String(b.id)) : [id];
      const prior = opts.ports.selection.get();
      opts.ports.selection.set(event.shiftKey ? members.every(id => prior.includes(id)) ? prior.filter(id => !members.includes(id)) : [...new Set([...prior, ...members])] : members);
    } else {
      drag = {x:event.clientX, y:event.clientY, pointer:event.pointerId, prior:event.shiftKey ? opts.ports.selection.get() : []};
      opts.ports.selection.set(drag.prior); opts.canvas.setPointerCapture(event.pointerId);
    }
    event.preventDefault(); event.stopImmediatePropagation();
  };
  const move = (event: PointerEvent): void => {
    if (!opts.active()) return;
    if (!drag) {
      hover?.classList.remove('dr-hover');
      const next = (event.target as Element).closest<HTMLElement>('[data-box-id]');
      hover = next && selectable(next.dataset.boxId!) ? next : undefined; hover?.classList.add('dr-hover'); return;
    }
    const left = Math.min(drag.x, event.clientX), top = Math.min(drag.y, event.clientY);
    const width = Math.abs(drag.x-event.clientX), height = Math.abs(drag.y-event.clientY);
    marquee.hidden = width + height < 6;
    Object.assign(marquee.style,{left:`${left}px`,top:`${top}px`,width:`${width}px`,height:`${height}px`});
    const selected = [...opts.canvas.querySelectorAll<HTMLElement>('[data-box-id]')].filter(el => {
      if (!selectable(el.dataset.boxId!)) return false;
      const rect = el.getBoundingClientRect();
      return rect.width && rect.height && rect.left < left+width && rect.right > left && rect.top < top+height && rect.bottom > top;
    }).map(el => el.dataset.boxId!);
    opts.ports.selection.set([...new Set([...drag.prior,...selected])]);
    event.preventDefault(); event.stopImmediatePropagation();
  };
  const end = (event: PointerEvent): void => {
    if (!drag) return;
    if (event.type === 'pointercancel') opts.ports.selection.set(drag.prior);
    if (opts.canvas.hasPointerCapture(drag.pointer)) opts.canvas.releasePointerCapture(drag.pointer);
    drag = undefined; marquee.hidden = true;
  };
  const find = (): void => {
    const modal = mountModal('', {className:'modal dr-share',ariaLabel:t('Find editable content')});
    const heading = document.createElement('h2'); heading.textContent = t('Find editable content');
    const search = document.createElement('input'); search.className = 'field-input'; search.type = 'search'; search.placeholder = t('Find by text, layer or artboard'); search.setAttribute('aria-label',search.placeholder);
    const rows = document.createElement('div'); rows.className = 'dr-find-results';
    const paintRows = (): void => {
      rows.replaceChildren(); const query = search.value.toLowerCase(); const boxes = opts.ports.model.getBoxes();
      for (const box of boxes.filter(b => eligible(String(b.id)))) {
        const frame = boxes.find(b => b.id === box.frame);
        const label = `${frame?.name || t('Artboard')} · ${box.name || box.text || t('Image')}`;
        if (!label.toLowerCase().includes(query)) continue;
        const button = document.createElement('button'); button.className = 'btn btn--ghost'; button.textContent = label;
        button.addEventListener('click', () => { opts.ports.selection.set([String(box.id)]); if (box.frame) opts.ports.artboard.focus(String(box.frame)); modal.close(); }); rows.append(button);
      }
      if (!rows.childElementCount) rows.textContent = t('No matching text or images.');
    };
    search.addEventListener('input',paintRows); modal.el.append(heading,search,rows); paintRows(); search.focus();
  };
  const help = (): void => {
    const modal = mountModal('', {className:'modal dr-share',ariaLabel:t('Rules shortcuts')});
    const h = document.createElement('h2'); h.textContent = t('Rules shortcuts'); const dl = document.createElement('dl'); dl.className = 'dr-shortcuts';
    for (const [key, text] of [['Shift E','Make selection editable'],['Shift P','Switch Rules and Preview'],['Shift H','Show editable areas'],['⌘ / Ctrl F','Find text or images'],['Alt click','Select inside a group or overlapping artwork'],['Shift click / drag','Add to selection'],['F2','Rename the focused input'],['⌘ / Ctrl Z','Undo in the current mode'],['Escape','Clear selection or return to Rules']]) {
      const dt=document.createElement('dt');dt.textContent=key!;const dd=document.createElement('dd');dd.textContent=t(text!);dl.append(dt,dd);
    }
    modal.el.append(h,dl);
  };
  opts.canvas.addEventListener('pointerdown',pick,true); opts.canvas.addEventListener('pointermove',move,true);
  opts.canvas.addEventListener('pointerup',end,true); opts.canvas.addEventListener('pointercancel',end,true);
  const observer = new MutationObserver(paint); observer.observe(opts.canvas,{childList:true,subtree:true});
  return {paint,find,help,toggle() {show=!show;paint();return show;}, destroy() {observer.disconnect(); marquee.remove(); hover?.classList.remove('dr-hover'); opts.canvas.removeEventListener('pointerdown',pick,true);opts.canvas.removeEventListener('pointermove',move,true);opts.canvas.removeEventListener('pointerup',end,true);opts.canvas.removeEventListener('pointercancel',end,true);}};
}
