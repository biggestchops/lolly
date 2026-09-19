// SPDX-License-Identifier: MPL-2.0
import { looksLikeTable, parseTableText, toHtmlTable, toTsv } from '../../../../engine/src/table-text.ts';
import type { TableValue } from '../../../../engine/src/inputs.ts';

export interface GridCell { row: number; col: number; }
export type GridKeyAction =
  | { kind: 'move'; cell: GridCell; extend: boolean }
  | { kind: 'edit'; replace?: string }
  | { kind: 'commit'; direction: number }
  | { kind: 'cancel' }
  | { kind: 'newline' }
  | { kind: 'clear' };

/** Both table renderers use the same navigation and editing keys. */
export function gridKeyAction(
  e: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey' | 'isComposing'>,
  cell: GridCell, rows: number, cols: number, editing: boolean,
): GridKeyAction | null {
  if (e.isComposing || rows < 1 || cols < 1) return null;
  if (editing) {
    if (e.key === 'Escape') return { kind: 'cancel' };
    if (e.key === 'Enter') return e.altKey ? { kind: 'newline' } : { kind: 'commit', direction: e.shiftKey ? -1 : 1 };
    return null;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') return { kind: 'clear' };
  if (e.key === 'Enter' || e.key === 'F2') return e.altKey ? { kind: 'newline' } : { kind: 'edit' };
  const next = { ...cell };
  switch (e.key) {
    case 'ArrowLeft': next.col--; break;
    case 'ArrowRight': next.col++; break;
    case 'ArrowUp': next.row--; break;
    case 'ArrowDown': next.row++; break;
    case 'Home': next.col = 0; if (e.ctrlKey || e.metaKey) next.row = 0; break;
    case 'End': next.col = cols - 1; if (e.ctrlKey || e.metaKey) next.row = rows - 1; break;
    default:
      return e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey
        ? { kind: 'edit', replace: e.key } : null;
  }
  next.row = Math.max(0, Math.min(rows - 1, next.row));
  next.col = Math.max(0, Math.min(cols - 1, next.col));
  return { kind: 'move', cell: next, extend: e.shiftKey };
}

/** Paste preserves headings and existing cells outside the target rectangle. */
export function pasteTableCells(table: TableValue, start: GridCell, rows: string[][]): TableValue {
  const next = { columns: [...table.columns], rows: table.rows.map(row => [...row]) };
  if (start.row < 0 || start.col < 0 || !next.columns.length) return next;
  if (rows.some(row => start.col + row.length > next.columns.length)) throw new Error('The pasted cells extend past the last column. Add columns or use Replace table.');
  for (let r = 0; r < rows.length; r++) {
    while (next.rows.length <= start.row + r) next.rows.push(next.columns.map(() => ''));
    const target = next.rows[start.row + r]!;
    rows[r]!.forEach((value, c) => { if (start.col + c < next.columns.length) target[start.col + c] = value; });
  }
  return next;
}

export function selectedTableCells(table: TableValue, a: GridCell, b: GridCell): string[][] {
  return table.rows.slice(Math.min(a.row, b.row), Math.max(a.row, b.row) + 1)
    .map(row => row.slice(Math.min(a.col, b.col), Math.max(a.col, b.col) + 1));
}

/** HTML preserves the cell boundaries when copied text contains tabs or newlines. */
export function tableCellClipboard(rows: string[][]): { text: string; html: string } {
  const table = { columns: rows[0] ?? [], rows: rows.slice(1) };
  return { text: toTsv(table), html: toHtmlTable(table) };
}

export function fieldCell(fieldId: string | undefined): GridCell | null {
  const match = /:t:(\d+):(\d+)$/.exec(fieldId ?? '');
  return match ? { row: Number(match[1]), col: Number(match[2]) } : null;
}

/** Clipboard cell paste has no header row and keeps commas in a single value. */
export function clipboardCells(text: string): string[][] {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  if (normalized.includes('\t')) return normalized.split('\n').map(line => line.split('\t'));
  if (looksLikeTable(normalized)) {
    const parsed = parseTableText(normalized);
    if (parsed) return [parsed.columns, ...parsed.rows];
  }
  return normalized.split('\n').map(line => [line]);
}
