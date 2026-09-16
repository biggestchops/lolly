// SPDX-License-Identifier: MPL-2.0
/**
 * timeline-panel: box edits - ids, links, delete, trims, clock helpers.
 *
 * Every function takes the shared `tp: TpCtx` first (see context.ts). Sibling
 * calls in this file are direct; anything in another module, and any function used as
 * a value (an event listener), goes through `tp.<module>.<fn>`. Extracted verbatim
 * from initTimelinePanel() by scripts/split-closure.ts.
 */
import { t, tRaw } from '../../i18n.ts';
import { announce } from '../../a11y.ts';
import { boxTiming, fmtDelta, fmtDur, indexOfId, removeManyAndRipple } from '../timeline-math.ts';
import type { Box } from '../timeline-math.ts';
import { TAKE_TIMING } from '../timeline-config.ts';
import type { TakePhase } from './shared.ts';
import { bindOp, type TpCtx } from './context.ts';

/**
 * Ids are the tool's contract; mint one that cannot collide with an existing row.
 *
 * `rows` is the array to mint AGAINST - defaulted to the live model, but passed
 * explicitly by any caller composing several writes into one commit (the implicit
 * scene camera), where the live model does not yet contain the boxes already minted
 * into the pending array.
 */
export function mintId(tp: TpCtx, rows: Box[] = tp.getBoxes()): string {
  const { cfg } = tp;
  const used = new Set(rows.map((b) => String(b?.[cfg.idField] ?? '')));
  let n = used.size + 1;
  let id = `b${n}`;
  while (used.has(id)) {
    n++;
    id = `b${n}`;
  }
  return id;
}
/** Delete the selection, or one explicitly targeted item, in one undo step. */
export function deleteBox(tp: TpCtx, target?: string): void {
  const { bars, cfg, chips, getBoxes, selection } = tp;
  const selected = selection.get();
  const ids = (target ? [target] : selected.length ? selected : [tp.focusedId])
    .filter(id => bars.has(id) || chips.has(id));
  if (!ids.length) return;
  const gone = new Set(ids);
  // Hand focus to a neighbour rather than nowhere: `updateRovingTabindex` re-picks
  // when the id is gone, and rebuild() restores focus onto whatever it picked.
  const order = [...bars.keys(), ...chips.keys()];
  const at = order.findIndex(id => gone.has(id));
  tp.focusedId = order.slice(at + 1).find(id => !gone.has(id))
    || order.slice(0, at).reverse().find(id => !gone.has(id)) || '';
  // Say what was actually removed. Scenery has a chip, not a bar, and the panel's own
  // UI never calls it a clip - announcing "Clip removed" for an always-on image is the
  // one place the vocabulary would slip, and it slips only for screen-reader users.
  const wasClip = ids.every(id => bars.has(id));
  tp.helpers.write(removeManyAndRipple(getBoxes(), cfg, ids, tp.helpers.mediaDur));
  tp.rows.selectAndReveal(tp.focusedId ? [tp.focusedId] : []);
  announce(ids.length > 1 ? t('{n} items removed', { n: String(ids.length) })
    : wasClip ? t('Clip removed') : t('Removed'));
}
/** Every row's resolved timing, as one string - "did this edit change anything?". */
export function timingSig(tp: TpCtx, rows: Box[]): string {
  const { cfg } = tp;
  return JSON.stringify(
    rows.map((b) => {
      const tm = boxTiming(b, cfg);
      return [String(b?.[cfg.idField] ?? ''), tm.start, tm.dur, tm.clipIn, tm.speed, tm.lane];
    })
  );
}
/** The clip a keyboard trim would act on: the focused bar, else the selected one. */
export function trimTargetId(tp: TpCtx): string {
  const { bars, selection } = tp;
  if (tp.focusedId && bars.has(tp.focusedId)) return tp.focusedId;
  return selection.get().find((x) => bars.has(x)) || '';
}
/** Paint `.is-active` for the keyboard's chosen edge, and nowhere else. */
export function paintFocusedEdge(tp: TpCtx): void {
  const { bars } = tp;
  // A live trim gesture OWNS the edge chrome (beginTrimChrome → endGesture). Anything
  // that repaints mid-drag must not wipe the active/limit state out from under it.
  if (tp.gesture?.kind === 'trim') return;
  const target = tp.focusedEdge ? trimTargetId(tp) : '';
  for (const [id, node] of bars) {
    for (const el of Array.from(node.querySelectorAll<HTMLElement>('.tl-edge'))) {
      el.classList.toggle(
        'is-active',
        !!target && id === target && el.dataset.edge === tp.focusedEdge
      );
    }
  }
}
export function focusEdge(tp: TpCtx, edge: 'in' | 'out'): void {
  if (!trimTargetId(tp)) return;
  tp.focusedEdge = edge;
  paintFocusedEdge(tp);
  announce(edge === 'in' ? t('Trim the start') : t('Trim the end'));
}
/**
 * Nudge the focused edge by `deltaSec`. One write, one undo step.
 *
 * `lead` prefixes the spoken readout rather than being announce()d separately -
 * announce() replaces the live region's text, so two calls in one turn means the
 * first one is never heard.
 */
