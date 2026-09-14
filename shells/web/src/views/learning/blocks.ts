// SPDX-License-Identifier: MPL-2.0
import type { LearningCtx } from './context.ts';

export function syncBlockSelection(ctx: LearningCtx): void {
  const lesson = ctx.module.lessons.find((l) => l.id === ctx.selected);
  const ids = new Set(lesson?.blocks.map((b) => b.id));
  for (const id of ctx.selectedBlocks) if (!ids.has(id)) ctx.selectedBlocks.delete(id);
  for (const card of ctx.root.querySelectorAll<HTMLElement>('[data-block]')) {
    const selected = ctx.selectedBlocks.has(card.dataset.block!);
    card.dataset.selected = String(selected);
    const check = card.querySelector<HTMLInputElement>('[data-block-select]');
    if (check) check.checked = selected;
  }
  const toolbar = ctx.root.querySelector<HTMLElement>('[data-block-selection]');
  if (toolbar) toolbar.hidden = !ctx.selectedBlocks.size;
  const count = ctx.root.querySelector('[data-block-selection-count]');
  if (count) count.textContent = `${ctx.selectedBlocks.size} selected`;
}

/** Handle-only pointer dragging works with mouse, pen and touch without taking
 * away scrolling or text selection in the editor. No model edits until drop. */
