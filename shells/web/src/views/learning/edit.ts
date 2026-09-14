// SPDX-License-Identifier: MPL-2.0
import type { LearningCtx } from './context.ts';

export function editOps(ctx: LearningCtx): LearningCtx['edit'] {
  return {
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
  change(ctx);
  ctx.ui.render('[data-lesson="title"]');
}
export async function act(ctx: LearningCtx, action: string, id?: string): Promise<void> {
  if (ctx.busy) return;
  const lesson = ctx.module.lessons.find((l) => l.id === ctx.selected);
  const index = ctx.module.lessons.findIndex((l) => l.id === ctx.selected);
  const blockIndex = lesson?.blocks.findIndex((b) => b.id === id) ?? -1;
  if (action === 'undo') {
    const previous = ctx.undo.pop();
    if (previous) {
      ctx.delivery.invalidate();
      ctx.module = previous;
      ctx.lastEdit = structuredClone(previous);
      ctx.dirty = true;
      await ctx.persistence.save();
      ctx.selected =
        ctx.module.lessons.find((l) => l.id === ctx.selected)?.id ||
        ctx.module.lessons[0]?.id ||
        '';
      ctx.ui.render();
    }
    return;
  }
  if (action === 'lesson') {
    ctx.selected = id || '';
    ctx.ui.render();
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
  if (action === 'add-text')
    lesson.blocks.push({ id: crypto.randomUUID(), kind: 'text', text: '' });
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
    action === 'add-text'
      ? '[data-block]:last-child [data-block-field=text]'
      : action === 'remove-block'
        ? lesson.blocks.length
          ? `[data-block]:nth-child(${Math.min(blockIndex + 1, lesson.blocks.length)}) summary`
          : '[data-action=add-text]'
        : action === 'remove-lesson'
          ? ctx.selected
            ? '[data-action=lesson][aria-current=true]'
            : '[data-action=add-lesson]'
          : undefined;
  ctx.ui.render(focus);
}
