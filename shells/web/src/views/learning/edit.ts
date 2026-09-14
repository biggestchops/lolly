// SPDX-License-Identifier: MPL-2.0
import type { LearningCtx } from './context.ts';
import { mountModal } from '../../components/modal.ts';
import { escape as esc } from '../../utils.ts';
import { syncBlockSelection } from './blocks.ts';

export function editOps(ctx: LearningCtx): LearningCtx['edit'] {
  return {
    insert: (block) => {
      const lesson = ctx.module.lessons.find((l) => l.id === ctx.selected);
      if (!lesson) return;
      const after = ctx.insertAfter ? lesson.blocks.findIndex((b) => b.id === ctx.insertAfter) : -1;
      lesson.blocks.splice(after >= 0 ? after + 1 : lesson.blocks.length, 0, block);
      if (ctx.insertAfter) ctx.insertAfter = block.id;
    },
    moveBlocks: (lessonId) => {
      const from = ctx.module.lessons.find((l) => l.id === ctx.selected);
      const to = ctx.module.lessons.find((l) => l.id === lessonId);
      if (!from || !to || from === to) return;
      const moving = from.blocks.filter((b) => ctx.selectedBlocks.has(b.id));
      if (!moving.length) return;
      from.blocks = from.blocks.filter((b) => !ctx.selectedBlocks.has(b.id));
      to.blocks.push(...moving);
      ctx.selected = to.id;
      change(ctx);
      ctx.ui.render(`[data-block="${CSS.escape(moving[0]!.id)}"] [data-block-drag]`);
      ctx.ui.status(
        `${moving.length} ${moving.length === 1 ? 'item' : 'items'} moved to ${to.title}.`
      );
    },
    change: () => change(ctx),
    addLesson: () => addLesson(ctx),
    action: (action, id) => act(ctx, action, id),
  };
}
export function change(ctx: LearningCtx): void {
  ctx.undo.push(ctx.lastEdit);
  if (ctx.undo.length > 50) ctx.undo.shift();
  ctx.lastEdit = structuredClone(ctx.module);
  ctx.dirty = true;
  ctx.preview = null;
  ctx.delivery.invalidate();
  void ctx.persistence.save().catch(() => {});
}
export function addLesson(ctx: LearningCtx): void {
  const lesson = {
    id: crypto.randomUUID(),
    title: `Lesson ${ctx.module.lessons.length + 1}`,
    required: true,
    blocks: [],
  };
  ctx.module.lessons.push(lesson);
  ctx.selected = lesson.id;
  ctx.selectedBlocks.clear();
  change(ctx);
  ctx.ui.render('[data-lesson="title"]');
}
export async function act(ctx: LearningCtx, action: string, id?: string): Promise<void> {
  if (ctx.busy) return;
  const lesson = ctx.module.lessons.find((l) => l.id === ctx.selected);
  const index = ctx.module.lessons.findIndex((l) => l.id === ctx.selected);
  const blockIndex = lesson?.blocks.findIndex((b) => b.id === id) ?? -1;
  if (ctx.quizzes.action(action, id)) return;
  if (action === 'undo') {
    const previous = ctx.undo.pop();
    if (previous) {
      ctx.busy = true;
      ctx.ui.checks();
      try {
        ctx.delivery.invalidate();
        ctx.module = previous;
        ctx.lastEdit = structuredClone(previous);
        ctx.dirty = true;
        ctx.selected =
          ctx.module.lessons.find((l) => l.id === ctx.selected)?.id ||
          ctx.module.lessons[0]?.id ||
          '';
        await ctx.persistence.save();
        await ctx.sources.inspect();
      } finally {
        ctx.busy = false;
        if (!ctx.disposed) ctx.ui.render();
      }
    }
    return;
  }
  if (action === 'lesson') {
    const outline = ctx.root.querySelector<HTMLDetailsElement>('[data-disclosure=outline]');
    if (outline && matchMedia('(max-width: 700px)').matches) outline.open = false;
    ctx.insertAfter = undefined;
    ctx.selected = id || '';
    ctx.selectedBlocks.clear();
    ctx.ui.render('[data-lesson="title"]');
    return;
  }
  if (action === 'add-lesson') {
    addLesson(ctx);
    return;
  }
  if (action === 'retry') {
    await ctx.persistence.save();
    return;
  }
  if (action === 'preview') {
    await ctx.publishing.preview();
    return;
  }
  if (action === 'build') {
    await ctx.publishing.build();
    return;
  }
  if (action === 'download') {
    await ctx.publishing.download(id || '');
    return;
  }
  if (action === 'variant') {
    await ctx.publishing.variant(id || '');
    return;
  }
  if (action === 'close-preview') {
    ctx.publishing.closePreview();
    return;
  }
  if (action === 'add-resource') {
    ctx.root.querySelector<HTMLInputElement>('[data-resource]')?.click();
    return;
  }
  if (action === 'add-source') {
    await ctx.sources.pick();
    return;
  }
  if (action === 'refresh-source') {
    await ctx.sources.refresh(id || '');
    return;
  }
  if (action === 'edit-source') {
    await ctx.sources.edit(id || '');
    return;
  }
  if (!lesson) return;
  if (action === 'move-selected') {
    const options = ctx.module.lessons.filter((l) => l.id !== ctx.selected);
    if (!options.length) {
      ctx.ui.status('Add another lesson to move this content into.');
      return;
    }
    const modal = mountModal(
      `<form class="learning-link-form"><h2>Move ${ctx.selectedBlocks.size} selected ${ctx.selectedBlocks.size === 1 ? 'item' : 'items'}</h2><label>Destination lesson<select class="field-select" name="lesson">${options.map((l) => `<option value="${esc(l.id)}">${esc(l.title)}</option>`).join('')}</select></label><p class="learning-hint">The selected content will be added at the end of this lesson.</p><div class="learning-toolbar"><button type="button" class="btn btn--ghost" data-cancel>Cancel</button><button class="btn btn--primary" type="submit">Move content</button></div></form>`,
      { className: 'learning-ui learning-small-modal', ariaLabel: 'Move content to lesson' }
    );
    modal.el.querySelector('[data-cancel]')!.addEventListener('click', () => modal.close());
    modal.el.querySelector('form')!.addEventListener('submit', (event) => {
      event.preventDefault();
      const destination = modal.el.querySelector('select')!.value;
      modal.close();
      if (!ctx.disposed && !ctx.busy) ctx.edit.moveBlocks(destination);
    });
    return;
  }
  if (action === 'clear-selection') {
    ctx.selectedBlocks.clear();
    syncBlockSelection(ctx);
    ctx.root.querySelector<HTMLElement>('[data-block-drag]')?.focus();
    return;
  }
  if (action === 'remove-selected')
    lesson.blocks = lesson.blocks.filter((b) => !ctx.selectedBlocks.has(b.id));
  if (action === 'duplicate-selected') {
    const selected = new Set(ctx.selectedBlocks);
    ctx.selectedBlocks.clear();
    lesson.blocks = lesson.blocks.flatMap((b) => {
      if (!selected.has(b.id)) return [b];
      const copy = { ...structuredClone(b), id: crypto.randomUUID() };
      ctx.selectedBlocks.add(copy.id);
      if (ctx.sourceDisplay[b.id]) ctx.sourceDisplay[copy.id] = { ...ctx.sourceDisplay[b.id]! };
      return [b, copy];
    });
  }
  if (action === 'add-text') ctx.edit.insert({ id: crypto.randomUUID(), kind: 'text', text: '' });
  if (action === 'remove-block') lesson.blocks = lesson.blocks.filter((b) => b.id !== id);
  if (action === 'block-up' || action === 'block-down') {
    const from = lesson.blocks.findIndex((b) => b.id === id),
      to = from + (action === 'block-up' ? -1 : 1);
    if (from >= 0 && to >= 0 && to < lesson.blocks.length)
      [lesson.blocks[from], lesson.blocks[to]] = [lesson.blocks[to]!, lesson.blocks[from]!];
  }
  if (action === 'up' && index > 0)
    [ctx.module.lessons[index - 1], ctx.module.lessons[index]] = [
      lesson,
      ctx.module.lessons[index - 1]!,
    ];
  if (action === 'down' && index < ctx.module.lessons.length - 1)
    [ctx.module.lessons[index + 1], ctx.module.lessons[index]] = [
      lesson,
      ctx.module.lessons[index + 1]!,
    ];
  if (action === 'remove-lesson') {
    ctx.module.lessons.splice(index, 1);
    ctx.selected = ctx.module.lessons[Math.max(0, index - 1)]?.id || '';
  }
  change(ctx);
  const focus =
    action === 'block-up' || action === 'block-down'
      ? `[data-block="${CSS.escape(id || '')}"] [data-block-menu]`
      : action === 'remove-selected'
        ? '[data-action=add-text]'
        : action === 'duplicate-selected'
          ? `[data-block="${CSS.escape([...ctx.selectedBlocks][0] || '')}"] [data-block-drag]`
          : action === 'add-text'
            ? `[data-block="${CSS.escape(ctx.insertAfter || lesson.blocks.at(-1)!.id)}"] [data-block-field=text]`
            : action === 'remove-block'
              ? lesson.blocks.length
                ? `[data-block]:nth-child(${Math.min(blockIndex + 1, lesson.blocks.length)}) [data-block-surface]`
                : '[data-action=add-text]'
              : action === 'remove-lesson'
                ? ctx.selected
                  ? '[data-action=lesson][aria-current=true]'
                  : '[data-action=add-lesson]'
                : undefined;
  ctx.ui.render(focus);
  ctx.insertAfter = undefined;
}