export function trimBy(tp: TpCtx, deltaSec: number, lead = ''): void {
  const { cfg, getBoxes, selection } = tp;
  const id = trimTargetId(tp);
  if (!id || !tp.focusedEdge) return;
  const boxes = getBoxes();
  const i = indexOfId(boxes, cfg, id);
  if (i < 0) return;
  const before = tp.rows.span(boxes[i]!, tp.rows.durationSec()).dur;
  // The keyboard follows the pointer's rule: a nudge with several clips selected
  // (the target among them) walks that edge on every one of them, so `,` / `.` and
  // an edge drag are the same edit at different speeds.
  const sel = selection.get();
  const ids = sel.length > 1 && sel.includes(id) ? sel : [id];
  const next = tp.gestures.trimRows(boxes, ids, tp.focusedEdge, deltaSec);
  // A press that hit a wall must not cost an undo entry - the same rule the split blade
  // already follows ("a split at an existing cut writes NOTHING"). Compared on the
  // resolved TIMING of every row, not on raw field equality: trimClip writes clipIn
  // explicitly, so a refused nudge still returns rows carrying `clipIn: 0` where the
  // field was simply absent before, and a textual comparison would call that a change.
  // Timing is also the whole of what a trim can touch, so nothing else can be missed.
  // The readout below is spoken either way: silence would read as a dropped keypress,
  // and "trimmed 0.0s" is exactly the feedback a wall deserves.
  if (timingSig(tp, next) !== timingSig(tp, boxes)) tp.helpers.write(next);
  const j = indexOfId(next, cfg, id);
  const now = j >= 0 ? tp.rows.span(next[j]!, tp.rows.durationSec()).dur : before;
  const said =
    ids.length > 1
      ? tRaw('{count} clips trimmed {delta}', {
          count: ids.length,
          delta: fmtDelta(now - before),
        })
      : tRaw('{name}: {dur}, trimmed {delta}', {
          name: tp.helpers.labelFor(id),
          dur: fmtDur(now),
          delta: fmtDelta(now - before),
        });
  announce(lead ? `${lead} ${said}` : said);
}
/** Pull the focused edge to the playhead - the no-dragging trim. */
export function trimToPlayhead(tp: TpCtx): void {
  const { cfg, clock, getBoxes } = tp;
  const id = trimTargetId(tp);
  if (!id || !tp.focusedEdge) return;
  const boxes = getBoxes();
  const i = indexOfId(boxes, cfg, id);
  if (i < 0) return;
  const { start, dur } = tp.rows.span(boxes[i]!, tp.rows.durationSec());
  trimBy(tp, 
    clock.t() / 1000 - (tp.focusedEdge === 'in' ? start : start + dur),
    t('Trim to the playhead')
  );
}
export const takeMaxMs = (tp: TpCtx): number =>
  tp.takeKind === 'audio' ? TAKE_TIMING.maxMs : TAKE_TIMING.videoMaxMs;
/**
 * Read the phase through a function, never the closed-over variable, inside the
 * async take driver: TypeScript narrows `takePhase` at the top of `startTake` and
 * cannot see that an awaited call reassigned it, so a direct comparison after an
 * await is a compile error (and, worse, would read as dead code).
 */
export const phase = (tp: TpCtx): TakePhase => tp.takePhase;
export const now = (_tp: TpCtx): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
export function editOps(tp: TpCtx) {
  return {
    mintId: bindOp(tp, mintId),
    deleteBox: bindOp(tp, deleteBox),
    timingSig: bindOp(tp, timingSig),
    trimTargetId: bindOp(tp, trimTargetId),
    paintFocusedEdge: bindOp(tp, paintFocusedEdge),
    focusEdge: bindOp(tp, focusEdge),
    trimBy: bindOp(tp, trimBy),
    trimToPlayhead: bindOp(tp, trimToPlayhead),
    takeMaxMs: bindOp(tp, takeMaxMs),
    phase: bindOp(tp, phase),
    now: bindOp(tp, now),
  };
}
