// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendTable, shiftTable, tableMapping } from '../engine/src/table-edit.ts';
import type { TableEditorSpec } from '../packages/core/src/manifest.ts';

const spec: TableEditorSpec = {
  title: 'Edit programme',
  fields: [
    { key: 'date', label: 'Date', editor: 'date', required: true },
    { key: 'start', label: 'Start', aliases: ['begins'], editor: 'time', dateField: 'date' },
    { key: 'end', label: 'End', editor: 'time', dateField: 'endDate' },
    { key: 'endDate', label: 'End date', editor: 'date' },
    { key: 'id', label: 'Session ID', identity: true },
  ],
};
test('semantic import maps aliases and retains unknown data while detecting duplicate assignments', () => {
  const mapped = tableMapping({ columns: ['Custom', 'begins', 'Date'], rows: [] }, spec);
  assert.deepEqual(mapped, { columns: ['Custom', 'Start', 'Date'], issues: [] });
  assert.match(
    tableMapping({ columns: ['Date', 'Start', 'begins'], rows: [] }, spec).issues.join(),
    /Duplicate/
  );
  const added = appendTable(
    { columns: ['Date', 'Session ID', 'Custom'], rows: [['2026-10-14', 'a', 'keep']] },
    { columns: ['Start', 'Date', 'Extra'], rows: [['23:30', '2026-10-15', 'also keep']] }
  );
  assert.deepEqual(added.rows, [
    ['2026-10-14', 'a', 'keep', '', ''],
    ['2026-10-15', '', '', '23:30', 'also keep'],
  ]);
});
test('shifting across midnight records both dates and preserves IDs and other cells', () => {
  const before = {
    columns: ['Date', 'Start', 'End', 'Session ID'],
    rows: [
      ['2026-10-14', '23:00', '24:00', 'a'],
      ['2026-10-15', '10:00', '11:00', 'b'],
    ],
  };
  const next = shiftTable(before, spec, 90, 1, 0);
  assert.deepEqual(next.rows[0], ['2026-10-16', '00:30', '01:30', 'a', '2026-10-16']);
  assert.deepEqual(next.rows[1], ['2026-10-15', '10:00', '11:00', 'b', '']);
  assert.equal(before.rows[0]![1], '23:00');
});
test('invalid source data fails a bulk shift atomically', () => {
  const before = { columns: ['Date', 'Start'], rows: [['2026-02-30', '10:00']] };
  assert.throws(() => shiftTable(before, spec, 30, 0), /fix Date/);
  assert.equal(before.rows[0]![1], '10:00');
});
