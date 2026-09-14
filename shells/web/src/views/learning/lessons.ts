// SPDX-License-Identifier: MPL-2.0
import type { LearningCtx } from './context.ts';

export function mountLessonInteraction(ctx: LearningCtx): () => void {
  let drag:
    | {
        id: string;
        index: number;
        handle: HTMLElement;
        pointer?: number;
        y: number;
        active: boolean;
      }
    | undefined;
  const root = ctx.root;
  const rows = () => [...root.querySelectorAll<HTMLElement>('[data-lesson-row]')];
  const clear = () => {
    const old = drag;
    drag = undefined;
    for (const row of rows()) {
      delete row.dataset.lessonDrop;
      delete row.dataset.dragging;
    }
    if (old) {
      old.handle.setAttribute('aria-pressed', 'false');
      if (old.pointer !== undefined && old.handle.hasPointerCapture(old.pointer))
        old.handle.releasePointerCapture(old.pointer);
    }
  };
  const show = () => {
    if (!drag) return;
    for (const row of rows()) delete row.dataset.lessonDrop;
    const rest = rows().filter((row) => row.dataset.lessonRow !== drag!.id);
    const row = rest[Math.min(drag.index, rest.length - 1)];
    if (row) row.dataset.lessonDrop = drag.index < rest.length ? 'before' : 'after';
    const own = rows().find((r) => r.dataset.lessonRow === drag!.id);
    if (own) own.dataset.dragging = 'true';
    drag.handle.setAttribute('aria-pressed', 'true');
  };
  const drop = async () => {
    const old = drag;
    clear();
    if (!old?.active) return;
    await ctx.flushTyping();
    if (ctx.disposed || ctx.busy) return;
    const from = ctx.module.lessons.findIndex((l) => l.id === old.id);
    if (from < 0 || from === old.index) return;
    const lesson = ctx.module.lessons.splice(from, 1)[0]!;
    ctx.module.lessons.splice(old.index, 0, lesson);
    ctx.edit.change();
    ctx.ui.render(`[data-lesson-drag="${CSS.escape(old.id)}"]`);
    ctx.ui.status(`Lesson moved to position ${old.index + 1}.`);
  };
  const down = (event: PointerEvent) => {
    const handle = (event.target as Element).closest<HTMLElement>('[data-lesson-drag]');
    if (!handle || ctx.busy || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    clear();
    handle.focus({ preventScroll: true });
    drag = {
      id: handle.dataset.lessonDrag!,
      handle,
      index: 0,
      pointer: event.pointerId,
      y: event.clientY,
      active: false,
    };
    handle.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent) => {
    if (!drag || drag.pointer !== event.pointerId) return;
    if (!drag.active && Math.abs(event.clientY - drag.y) < 6) return;
    event.preventDefault();
    drag.active = true;
    const list = root.querySelector<HTMLElement>('.learning-lesson-list');
    const box = list?.getBoundingClientRect();
    if (list && box)
      list.scrollTop +=
        event.clientY < box.top + 40 ? -16 : event.clientY > box.bottom - 40 ? 16 : 0;
    const rest = rows().filter((row) => row.dataset.lessonRow !== drag!.id);
    const index = rest.findIndex((row) => {
      const r = row.getBoundingClientRect();
      return event.clientY < r.top + r.height / 2;
    });
    drag.index = index < 0 ? rest.length : index;
    show();
  };
  const up = (event: PointerEvent) => {
    if (drag?.pointer === event.pointerId) void drop().catch((e) => ctx.ui.status(String(e)));
  };
  const key = (event: KeyboardEvent) => {
    const handle = (event.target as Element).closest<HTMLElement>('[data-lesson-drag]');
    if (!handle || ctx.busy) return;
    if (event.key === 'Escape' && drag) {
      event.preventDefault();
      event.stopPropagation();
      clear();
      ctx.ui.status('Lesson move cancelled.');
    } else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      if (drag) void drop().catch((e) => ctx.ui.status(String(e)));
      else {
        drag = {
          id: handle.dataset.lessonDrag!,
          handle,
          index: ctx.module.lessons.findIndex((l) => l.id === handle.dataset.lessonDrag),
          active: true,
          y: 0,
        };
        show();
        ctx.ui.status('Use arrow keys to move the lesson. Space places it; Escape cancels.');
      }
    } else if (drag && ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      drag.index =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? ctx.module.lessons.length - 1
            : Math.max(
                0,
                Math.min(
                  ctx.module.lessons.length - 1,
                  drag.index + (event.key === 'ArrowUp' ? -1 : 1)
                )
              );
      show();
      rows()[drag.index]?.scrollIntoView({ block: 'nearest' });
      ctx.ui.status(`Position ${drag.index + 1}. Space places the lesson.`);
    }
  };
  root.addEventListener('pointerdown', down);
  root.addEventListener('pointermove', move);
  root.addEventListener('pointerup', up);
  root.addEventListener('pointercancel', clear);
  root.addEventListener('keydown', key);
  return () => {
    clear();
    root.removeEventListener('pointerdown', down);
    root.removeEventListener('pointermove', move);
    root.removeEventListener('pointerup', up);
    root.removeEventListener('pointercancel', clear);
    root.removeEventListener('keydown', key);
  };
}
