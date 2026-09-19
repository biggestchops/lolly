// SPDX-License-Identifier: MPL-2.0
import { htmlTableToTsv } from '../lib/table-paste.ts';
import { inheritTableSources } from './block-table.ts';
import { announce } from '../a11y.ts';
import type { TableValue } from '../../../../engine/src/inputs.ts';
import { clipboardCells, pasteTableCells, fieldCell, gridKeyAction, selectedTableCells, tableCellClipboard, type GridCell } from '../lib/table-grid-navigation.ts';

/** Read live cells: input-panel repaint waits until typing finishes. */
export function readTableCells(wrap: HTMLElement): TableValue {
  return {
    columns: [...wrap.querySelectorAll<HTMLInputElement>('thead .table-cell')].map((h) => h.value),
    rows: [...wrap.querySelectorAll('tbody tr')]
      .filter(
        (tr) =>
          !tr.hasAttribute('data-table-ghost') ||
          [...tr.querySelectorAll<HTMLInputElement>('.table-cell')].some(
            (c) => c.value.trim() !== ''
          )
      )
      .map((tr) => [...tr.querySelectorAll<HTMLInputElement>('.table-cell')].map((c) => c.value)),
  };
}

export function wireTableEnter(cell: HTMLElement, wrap: HTMLElement, id: string): void {
  cell.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    const [, , row, col] = cell.dataset.fieldId!.split(':');
    wrap
      .querySelector<HTMLElement>(
        `[data-field-id="${CSS.escape(`${id}:t:${Number(row) + 1}:${col}`)}"]`
      )
      ?.focus();
  });
}

