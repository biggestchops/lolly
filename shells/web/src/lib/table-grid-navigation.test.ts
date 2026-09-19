// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipboardCells, gridKeyAction, pasteTableCells, selectedTableCells, tableCellClipboard } from './table-grid-navigation.ts';

const key = (k: string, flags: Partial<KeyboardEvent> = {}) => ({ key: k, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, ...flags });
test('grid arrows cross the virtualisation boundary and clamp at actual bounds', () => {
  assert.deepEqual(gridKeyAction(key('ArrowDown'), { row: 49, col: 2 }, 500, 9, false), { kind: 'move', cell: { row: 50, col: 2 }, extend: false });
  assert.deepEqual(gridKeyAction(key('ArrowLeft'), { row: 0, col: 0 }, 51, 9, false), { kind: 'move', cell: { row: 0, col: 0 }, extend: false });
  assert.deepEqual(gridKeyAction(key('End', { ctrlKey: true }), { row: 0, col: 0 }, 51, 9, false), { kind: 'move', cell: { row: 50, col: 8 }, extend: false });
});
test('editing preserves caret and composition keys, with explicit commit and cancel', () => {
  const cell = { row: 1, col: 1 };
  assert.equal(gridKeyAction(key('ArrowDown'), cell, 10, 9, true), null);
  assert.equal(gridKeyAction(key('Enter', { isComposing: true }), cell, 10, 9, true), null);
  assert.deepEqual(gridKeyAction(key('Enter', { shiftKey: true }), cell, 10, 9, true), { kind: 'commit', direction: -1 });
  assert.deepEqual(gridKeyAction(key('Enter', { altKey: true }), cell, 10, 9, true), { kind: 'newline' });
  assert.deepEqual(gridKeyAction(key('Escape'), cell, 10, 9, true), { kind: 'cancel' });
  assert.equal(gridKeyAction(key('Tab'), cell, 10, 9, false), null);
});
test('rectangular paste preserves surrounding cells and grows rows without changing headings', () => {
  const table = { columns: ['Title', 'Room', 'Start'], rows: [['One', 'A', '09:00'], ['Two', 'B', '10:00']] };
  const next = pasteTableCells(table, { row: 1, col: 1 }, [['C', '11:00'], ['D', '12:00']]);
  assert.deepEqual(next.rows, [['One', 'A', '09:00'], ['Two', 'C', '11:00'], ['', 'D', '12:00']]);
  assert.equal(table.rows.length, 2);
  assert.deepEqual(selectedTableCells(next, { row: 2, col: 2 }, { row: 1, col: 1 }), [['C', '11:00'], ['D', '12:00']]);
});

test('paste refuses a rectangle that would silently lose columns', () => {
  assert.throws(() => pasteTableCells({columns:['A'],rows:[['old']]},{row:0,col:0},[['one','two']]), /last column/);
});

test('clipboard cell values preserve commas and empty rows', () => {
  assert.deepEqual(clipboardCells('Hello, world'), [['Hello, world']]);
  assert.deepEqual(clipboardCells('a\tb\n\t\nc\td\n'), [['a','b'],['',''],['c','d']]);
});

test('copying multiline cells keeps their rectangular boundaries', () => {
  const copied = tableCellClipboard([['Title\ncontinued', 'A\tB'], ['<script>', 'Room']]);
  assert.deepEqual(clipboardCells(copied.text), [['Title continued', 'A B'], ['<script>', 'Room']]);
  assert.match(copied.html, /&lt;script&gt;/);
  assert.equal((copied.html.match(/<(?:td|th)>/g) ?? []).length, 4);
});
