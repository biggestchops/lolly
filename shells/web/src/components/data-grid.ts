// SPDX-License-Identifier: MPL-2.0
/**
 * A framework-free, virtualized datagrid (plan 89).
 *
 * Renders only the rows inside the scroll viewport (+ a small overscan), recycling
 * DOM as you scroll, so a 100k-row spreadsheet stays responsive on a fixed DOM
 * budget. Real DOM (not canvas), so it themes, is keyboard-accessible, and exports
 * through the normal SVG walker. In/out is `TableValue` ({columns, rows}) - a drop-in
 * for the `table` input control, `/pro` grids, and the `#/data` viewer.
 *
 * The windowing math (`visibleRange`) is pure and unit-tested; the mount function is
 * the DOM glue. Editing commits through `onChange`, so the host keeps ownership of
 * undo/state (the grid never forks its own store).
 */

import type { TableValue } from '@lolly/engine';
import '../styles/parts/data-grid.css';
import { escapeHtml } from '../lib/util/escape.ts';
import { clipboardCells, gridKeyAction, pasteTableCells, selectedTableCells, tableCellClipboard, type GridCell } from '../lib/table-grid-navigation.ts';
import { htmlTableToTsv } from '../lib/table-paste.ts';
import { validTableDate, tableMinutes } from '../../../../engine/src/table-edit.ts';

/** The slice of rows to render for a given scroll position, plus the offset + total
 *  height that place that slice inside a full-height scroll canvas. Pure. */
export function visibleRange(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  total: number,
  overscan = 4,
): { first: number; last: number; offsetY: number; totalHeight: number } {
  const rh = Math.max(1, rowHeight);
  const totalHeight = total * rh;
  if (total <= 0 || viewportHeight <= 0) return { first: 0, last: 0, offsetY: 0, totalHeight };
  const firstVisible = Math.floor(Math.max(0, scrollTop) / rh);
  const first = Math.max(0, firstVisible - overscan);
  const visible = Math.ceil(viewportHeight / rh) + overscan * 2;
  const last = Math.min(total, first + visible);
  return { first, last, offsetY: first * rh, totalHeight };
}

export interface DataGridOptions {
  value: TableValue;
  /** Editable (viewer read-only when false). Default true. */
  editable?: boolean;
  /** Debounced-commit callback with the whole updated table. */
  onChange?: (next: TableValue, change?: { deletedRow: number }) => void;
  /** Fixed-schema grids keep their column headings. */
  fixedColumns?: boolean;
  onError?: (message: string) => void;
  /** Column indices that are read-only even when the grid is editable (e.g. a
   *  formula column shown as its computed value - the honest-limits marker). */
  readOnlyCols?: number[];
  /** Fixed row height in px (default 28). */
  rowHeight?: number;
  /** Rows above/below the viewport to keep rendered (default 4). */
  overscan?: number;
  /** Open details for a row by click, Enter or Space, including read-only grids. */
  onRowActivate?: (row: number) => void;
  /** Observe cell navigation without switching the grid into row-selection mode. */
  onCellSelect?: (row: number, column: number) => void;
  activeCell?: GridCell;
  columnKinds?: Array<'date' | 'time' | 'url' | 'choice' | 'text' | undefined>;
  /** Let one column use spare horizontal space without shrinking other columns. */
  growColumn?: number;
}

export interface DataGridHandle {
  setValue(next: TableValue): void;
  getValue(): TableValue;
  focusCell(cell: GridCell): void;
  destroy(): void;
}

const ROW_H = 28;
const MIN_COL = 64;
const DEFAULT_COL = 128;

/** Sample the first N rows of a column to pick a sensible width (clamped). */
function colWidth(value: TableValue, col: number, sample = 40): number {
  let max = (value.columns[col] ?? '').length;
  const n = Math.min(sample, value.rows.length);
  for (let r = 0; r < n; r++) max = Math.max(max, (value.rows[r]?.[col] ?? '').length);
  return Math.max(MIN_COL, Math.min(DEFAULT_COL * 3, 12 + max * 8));
}

/**
 * Mount a virtualized grid into `container`. Returns a handle to update the value or
 * tear down. The container is emptied and given the grid's own markup.
 */
