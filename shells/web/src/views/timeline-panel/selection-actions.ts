// SPDX-License-Identifier: MPL-2.0
import { t } from '../../i18n.ts';
import { announce } from '../../a11y.ts';
import type { BodyPopoverHandle } from '../../components/body-popover.ts';
import type { IconName } from '../../lib/icons.ts';
import { MIN_DUR, boxTiming, isTimed, moveOverlays, moveSeqClips, seqBoxes } from '../timeline-math.ts';
import type { Box } from '../timeline-math.ts';
import { bindOp, type TpCtx } from './context.ts';

/** Resolve the live selection once, including always-on layers. */
export function selectedIds(tp: TpCtx): string[] {
  const selected = new Set(tp.selection.get());
  return tp.getBoxes().map(b => String(b?.[tp.cfg.idField] ?? '')).filter(id => id && selected.has(id));
}

export function selectAll(tp: TpCtx): void {
  const ids = tp.getBoxes().filter(b => isTimed(b, tp.cfg)).map(b => String(b[tp.cfg.idField] ?? '')).filter(Boolean);
  if (!ids.length) return;
  tp.focusedId = ids[0]!;
  tp.rows.selectAndReveal(ids);
  announce(t('{n} clips selected', { n: String(ids.length) }));
}

/** Existing magnetic and overlay writers also serve these precise, no-drag actions. */
export function moveSelection(tp: TpCtx, where: 'start' | 'end' | 'playhead'): void {
  const rows = tp.getBoxes();
  const ids = selectedIds(tp);
  const wanted = new Set(ids);
  const selected = rows.filter(b => wanted.has(String(b?.[tp.cfg.idField] ?? '')));
  if (!selected.length || selected.some(b => !isTimed(b, tp.cfg))) return;
  let next: Box[];
  if (where === 'playhead') {
    if (selected.some(b => boxTiming(b, tp.cfg).lane === 'seq')) return;
    const first = Math.min(...selected.map(b => boxTiming(b, tp.cfg).start ?? 0));
    next = moveOverlays(rows, tp.cfg, ids, tp.clock.t() / 1000 - first);
  } else {
    if (selected.some(b => boxTiming(b, tp.cfg).lane !== 'seq')) return;
    const at = where === 'start' ? 0 : seqBoxes(rows, tp.cfg).length - ids.length;
    next = moveSeqClips(rows, tp.cfg, ids, at, tp.helpers.mediaDur);
  }
  if (tp.edit.timingSig(next) === tp.edit.timingSig(rows)) return;
  tp.helpers.write(next);
  tp.rows.selectAndReveal(ids);
  announce(t('Clips moved'));
}

export function trimAtPlayhead(tp: TpCtx, edge: 'in' | 'out'): void {
  const ids = selectedIds(tp);
  if (ids.length !== 1) return;
  tp.focusedId = ids[0]!;
  tp.edit.focusEdge(edge);
  tp.edit.trimToPlayhead();
}

