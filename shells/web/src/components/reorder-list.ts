// SPDX-License-Identifier: MPL-2.0
/** Pointer, touch and keyboard ordering for a list with explicit grab handles. */
export function wireReorderList(root: HTMLElement, move: (from: number, to: number) => void, announce: (message: string) => void): () => void {
  let grab: { from: number; to: number; pointer?: number; handle: HTMLElement } | null = null;
  let frame = 0;
  let pointerY = 0;
  let startY = 0;
  let dragging = false;
  const rows = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('[data-reorder-row]')];
  const scrollParent = (): HTMLElement | null => {
    for (let node = root; node; node = node.parentElement!) if (node.scrollHeight > node.clientHeight && /auto|scroll/.test(getComputedStyle(node).overflowY)) return node;
    return null;
  };
  const finish = (cancel = false): void => {
    if (!grab) return;
    const g = grab;
    grab = null;
    cancelAnimationFrame(frame);
    if (g.pointer !== undefined && g.handle.hasPointerCapture(g.pointer)) g.handle.releasePointerCapture(g.pointer);
    for (const row of rows()) row.classList.remove('is-reorder-target');
    g.handle.setAttribute('aria-pressed', 'false');
    if (!cancel && g.from !== g.to) { move(g.from, g.to); rows()[g.to]?.querySelector<HTMLElement>('[data-reorder-handle]')?.focus(); }
    announce(cancel ? 'Move cancelled.' : `Input ${g.to + 1} of ${rows().length}.`);
  };
  const mark = (): void => { rows().forEach((r, i) => { r.classList.toggle('is-reorder-target', grab?.to === i); }); };
  const targetAtPointer = (): void => {
    if (!grab || !dragging) return;
    const list = rows();
    const index = list.findIndex(r => { const rect = r.getBoundingClientRect(); return pointerY < rect.top + rect.height / 2; });
    grab.to = index < 0 ? list.length - 1 : index;
    mark();
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
    if (!handle || e.button !== 0) return;
    const from = rows().indexOf(handle.closest('[data-reorder-row]')!);
    grab = { from, to: from, pointer: e.pointerId, handle };
    pointerY = e.clientY;
    startY = e.clientY; dragging = false;
    handle.setPointerCapture(e.pointerId);
    handle.setAttribute('aria-pressed', 'true');
    e.preventDefault();
    frame = requestAnimationFrame(track);
  };
  const drag = (e: PointerEvent): void => {
    if (grab?.pointer !== e.pointerId) return;
    pointerY = e.clientY;
    if (Math.abs(pointerY - startY) > 4) dragging = true;
  };
  const up = (e: PointerEvent): void => {
    if (grab?.pointer !== e.pointerId) return;
    pointerY = e.clientY; targetAtPointer(); finish();
  };
  const cancel = (): void => finish(true);
  const key = (e: KeyboardEvent): void => {
    const handle = (e.target as Element).closest<HTMLElement>('[data-reorder-handle]');
    if (!handle) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (grab) finish();
      else { const from = rows().indexOf(handle.closest('[data-reorder-row]')!); grab = { from, to: from, handle }; handle.setAttribute('aria-pressed', 'true'); announce('Use the arrow keys to move. Space drops. Escape cancels.'); }
    } else if (grab && ['ArrowUp', 'ArrowDown', 'Escape'].includes(e.key)) {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') finish(true);
      else { grab.to = Math.max(0, Math.min(rows().length - 1, grab.to + (e.key === 'ArrowUp' ? -1 : 1))); mark(); rows()[grab.to]?.scrollIntoView({block:'nearest'}); announce(`Position ${grab.to + 1}.`); }
    }
  };
  root.addEventListener('pointerdown', down); root.addEventListener('pointermove', drag);
  root.addEventListener('pointerup', up); root.addEventListener('pointercancel', cancel); root.addEventListener('keydown', key);
  return () => { cancel(); root.removeEventListener('pointerdown', down); root.removeEventListener('pointermove', drag); root.removeEventListener('pointerup', up); root.removeEventListener('pointercancel', cancel); root.removeEventListener('keydown', key); };
}
