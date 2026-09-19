// SPDX-License-Identifier: MPL-2.0
export interface ReorderOptions {
  layout?: 'list' | 'grid';
  instructions?: string;
  cancelled?: string;
  position?(index: number, count: number): string;
}

/** Pointer, touch and keyboard ordering for a list with explicit grab handles. */
export function wireReorderList(root: HTMLElement, move: (from: number, to: number) => void, announce: (message: string) => void, options: ReorderOptions = {}): () => void {
  let grab: { from: number; to: number; pointer?: number; handle: HTMLElement } | null = null;
  let frame = 0;
  let pointerY = 0;
  let pointerX = 0;
  let startX = 0;
  let startY = 0;
  let dragging = false;
  const rows = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('[data-reorder-row]')];
  const scrollParent = (): HTMLElement | null => {
    for (let node = root; node; node = node.parentElement!) if (node.scrollHeight > node.clientHeight && /auto|scroll/.test(getComputedStyle(node).overflowY)) return node;
    return null;
  };
  const position = (index: number): string => options.position?.(index, rows().length) ?? `Input ${index + 1} of ${rows().length}.`;
  const finish = (cancel = false): void => {
    if (!grab) return;
    const g = grab;
    grab = null;
    cancelAnimationFrame(frame);
    if (g.pointer !== undefined && g.handle.hasPointerCapture(g.pointer)) g.handle.releasePointerCapture(g.pointer);
    for (const row of rows()) row.classList.remove('is-reorder-target');
    g.handle.setAttribute('aria-pressed', 'false');
    if (!cancel && g.from !== g.to) { move(g.from, g.to); rows()[g.to]?.querySelector<HTMLElement>('[data-reorder-handle]')?.focus(); }
    announce(cancel ? options.cancelled ?? 'Move cancelled.' : position(g.to));
  };
  const mark = (): void => { rows().forEach((r, i) => { r.classList.toggle('is-reorder-target', grab?.to === i); }); };
  const targetAtPointer = (): void => {
    if (!grab || !dragging) return;
    const list = rows();
    let index = list.findIndex(r => { const rect = r.getBoundingClientRect(); return pointerY < rect.top + rect.height / 2; });
    if (options.layout === 'grid') {
      let nearest = Infinity;
      list.forEach((row, i) => {
        const rect = row.getBoundingClientRect();
        const distance = Math.hypot(pointerX - rect.left - rect.width / 2, pointerY - rect.top - rect.height / 2);
        if (distance < nearest) { nearest = distance; index = i; }
      });
    }
    const next = index < 0 ? list.length - 1 : index;
    if (grab.to !== next) { grab.to = next; mark(); }
  };
  const track = (): void => {
    if (!grab || grab.pointer === undefined) return;
    if (!dragging) { frame = requestAnimationFrame(track); return; }
    const parent = scrollParent();
    if (parent) {
      const rect = parent.getBoundingClientRect();
      const direction = pointerY < rect.top + 40 ? -1 : pointerY > rect.bottom - 40 ? 1 : 0;
      if (direction) parent.scrollTop += direction * 8;
    }
    targetAtPointer(); frame = requestAnimationFrame(track);
  };
  const down = (e: PointerEvent): void => {
    const handle = (e.target as Element).closest<HTMLElement>('[data-reorder-handle]');
    if (!handle || e.button !== 0 || grab) return;
    const from = rows().indexOf(handle.closest('[data-reorder-row]')!);
    if (from < 0) return;
    grab = { from, to: from, pointer: e.pointerId, handle };
    pointerY = e.clientY;
    startY = e.clientY; pointerX = startX = e.clientX; dragging = false;
    handle.setPointerCapture(e.pointerId);
    handle.setAttribute('aria-pressed', 'true');
    e.preventDefault(); handle.focus();
    frame = requestAnimationFrame(track);
  };
  const drag = (e: PointerEvent): void => {
    if (grab?.pointer !== e.pointerId) return;
    pointerY = e.clientY; pointerX = e.clientX;
    if (Math.hypot(pointerY - startY, pointerX - startX) > 4) dragging = true;
  };
  const up = (e: PointerEvent): void => {
    if (grab?.pointer !== e.pointerId) return;
    pointerY = e.clientY; pointerX = e.clientX; targetAtPointer(); finish();
  };
  const cancel = (): void => finish(true);
  const key = (e: KeyboardEvent): void => {
    const handle = (e.target as Element).closest<HTMLElement>('[data-reorder-handle]');
    if (!handle) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault(); e.stopPropagation();
      if (grab) finish();
      else { const from = rows().indexOf(handle.closest('[data-reorder-row]')!); grab = { from, to: from, handle }; handle.setAttribute('aria-pressed', 'true'); announce(options.instructions ?? 'Use the arrow keys to move. Space drops. Escape cancels.'); }
    } else if (grab && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape', 'Tab'].includes(e.key)) {
      if (e.key !== 'Tab') e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape' || e.key === 'Tab') finish(true);
      else {
        const list = rows(), first = list[0]!.getBoundingClientRect();
        const columns = options.layout === 'grid' ? Math.max(1, list.filter(row => Math.abs(row.getBoundingClientRect().top - first.top) < 1).length) : 1;
        const horizontal = (e.key === 'ArrowLeft' ? -1 : 1) * (options.layout === 'grid' && getComputedStyle(root).direction === 'rtl' ? -1 : 1);
        const up = grab.to >= columns ? -columns : 0;
        const down = Math.floor(grab.to / columns) < Math.floor((list.length - 1) / columns) ? columns : 0;
        const step = e.key === 'ArrowUp' ? up : e.key === 'ArrowDown' ? down : horizontal;
        grab.to = Math.max(0, Math.min(list.length - 1, grab.to + step)); mark();
        list[grab.to]?.scrollIntoView({ block: 'nearest' }); announce(position(grab.to));
      }
    }
  };
  const blur = (): void => { if (grab?.pointer === undefined) finish(true); };
  root.addEventListener('focusout', blur);
  root.addEventListener('pointerdown', down); root.addEventListener('pointermove', drag);
  root.addEventListener('lostpointercapture', cancel);
  root.addEventListener('pointerup', up); root.addEventListener('pointercancel', cancel); root.addEventListener('keydown', key);
  return () => { cancel(); root.removeEventListener('focusout', blur); root.removeEventListener('pointerdown', down); root.removeEventListener('pointermove', drag); root.removeEventListener('lostpointercapture', cancel); root.removeEventListener('pointerup', up); root.removeEventListener('pointercancel', cancel); root.removeEventListener('keydown', key); };
}