/** Cell selection and text editing are separate, including in a floating panel. */
export function wireTableNavigation(wrap: HTMLElement, read: () => TableValue, commit?: (value: TableValue) => void): void {
  let active: GridCell = { row: 0, col: 0 };
  let anchor = active;
  let editing: HTMLTextAreaElement | null = null;
  let original = '';
  const cells = () => [...wrap.querySelectorAll<HTMLTextAreaElement | HTMLButtonElement>('tbody .table-cell')];
  const select = (next: GridCell, extend = false): void => {
    active = next;
    if (!extend) anchor = next;
    for (const cell of cells()) {
      const pos = fieldCell(cell.dataset.fieldId)!;
      cell.tabIndex = pos.row === next.row && pos.col === next.col ? 0 : -1;
      cell.toggleAttribute('data-grid-selected', pos.row >= Math.min(anchor.row, next.row) && pos.row <= Math.max(anchor.row, next.row) && pos.col >= Math.min(anchor.col, next.col) && pos.col <= Math.max(anchor.col, next.col));
    }
  };
  const find = (pos: GridCell) => cells().find(cell => {
    const coord = fieldCell(cell.dataset.fieldId);
    return coord?.row === pos.row && coord.col === pos.col;
  });
  const finish = (cancel = false): void => {
    if (!editing) return;
    const cell = editing;
    editing = null;
    delete wrap.dataset.tableEditing;
    if (cancel && cell.value !== original) {
      cell.value = original;
      cell.dispatchEvent(new Event('input', { bubbles: true }));
    }
    cell.readOnly = true;
  };
  const begin = (cell: HTMLTextAreaElement, replace?: string): void => {
    finish();
    editing = cell;
    original = cell.value;
    wrap.dataset.tableEditing = 'true';
    cell.readOnly = false;
    if (replace !== undefined) {
      cell.value = replace;
      cell.dispatchEvent(new Event('input', { bubbles: true }));
    }
    cell.focus();
    if (replace === undefined) cell.select();
    else cell.setSelectionRange(cell.value.length, cell.value.length);
  };
  select(active);
  wrap.addEventListener('pointerdown', e => { const cell = (e.target as HTMLElement).closest<HTMLElement>('tbody .table-cell'); const pos = fieldCell(cell?.dataset.fieldId); if(pos) select(pos,e.shiftKey); });
  wrap.addEventListener('focusin', e => {
    const cell = e.target as HTMLTextAreaElement;
    const pos = fieldCell(cell.dataset.fieldId);
    if (pos && cell.matches('.table-cell')) {
      if (editing !== cell) finish();
      if (pos.row !== active.row || pos.col !== active.col) select(pos);
    }
  });
  wrap.addEventListener('focusout', e => { if (e.target === editing) finish(); });
  wrap.addEventListener('dblclick', e => {
    const cell = (e.target as HTMLElement).closest<HTMLTextAreaElement>('tbody textarea.table-cell');
    if (cell) begin(cell);
  });
  wrap.addEventListener('click', e => {
    if ((e as PointerEvent).pointerType !== 'touch') return;
    const cell = (e.target as HTMLElement).closest<HTMLTextAreaElement>('tbody textarea.table-cell');
    if (cell && editing !== cell) begin(cell);
  });
  wrap.addEventListener('keydown', e => {
    const cell = e.target as HTMLTextAreaElement;
    const pos = fieldCell(cell.dataset.fieldId);
    if (!pos || !cell.matches('.table-cell')) return;
    const rows = wrap.querySelectorAll('tbody tr').length;
    const action = gridKeyAction(e, pos, rows, read().columns.length, editing === cell);
    if (!action) return;
    e.preventDefault();
    if (action.kind === 'clear') {
      const value = read();
      for (let r = Math.min(anchor.row, active.row); r <= Math.max(anchor.row, active.row); r++) {
        for (let c = Math.min(anchor.col, active.col); c <= Math.max(anchor.col, active.col); c++) {
          if (value.rows[r]) value.rows[r]![c] = '';
        }
      }
      commit?.(value);
    } else if (action.kind === 'move') {
      select(action.cell, action.extend);
      const target = find(action.cell);
      target?.focus({ preventScroll: true });
      target?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    } else if (action.kind === 'edit') { if (cell.tagName === 'BUTTON') cell.click(); else begin(cell, action.replace); }
    else if (action.kind === 'cancel') finish(true);
    else if (action.kind === 'commit') {
      finish();
      const next = { row: Math.max(0, Math.min(rows - 1, pos.row + action.direction)), col: pos.col };
      select(next);
      find(next)?.focus();
    } else {
      if (cell.tagName === 'BUTTON') return;
      if (editing !== cell) begin(cell);
      cell.setRangeText('\n', cell.selectionStart, cell.selectionEnd, 'end');
      cell.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  wrap.addEventListener('copy', e => {
    if (editing || !fieldCell((e.target as HTMLElement).dataset.fieldId)) return;
    e.preventDefault();
    const copied = tableCellClipboard(selectedTableCells(read(), anchor, active));
    e.clipboardData?.setData('text/plain', copied.text);
    e.clipboardData?.setData('text/html', copied.html);
  });
}

export function wireTableRowMoves(
  wrap: HTMLElement,
  read: () => TableValue,
  commit: (value: TableValue) => void
): void {
  wrap.querySelectorAll<HTMLButtonElement>('[data-table-move-up]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const table = read(),
        row = Number(btn.dataset.tableMoveUp);
      if (row > 0) {
        [table.rows[row - 1], table.rows[row]] = [table.rows[row]!, table.rows[row - 1]!];
        commit(table);
      }
    });
  });
}

/** Paste either a rectangle at the active cell or a whole named table. */
export function tablePasteHandler(wrap: HTMLElement, read: () => TableValue, commit: (value: TableValue) => void, parse: (text: string) => TableValue | null): (event: ClipboardEvent) => void {
  return (e) => {
      if (e.defaultPrevented || wrap.dataset.tableEditing === 'true') return;
      const tsvFromHtml = htmlTableToTsv(e.clipboardData?.getData('text/html') ?? '');
      const text = tsvFromHtml || e.clipboardData?.getData('text/plain') || '';
      const origin = fieldCell((e.target as HTMLElement).dataset.fieldId);
      if (origin) {
        if (!text) return;
        const cells = clipboardCells(text);
        e.preventDefault();
        try {
          const previous = read();
          const next = inheritTableSources(pasteTableCells(previous, origin, cells), previous);
          wrap.querySelector<HTMLElement>(':focus')?.blur();
          commit(next);
          announce('Cells pasted');
        } catch (error) { announce((error as Error).message); }
        return;
      }
      const parsed = parse(text);
      if (!parsed) return;
      e.preventDefault();
      // Pasting replaces the grid's shape. End cell editing so the panel can
      // rebuild now; otherwise the next row action reads the old visible cells.
      wrap.querySelector<HTMLElement>(':focus')?.blur();
      commit(parsed);
      announce(`Table replaced: ${parsed.rows.length} rows, ${parsed.columns.length} columns`);
  };
}