/** Build on request, so closed menus cost no controls or playback work. */
export function render(tp: TpCtx, el: HTMLDivElement, pop: BodyPopoverHandle, anchor?: HTMLElement): HTMLElement | null {
  el.textContent = '';
  el.onkeydown = tp.selectionActions.onMenuKey;
  const rows = tp.getBoxes();
  const ids = selectedIds(tp);
  const wanted = new Set(ids);
  const selected = rows.filter(b => wanted.has(String(b?.[tp.cfg.idField] ?? '')));
  const add = (label: string, glyph: IconName, run: () => void, sub?: string, danger = false) => {
    el.append(tp.menus.menuItem(label, glyph, () => {
      pop.close(true);
      if (JSON.stringify(ids) !== JSON.stringify(selectedIds(tp))) {
        announce(t('The selection changed. Open Edit again to see its options.'));
        return;
      }
      run();
    }, { sub, danger }));
  };
  if (selected.length) {
    const splitIds = tp.playback.splitScope(false, rows).ids;
    if (splitIds.length && splitIds.every(id => wanted.has(id))) {
      add(t('Split at playhead'), 'scissors', () => tp.playback.splitAtPlayhead(), t('Cut here and keep both parts.'));
    }
    if (selected.length === 1 && isTimed(selected[0]!, tp.cfg)) {
      const { start, dur } = tp.rows.span(selected[0]!, tp.rows.durationSec());
      const at = tp.clock.t() / 1000;
      if (at > start && at < start + dur) {
        if (start + dur - at >= MIN_DUR) add(t('Trim start to playhead'), 'scissors', () => trimAtPlayhead(tp, 'in'), t('Remove the part before this point.'));
        if (at - start >= MIN_DUR) add(t('Trim end to playhead'), 'scissors', () => trimAtPlayhead(tp, 'out'), t('Remove the part after this point.'));
      }
    }
    if (selected.every(b => boxTiming(b, tp.cfg).lane === 'seq')) {
      const order = seqBoxes(rows, tp.cfg).map(b => String(b[tp.cfg.idField]));
      if (!order.slice(0, ids.length).every(id => wanted.has(id))) add(t('Move to start'), 'arrowLeft', () => moveSelection(tp, 'start'), t('Keep the selected clips together, in playback order.'));
      if (!order.slice(-ids.length).every(id => wanted.has(id))) add(t('Move to end'), 'arrowRight', () => moveSelection(tp, 'end'));
    } else if (selected.every(b => isTimed(b, tp.cfg) && boxTiming(b, tp.cfg).lane !== 'seq')) {
      add(t('Move to playhead'), 'arrowRight', () => moveSelection(tp, 'playhead'), t('Move the first selected clip here and keep the spacing.'));
      if (tp.menus.staggerableIds(rows, ids).length >= 2) add(t('Offset starts by…'), 'layers', () => tp.menus.openStaggerPop(ids, anchor));
    }
    if (ids.length === 1) {
      const id = ids[0]!;
      const join = tp.clips.throughNeighbour(id, rows);
      if (join) add(t('Join clips'), 'link', () => tp.clips.joinAt(join.aId, join.bId));
      if (tp.clips.partnerOf(id, rows)) add(t('Re-attach audio'), 'volumeOn', () => tp.clips.reattachAudioAt(id));
      else if (tp.clips.canDetach(id)) add(t('Detach audio'), 'volumeOff', () => tp.clips.detachAudioAt(id), t('Edit the sound on its own track.'));
    }
    add(ids.length > 1 ? t('Delete {n} items', { n: String(ids.length) }) : t('Delete'), 'trash', () => tp.edit.deleteBox(), t('Clips on the main track close the gap.'), true);
  }
  if (rows.some(b => isTimed(b, tp.cfg) && !wanted.has(String(b[tp.cfg.idField] ?? '')))) {
    add(t('Select all clips'), 'layers', () => selectAll(tp));
  }
  if (!el.childElementCount) {
    const hint = document.createElement('p');
    hint.className = 'tl-menu-sub';
    hint.textContent = t('Add media or text to start editing.');
    el.append(hint);
  }
  return el.querySelector<HTMLElement>('button');
}

export function onMenuKey(_tp: TpCtx, event: KeyboardEvent): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const menu = event.currentTarget as HTMLElement;
  const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
  if (!items.length) return;
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
    : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  event.preventDefault();
  event.stopPropagation();
  items[next]?.focus();
}

export function selectionActionsOps(tp: TpCtx) {
  return {
    selectedIds: bindOp(tp, selectedIds), selectAll: bindOp(tp, selectAll),
    moveSelection: bindOp(tp, moveSelection), trimAtPlayhead: bindOp(tp, trimAtPlayhead),
    render: bindOp(tp, render), onMenuKey: bindOp(tp, onMenuKey),
  };
}
