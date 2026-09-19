// SPDX-License-Identifier: MPL-2.0
import { wireReorderList } from '../../components/reorder-list.ts';
import { t, tRaw } from '../../i18n.ts';
import { announce } from '../../a11y.ts';
import { paletteOrder, writePaletteOrder } from './palette-order.ts';

interface PaletteReorderContext {
  doc(): unknown;
  before(label: string): void;
  commit(): void;
}

/** Each group uses the shared pointer/keyboard gesture, with one undoable write. */
export function mountPaletteReorder(palette: HTMLElement | null, ctx: PaletteReorderContext): { render(): void; destroy(): void } {
  let stops: Array<() => void> = [];
  const destroy = (): void => { for (const stop of stops) stop(); stops = []; };
  const render = (): void => {
    destroy();
    for (const grid of palette?.querySelectorAll<HTMLElement>('.be-pal-grid') ?? []) {
      stops.push(wireReorderList(grid, (from, to) => {
        const cards = [...grid.querySelectorAll<HTMLElement>('[data-reorder-row]')];
        const keys = cards.map(card => card.dataset.reorderRow!);
        keys.splice(to, 0, keys.splice(from, 1)[0]!);
        const all = [...palette!.querySelectorAll<HTMLElement>('[data-reorder-row]')].map(card => card.dataset.reorderRow!);
        const group = new Set(keys);
        let i = 0;
        ctx.before(t('Reorder colours'));
        writePaletteOrder(ctx.doc(), [...all.map(key => group.has(key) ? keys[i++]! : key), ...paletteOrder(ctx.doc()).filter(key => !all.includes(key))]);
        ctx.commit();
        // Rendering replaced the grid, so restore focus using the stable token key.
        const moved = [...palette!.querySelectorAll<HTMLElement>('[data-reorder-row]')].find(card => card.dataset.reorderRow === keys[to]);
        moved?.querySelector<HTMLElement>('[data-reorder-handle]')?.focus();
      }, announce, {
        layout: 'grid',
        instructions: t('Use the arrow keys to move within this group. Space drops. Escape cancels.'),
        cancelled: t('Move cancelled.'),
        position: (index, count) => tRaw('Colour {position} of {count}.', { position: index + 1, count }),
      }));
    }
  };
  return { render, destroy };
}