export function mountBlockInteraction(ctx: LearningCtx): () => void {
  const root = ctx.root;
  let drag:
    | {
        ids: string[];
        lessonId: string;
        handle: HTMLElement;
        remaining: HTMLElement[];
        index: number;
        pointerId?: number;
        startX: number;
        startY: number;
        x: number;
        y: number;
        active: boolean;
      }
    | undefined;
  let tick = 0;
  const marker = document.createElement('div');
  marker.className = 'learning-drop-marker';
  marker.setAttribute('aria-hidden', 'true');
  const announce = (message: string) => {
    const status = root.querySelector('[data-block-status]');
    if (status) status.textContent = message;
  };
  const cards = () => [...root.querySelectorAll<HTMLElement>('[data-block]')];
  const select = (id: string, extend = false) => {
    if (!extend) ctx.selectedBlocks.clear();
    ctx.selectedBlocks.add(id);
    syncBlockSelection(ctx);
  };
  const clear = () => {
    cancelAnimationFrame(tick);
    marker.remove();
    for (const card of cards()) delete card.dataset.dragging;
    if (drag) {
      drag.handle.setAttribute('aria-pressed', 'false');
      if (drag.pointerId !== undefined && drag.handle.hasPointerCapture(drag.pointerId))
        drag.handle.releasePointerCapture(drag.pointerId);
    }
    drag = undefined;
  };
  const showPosition = () => {
    if (!drag) return;
    const list = root.querySelector('.learning-content-list')!.getBoundingClientRect();
    const before = drag.remaining[drag.index]?.getBoundingClientRect();
    const last = drag.remaining.at(-1)?.getBoundingClientRect();
    marker.style.left = `${list.left}px`;
    marker.style.width = `${list.width}px`;
    marker.style.top = `${before ? before.top - 7 : last ? last.bottom + 7 : list.top}px`;
    if (!marker.isConnected) document.body.append(marker);
  };
  const positionAtPointer = () => {
    if (!drag) return;
    const at = drag.remaining.findIndex((card) => {
      const box = card.getBoundingClientRect();
      return drag!.y < box.top + box.height / 2;
    });
    drag.index = at < 0 ? drag.remaining.length : at;
    showPosition();
  };
  const scrollFrame = () => {
    if (!drag?.active || drag.pointerId === undefined) return;
    let scroller: HTMLElement | null = drag.handle.parentElement;
    while (
      scroller &&
      !(
        scroller.scrollHeight > scroller.clientHeight &&
        /auto|scroll/.test(getComputedStyle(scroller).overflowY)
      )
    )
      scroller = scroller.parentElement;
    const box = scroller?.getBoundingClientRect();
    const top = Math.max(120, box?.top || 0);
    const bottom = Math.min(innerHeight, box?.bottom || innerHeight);
    const speed =
      drag.y < top + 64
        ? -Math.min(18, (top + 64 - drag.y) / 4)
        : drag.y > bottom - 64
          ? Math.min(18, (drag.y - bottom + 64) / 4)
          : 0;
    if (speed) {
      if (scroller) scroller.scrollTop += speed;
      else window.scrollBy(0, speed);
      positionAtPointer();
    }
    tick = requestAnimationFrame(scrollFrame);
  };
  const begin = (handle: HTMLElement, event?: PointerEvent) => {
    const id = handle.closest<HTMLElement>('[data-block]')!.dataset.block!;
    if (!ctx.selectedBlocks.has(id)) select(id);
    const all = cards();
    const remaining = all.filter((c) => !ctx.selectedBlocks.has(c.dataset.block!));
    drag = {
      ids: all.filter((c) => ctx.selectedBlocks.has(c.dataset.block!)).map((c) => c.dataset.block!),
      lessonId: ctx.selected,
      handle,
      remaining,
      index: all
        .slice(
          0,
          all.findIndex((c) => c.dataset.block === id)
        )
        .filter((c) => !ctx.selectedBlocks.has(c.dataset.block!)).length,
      pointerId: event?.pointerId,
      startX: event?.clientX || 0,
      startY: event?.clientY || 0,
      x: event?.clientX || 0,
      y: event?.clientY || 0,
      active: !event,
    };
    if (event) handle.setPointerCapture(event.pointerId);
    else activate();
  };
  const activate = () => {
    if (!drag) return;
    drag.active = true;
    drag.handle.setAttribute('aria-pressed', 'true');
    for (const card of cards())
      if (drag.ids.includes(card.dataset.block!)) card.dataset.dragging = 'true';
    announce(
      `Moving ${drag.ids.length} ${drag.ids.length === 1 ? 'block' : 'blocks'}. Choose a position; Escape cancels.`
    );
    showPosition();
    tick = requestAnimationFrame(scrollFrame);
  };
  const drop = async () => {
    if (!drag) return;
    const { ids, remaining, index, lessonId, active } = drag;
    const beforeId = remaining[index]?.dataset.block;
    clear();
    if (!active) return;
    await ctx.flushTyping();
    if (ctx.disposed || ctx.busy || ctx.selected !== lessonId) return;
    const lesson = ctx.module.lessons.find((l) => l.id === lessonId)!;
    const moving = lesson.blocks.filter((b) => ids.includes(b.id));
    const rest = lesson.blocks.filter((b) => !ids.includes(b.id));
    const at = beforeId ? rest.findIndex((b) => b.id === beforeId) : rest.length;
    if (at < 0) return;
    const next = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
    if (next.some((b, i) => b !== lesson.blocks[i])) {
      lesson.blocks = next;
      ctx.edit.change();
    }
    ctx.ui.render(`[data-block="${CSS.escape(ids[0]!)}"] [data-block-drag]`);
    announce(
      `${moving.length === 1 ? 'Block' : `${moving.length} blocks`} moved to position ${at + 1} of ${next.length}.`
    );
  };
  const onPointerDown = (event: PointerEvent) => {
    const handle = (event.target as Element).closest<HTMLElement>('[data-block-drag]');
    if (!handle || ctx.busy || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    clear();
    handle.focus({ preventScroll: true });
    begin(handle, event);
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (!drag.active && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 6) return;
    event.preventDefault();
    if (!drag.active) activate();
    positionAtPointer();
  };
  const onPointerUp = (event: PointerEvent) => {
    if (drag?.pointerId === event.pointerId) void drop().catch((e) => ctx.ui.status(String(e)));
  };
  const cancel = () => {
    if (drag) {
      clear();
      announce('Move cancelled. Content order is unchanged.');
    }
  };
  const onKey = (event: KeyboardEvent) => {
    const handle = (event.target as Element).closest<HTMLElement>('[data-block-drag]');
    if (event.key === 'Escape' && drag) {
      event.preventDefault();
      event.stopPropagation();
      cancel();
      return;
    }
    if (!handle || ctx.busy) return;
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      if (drag) void drop().catch((e) => ctx.ui.status(String(e)));
      else begin(handle);
    } else if (drag && ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      drag.index =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? drag.remaining.length
            : Math.max(
                0,
                Math.min(drag.remaining.length, drag.index + (event.key === 'ArrowUp' ? -1 : 1))
              );
      drag.remaining[Math.min(drag.index, drag.remaining.length - 1)]?.scrollIntoView({
        block: 'nearest',
      });
      showPosition();
      announce(`Position ${drag.index + 1}. Space or Enter places the selection; Escape cancels.`);
    }
  };
  const onSelect = (event: Event) => {
    if (ctx.busy || drag) return;
    const target = event.target as HTMLElement;
    const card = target.closest<HTMLElement>('[data-block]');
    if (!card) return;
    const id = card.dataset.block!;
    if (target instanceof HTMLInputElement && target.matches('[data-block-select]')) {
      if (event.type !== 'change') return;
      if (target.checked) ctx.selectedBlocks.add(id);
      else ctx.selectedBlocks.delete(id);
      syncBlockSelection(ctx);
    } else if (!target.closest('[data-block-tools]') && !ctx.selectedBlocks.has(id)) select(id);
  };
  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerUp);
  root.addEventListener('pointercancel', cancel);
  root.addEventListener('lostpointercapture', cancel);
  root.addEventListener('keydown', onKey);
  root.addEventListener('click', onSelect);
  root.addEventListener('focusin', onSelect);
  root.addEventListener('change', onSelect);
  return () => {
    clear();
    root.removeEventListener('pointerdown', onPointerDown);
    root.removeEventListener('pointermove', onPointerMove);
    root.removeEventListener('pointerup', onPointerUp);
    root.removeEventListener('pointercancel', cancel);
    root.removeEventListener('lostpointercapture', cancel);
    root.removeEventListener('keydown', onKey);
    root.removeEventListener('click', onSelect);
    root.removeEventListener('focusin', onSelect);
    root.removeEventListener('change', onSelect);
  };
}
