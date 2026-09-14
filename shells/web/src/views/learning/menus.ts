// SPDX-License-Identifier: MPL-2.0
import type { LearningCtx } from './context.ts';
import { mountBodyPopover, type BodyPopoverHandle } from '../../components/body-popover.ts';
import { wireHelpTips, unwireHelpTips } from '../../components/help-tip.ts';
import { menuItemHtml } from '../../lib/context-menu.ts';
import { icon } from '../../lib/icons.ts';

export function mountLearningMenus(ctx: LearningCtx): () => void {
  let menu: BodyPopoverHandle | undefined;
  wireHelpTips(ctx.root);
  const click = (event: MouseEvent) => {
    const trigger = (event.target as Element).closest<HTMLElement>(
      '[data-block-menu], [data-action=insert-content]'
    );
    if (!trigger || ctx.busy) return;
    const inserting = trigger.dataset.action === 'insert-content';
    const id = trigger.closest<HTMLElement>('[data-block]')!.dataset.block!;
    const blocks = ctx.module.lessons.find((lesson) => lesson.id === ctx.selected)!.blocks;
    const index = blocks.findIndex((block) => block.id === id);
    menu?.close();
    menu = mountBodyPopover(
      trigger,
      (el, handle) => {
        el.innerHTML = (
          inserting
            ? [
                menuItemHtml('add-text', icon('font'), 'Text'),
                menuItemHtml('add-source', icon('image'), 'Designs and media'),
                menuItemHtml('add-quiz', icon('check'), 'Practice quiz'),
                menuItemHtml('add-resource', icon('filePlus'), 'Resource file'),
              ]
            : [
                index > 0 ? menuItemHtml('block-up', icon('chevronDown'), 'Move content up') : '',
                index < blocks.length - 1
                  ? menuItemHtml('block-down', icon('chevronDown'), 'Move content down')
                  : '',
                menuItemHtml('remove-block', icon('trash'), 'Remove content', { danger: true }),
              ]
        ).join('');
        el.addEventListener('keydown', (e) => {
          if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
          e.preventDefault();
          const items = [...el.querySelectorAll<HTMLElement>('[data-act]')];
          const current = items.indexOf(document.activeElement as HTMLElement);
          const next =
            e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? items.length - 1
                : (current + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        });
        el.addEventListener('click', async (e) => {
          const item = (e.target as Element).closest<HTMLElement>('[data-act]');
          if (!item) return;
          handle.close();
          try {
            await ctx.flushTyping();
            ctx.insertAfter = inserting ? id : undefined;
            if (!ctx.disposed) await ctx.edit.action(item.dataset.act!, id);
          } catch (error) {
            ctx.ui.status(error instanceof Error ? error.message : 'Content could not be changed.');
          }
        });
        return el.querySelector<HTMLElement>('[data-act]');
      },
      {
        className: 'folder-menu ctx-menu learning-content-menu',
        ariaLabel: inserting ? 'Insert content' : 'Content actions',
        trackScroll: true,
      }
    );
    menu.open();
  };
  ctx.root.addEventListener('click', click);
  return () => {
    menu?.close(false);
    ctx.root.removeEventListener('click', click);
    unwireHelpTips(ctx.root);
  };
}