export function mountDataGrid(container: HTMLElement, opts: DataGridOptions): DataGridHandle {
  const rowHeight = opts.rowHeight ?? ROW_H;
  const overscan = opts.overscan ?? 4;
  const editable = opts.editable !== false;
  const readOnly = new Set(opts.readOnlyCols ?? []);
  // Trailing row-delete gutter - only when editable. Kept as a real column of the
  // flex row (not an overlay) so it stays aligned under virtualization and is
  // always reachable, matching the plain <table>'s per-row × the grid replaces.
  const actionW = editable ? 30 : 0;
  let value: TableValue = clone(opts.value);
  let widths = value.columns.map((_, c) => colWidth(value, c));

  container.classList.add('data-grid');
  container.setAttribute('role', 'grid');
  container.setAttribute('aria-readonly', String(!editable));
  container.innerHTML = `
    <div class="dg-viewport" tabindex="0">
      <div class="dg-inner">
        <div class="dg-header" role="row"></div>
        <div class="dg-canvas"><div class="dg-rows"></div></div>
      </div>
    </div>`;
  const viewport = container.querySelector<HTMLElement>('.dg-viewport')!;
  const inner = container.querySelector<HTMLElement>('.dg-inner')!;
  if (opts.growColumn !== undefined) inner.style.minWidth = '100%';
  const header = container.querySelector<HTMLElement>('.dg-header')!;
  const canvas = container.querySelector<HTMLElement>('.dg-canvas')!;
  const rowsEl = container.querySelector<HTMLElement>('.dg-rows')!;
  let activeRow = 0;
  let activeCell: GridCell = opts.activeCell ?? { row: 0, col: 0 };
  let anchor = activeCell;

  const totalWidth = () => widths.reduce((a, b) => a + b, 0) + actionW;

  function renderHeader(): void {
    inner.style.width = `${totalWidth()}px`;
    header.style.height = `${rowHeight}px`;
    // Each header carries a hover-revealed × to delete its column (skipped for a
    // read-only column); a trailing empty corner closes the row-delete gutter.
    header.innerHTML = value.columns
      .map((c, i) => `<div class="dg-cell dg-head-cell${readOnly.has(i) ? ' dg-ro' : ''}" role="columnheader" style="width:${widths[i]}px${opts.growColumn === i ? ';flex-grow:1' : ''}" data-col="${i}"><span class="dg-head-label">${esc(c)}</span>${editable && !opts.fixedColumns && !readOnly.has(i) ? `<button type="button" class="dg-del-col" data-del-col="${i}" title="Delete column" aria-label="Delete column">×</button>` : ''}</div>`)
      .join('')
      + (editable ? `<div class="dg-rowctl dg-rowctl-head" style="width:${actionW}px" aria-hidden="true"></div>` : '');
  }

  let rangeFirst = -1;
  let rangeLast = -1;
  function renderRows(force = false): void {
    const focused = rowsEl.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    const focusedRow = focused?.dataset.row, focusedCol = focused?.dataset.col;
    const { first, last, offsetY, totalHeight } = visibleRange(
      viewport.scrollTop, viewport.clientHeight, rowHeight, value.rows.length, overscan,
    );
    canvas.style.height = `${totalHeight}px`;
    if (!force && first === rangeFirst && last === rangeLast) return;
    rangeFirst = first; rangeLast = last;
    rowsEl.style.transform = `translateY(${offsetY}px)`;
    let html = '';
    for (let r = first; r < last; r++) {
      const row = value.rows[r] ?? [];
      html += `<div class="dg-row" role="row" aria-rowindex="${r + 2}" style="height:${rowHeight}px" data-row="${r}"${opts.onRowActivate ? ` tabindex="${r === activeRow ? 0 : -1}" aria-selected="${r === activeRow}"` : ''}>`;
      for (let c = 0; c < value.columns.length; c++) {
        const ro = !editable || readOnly.has(c);
        html += `<div class="dg-cell${ro ? ' dg-ro' : ''}" role="gridcell" style="width:${widths[c]}px${opts.growColumn === c ? ';flex-grow:1' : ''}" data-row="${r}" data-col="${c}" aria-colindex="${c + 1}" tabindex="${!opts.onRowActivate && r === activeCell.row && c === activeCell.col ? 0 : -1}"${r >= Math.min(anchor.row, activeCell.row) && r <= Math.max(anchor.row, activeCell.row) && c >= Math.min(anchor.col, activeCell.col) && c <= Math.max(anchor.col, activeCell.col) ? ' data-grid-selected' : ''}>${esc(row[c] ?? '')}</div>`;
      }
      // Trailing row-delete × (gutter column). Not a .dg-cell, so it never starts
      // a cell edit; the delegated click handler below removes the row.
      if (editable) html += `<div class="dg-rowctl" data-del-row="${r}" role="button" tabindex="-1" title="Delete row" aria-label="Delete row" style="width:${actionW}px">×</div>`;
      html += '</div>';
    }
    rowsEl.innerHTML = html;
    if (focusedRow !== undefined) {
      const selector = focusedCol !== undefined ? `.dg-cell[data-row="${focusedRow}"][data-col="${focusedCol}"]` : `.dg-row[data-row="${focusedRow}"]`;
      (rowsEl.querySelector<HTMLElement>(selector) ?? viewport).focus({ preventScroll: true });
    }
  }

  function refreshAria(): void {
    container.setAttribute('aria-rowcount', String(value.rows.length + 1));
    container.setAttribute('aria-colcount', String(value.columns.length));
  }

  // ── editing: click a cell → a single floating <input> over it ────────────────
  let editor: HTMLTextAreaElement | HTMLInputElement | null = null;
  function commit(): void {
    if (!editor) return;
    const activeEditor = editor;
    editor = null; // Removing a focused input fires blur; do not re-enter commit.
    const r = Number(activeEditor.dataset.row), c = Number(activeEditor.dataset.col);
    const next = clone(value);
    (next.rows[r] ??= [])[c] = activeEditor.value;
    value = next;
    const cell = rowsEl.querySelector<HTMLElement>(`.dg-cell[data-row="${r}"][data-col="${c}"]`);
    if (cell) cell.textContent = activeEditor.value;
    activeEditor.remove();
    // Keep focus in the grid when the editor simply vanished (Enter, scroll, or
    // programmatic removal) so the sidebar defers its rebuild (inputs-sync
    // isEditingGrid) - but never STEAL it back if the user clicked a real element
    // elsewhere (blur-to-outside), where a rebuild is the right thing.
    const ae = document.activeElement;
    if (!ae || ae === document.body) viewport.focus();
    opts.onChange?.(clone(value));
  }
  function beginEdit(cell: HTMLElement, replace?: string): void {
    if (!editable) return;
    const c = Number(cell.dataset.col);
    if (readOnly.has(c)) return;
    commit();
    const r = Number(cell.dataset.row);
    const box = cell.getBoundingClientRect();
    const host = viewport.getBoundingClientRect();
    const text = replace ?? value.rows[r]?.[c] ?? '';
    const kind = opts.columnKinds?.[c];
    const native = kind === 'url' || kind === 'date' && (!text || validTableDate(text)) || kind === 'time' && (!text || tableMinutes(text) !== null && tableMinutes(text)! < 1440);
    editor = document.createElement(native ? 'input' : 'textarea');
    if (native) (editor as HTMLInputElement).type = kind!;
    else (editor as HTMLTextAreaElement).rows = 1;
    editor.className = 'dg-editor';
    editor.value = text;
    editor.setAttribute('aria-label', `${value.columns[c] || 'Cell'}, row ${r + 1}`);
    editor.dataset.row = String(r); editor.dataset.col = String(c);
    editor.style.left = `${box.left - host.left + viewport.scrollLeft}px`;
    editor.style.top = `${box.top - host.top + viewport.scrollTop}px`;
    editor.style.width = `${box.width}px`;
    editor.style.height = `${box.height}px`;
    inner.appendChild(editor);
    editor.focus();
    if (!native || kind === 'url') {
      if (replace === undefined) editor.select();
      else editor.setSelectionRange(editor.value.length, editor.value.length);
    }
    editor.addEventListener('blur', commit, { once: true });
    editor.addEventListener('keydown', (e) => {
      const action = gridKeyAction(e as KeyboardEvent, activeCell, value.rows.length, value.columns.length, true);
      if (!action) return;
      e.preventDefault(); e.stopPropagation();
      if (action.kind === 'commit') { commit(); focusCell({ row: activeCell.row + action.direction, col: activeCell.col }); }
      else if (action.kind === 'cancel') { const cancelled = editor; editor = null; cancelled?.remove(); focusCell(activeCell); }
      else if (action.kind === 'newline' && editor?.tagName === 'TEXTAREA') {
        editor.setRangeText('\n', editor.selectionStart!, editor.selectionEnd!, 'end');
      }
    });
  }

  // ── structural edits: delete a row / column, commit through onChange ─────────
  function deleteRow(r: number): void {
    if (!editable || r < 0 || r >= value.rows.length) return;
    commit();
    value = clone(value);
    value.rows.splice(r, 1);
    refreshAria();
    renderRows(true);           // row indices shifted; columns (widths) unchanged
    opts.onChange?.(clone(value), { deletedRow: r });
  }
  function deleteCol(c: number): void {
    if (!editable || opts.fixedColumns || c < 0 || c >= value.columns.length) return;
    commit();
    value = clone(value);
    value.columns.splice(c, 1);
    for (const row of value.rows) row.splice(c, 1);
    widths = value.columns.map((_, i) => colWidth(value, i));
    // Read-only column indices shift left past the deleted one.
    const kept = [...readOnly].filter(i => i !== c).map(i => (i > c ? i - 1 : i));
    readOnly.clear(); for (const i of kept) readOnly.add(i);
    full();
    opts.onChange?.(clone(value));
  }

  const onScroll = (): void => { renderRows(); };
  const onDblClick = (e: MouseEvent): void => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('.dg-row .dg-cell');
    if (cell) { focusCell({ row: Number(cell.dataset.row), col: Number(cell.dataset.col) }); beginEdit(rowsEl.querySelector<HTMLElement>(`[data-row="${activeCell.row}"][data-col="${activeCell.col}"]`)!); }
  };
  // Delegated (rows recycle on scroll): a click on a row's × or a header's ×.
  const onClick = (e: MouseEvent): void => {
    const t = e.target as HTMLElement;
    const delRow = t.closest<HTMLElement>('[data-del-row]');
    if (delRow) { e.preventDefault(); deleteRow(Number(delRow.dataset.delRow)); return; }
    const delCol = t.closest<HTMLElement>('[data-del-col]');
    if (delCol) { e.preventDefault(); deleteCol(Number(delCol.dataset.delCol)); }
    const clickedCell = t.closest<HTMLElement>('.dg-row .dg-cell');
    if (clickedCell && !opts.onRowActivate) {
      commit();
      focusCell({ row: Number(clickedCell.dataset.row), col: Number(clickedCell.dataset.col) }, e.shiftKey);
      if ((e as PointerEvent).pointerType === 'touch') {
        const cell = rowsEl.querySelector<HTMLElement>(`.dg-cell[data-row="${activeCell.row}"][data-col="${activeCell.col}"]`);
        if (cell) beginEdit(cell);
      }
    }
    const row = t.closest<HTMLElement>('.dg-row');
    if (row && opts.onRowActivate) {
      activeRow = Number(row.dataset.row);
      renderRows(true);
      rowsEl.querySelector<HTMLElement>(`.dg-row[data-row="${activeRow}"]`)?.focus({ preventScroll: true });
      opts.onRowActivate(activeRow);
    }
  };
  function focusCell(next: GridCell, extend = false): void {
    activeCell = { row: Math.max(0, Math.min(value.rows.length - 1, next.row)), col: Math.max(0, Math.min(value.columns.length - 1, next.col)) };
    if (!extend) anchor = activeCell;
    const top = activeCell.row * rowHeight;
    if (top < viewport.scrollTop) viewport.scrollTop = top;
    else if (top + rowHeight * 2 > viewport.scrollTop + viewport.clientHeight) viewport.scrollTop = top + rowHeight * 2 - viewport.clientHeight;
    renderRows(true);
    const cell = rowsEl.querySelector<HTMLElement>(`.dg-cell[data-row="${activeCell.row}"][data-col="${activeCell.col}"]`);
    cell?.focus({ preventScroll: true });
    cell?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    opts.onCellSelect?.(activeCell.row, activeCell.col);
  }
  const onKey = (event: KeyboardEvent): void => {
    if (editor || !value.rows.length) return;
    if (!opts.onRowActivate) {
      const action = gridKeyAction(event, activeCell, value.rows.length, value.columns.length, false);
      if (!action) return;
      event.preventDefault();
      if (action.kind === 'clear' && editable) {
        value = clone(value);
        for (let r = Math.min(anchor.row, activeCell.row); r <= Math.max(anchor.row, activeCell.row); r++) {
          for (let c = Math.min(anchor.col, activeCell.col); c <= Math.max(anchor.col, activeCell.col); c++) if (!readOnly.has(c)) value.rows[r]![c] = '';
        }
        renderRows(true); focusCell(activeCell, true); opts.onChange?.(clone(value));
      } else if (action.kind === 'move') focusCell(action.cell, action.extend);
      else if (action.kind === 'edit' || action.kind === 'newline') {
        const cell = rowsEl.querySelector<HTMLElement>(`.dg-cell[data-row="${activeCell.row}"][data-col="${activeCell.col}"]`);
        if (cell) beginEdit(cell, action.kind === 'edit' ? action.replace : '\n');
      }
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); opts.onRowActivate(activeRow); return; }
    const moves: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, Home: -activeRow, End: value.rows.length - activeRow - 1 };
    if (moves[event.key] === undefined) return;
    event.preventDefault();
    activeRow = Math.max(0, Math.min(value.rows.length - 1, activeRow + moves[event.key]!));
    const top = activeRow * rowHeight;
    if (top < viewport.scrollTop) viewport.scrollTop = top;
    else if (top + rowHeight * 2 > viewport.scrollTop + viewport.clientHeight) viewport.scrollTop = top + rowHeight * 2 - viewport.clientHeight;
    renderRows(true);
    rowsEl.querySelector<HTMLElement>(`.dg-row[data-row="${activeRow}"]`)?.focus({ preventScroll: true });
  };
  const onCopy = (event: ClipboardEvent): void => {
    if (editor || opts.onRowActivate) return;
    event.preventDefault();
    const copied = tableCellClipboard(selectedTableCells(value, anchor, activeCell));
    event.clipboardData?.setData('text/plain', copied.text);
    event.clipboardData?.setData('text/html', copied.html);
  };
  const onPaste = (event: ClipboardEvent): void => {
    if (editor || !editable || opts.onRowActivate) return;
    const text = htmlTableToTsv(event.clipboardData?.getData('text/html') ?? '') || event.clipboardData?.getData('text/plain') || '';
    if (!text) return;
    const cells = clipboardCells(text);
    event.preventDefault(); event.stopPropagation();
    let next: TableValue;
    try { next = pasteTableCells(value, activeCell, cells); }
    catch (error) { opts.onError?.((error as Error).message); return; }
    for (const c of readOnly) next.rows.forEach((row, r) => { row[c] = value.rows[r]?.[c] ?? ''; });
    value = next;
    full(); focusCell(activeCell);
    opts.onChange?.(clone(value));
  };
  viewport.addEventListener('copy', onCopy);
  viewport.addEventListener('paste', onPaste);
  viewport.addEventListener('scroll', onScroll, { passive: true });
  rowsEl.addEventListener('dblclick', onDblClick);
  container.addEventListener('click', onClick);
  viewport.addEventListener('keydown', onKey);

  // A resize observer keeps the window correct when the viewport grows/shrinks.
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => renderRows(true)) : null;
  ro?.observe(viewport);

  function full(): void { renderHeader(); refreshAria(); renderRows(true); }
  full();

  return {
    focusCell,
    setValue(next) { value = clone(next); activeRow = Math.max(0, Math.min(activeRow, value.rows.length - 1)); widths = value.columns.map((_, c) => colWidth(value, c)); full(); },
    getValue() { return clone(value); },
    destroy() {
      viewport.removeEventListener('copy', onCopy);
      viewport.removeEventListener('paste', onPaste);
      viewport.removeEventListener('scroll', onScroll);
      rowsEl.removeEventListener('dblclick', onDblClick);
      container.removeEventListener('click', onClick);
      viewport.removeEventListener('keydown', onKey);
      ro?.disconnect();
      const disposedEditor = editor; editor = null; disposedEditor?.remove();
      container.replaceChildren();
      container.classList.remove('data-grid');
      for (const a of ['role', 'aria-rowcount', 'aria-colcount', 'aria-readonly']) container.removeAttribute(a);
    },
  };
}

function clone(t: TableValue): TableValue {
  return { columns: [...t.columns], rows: t.rows.map((r) => [...r]) };
}

const esc = escapeHtml;
