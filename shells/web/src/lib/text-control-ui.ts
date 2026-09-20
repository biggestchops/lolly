// SPDX-License-Identifier: MPL-2.0
/** Shared text control layout, composed from the shell's field and button primitives. */
import { icon, type IconName } from './icons.ts';
import { numField, type NumFieldHandle, type NumFieldOpts } from '../components/num-field.ts';
import '../styles/parts/text-controls.css';

const numbers = new WeakMap<Element, NumFieldHandle>();
const closeWired = new WeakSet<HTMLElement>();
let numberId = 0;

export function textControlNumber(root: HTMLElement, label: string, options: Omit<NumFieldOpts, 'id' | 'label' | 'name'>): NumFieldHandle {
  const field = numField({ ...options, id: `text-number-${++numberId}`, label: '', name: label });
  numbers.set(field.el, field);
  textControlRow(root, label, field.el);
  field.el.removeAttribute('aria-label');
  return field;
}

export function destroyTextControls(root: HTMLElement): void {
  for (const element of root.querySelectorAll('.num-field')) numbers.get(element)?.destroy();
}

export function styleTextControls(root: HTMLElement): void {
  root.classList.add('text-controls');
  if (!closeWired.has(root)) {
    closeWired.add(root); root.addEventListener('lolly:popover-close', () => destroyTextControls(root));
  }
  for (const field of root.querySelectorAll<HTMLInputElement>('input:not(.color-picker-field *):not(.num-field *)')) {
    field.classList.add(field.type === 'checkbox' ? 'field-check' : field.type === 'range' ? 'field-range' : 'field-input');
  }
  for (const field of root.querySelectorAll('select:not(.color-picker-field *)')) field.classList.add('field-select');
  for (const field of root.querySelectorAll('textarea:not(.color-picker-field *)')) field.classList.add('field-input');
  for (const button of root.querySelectorAll('button:not(.color-picker-field *):not(.fc-cbtn)')) button.classList.add('btn', 'btn--sm');
  for (const label of root.querySelectorAll<HTMLLabelElement>('label:not(.color-picker-field *)')) {
    if (label.classList.contains('text-control-axis') || label.closest('.text-control-feature')) continue;
    if (!label.querySelector(':scope > input,:scope > select,:scope > textarea')) continue;
    label.classList.add('text-control-row');
    for (const node of [...label.childNodes]) if (node.nodeType === 3 && node.textContent?.trim()) {
      const span = document.createElement('span'); span.textContent = node.textContent; node.replaceWith(span);
    }
    const checkbox = label.querySelector(':scope > input[type="checkbox"]'); if (checkbox) label.append(checkbox);
  }
}

export function textControlRow(root: HTMLElement, label: string, control: HTMLElement): HTMLElement {
  const row = document.createElement(control.matches('input,select,textarea,output') ? 'label' : 'div'), name = document.createElement('span');
  row.className = 'text-control-row'; name.textContent = label;
  control.setAttribute('aria-label', label); row.append(name, control); root.append(row);
  styleTextControls(row); return row;
}

export function textControlGroup(root: HTMLElement, label: string, open = false): HTMLElement {
  const group = document.createElement('details'), summary = document.createElement('summary'), body = document.createElement('div');
  group.className = 'text-control-group'; group.open = open; summary.textContent = label;
  body.className = 'text-control-body'; group.append(summary, body); root.append(group); return body;
}

export function textControlGrid(root: HTMLElement): HTMLElement {
  const grid = document.createElement('div'); grid.className = 'text-control-grid'; root.append(grid); return grid;
}

export function textControlAction(root: HTMLElement, label: string, run: () => void, glyph?: IconName, iconOnly = false): HTMLButtonElement {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn--sm text-control-action';
  button.setAttribute('aria-label', label); button.title = label;
  if (glyph) button.innerHTML = icon(glyph, { size: 18 });
  if (!iconOnly) { const text = document.createElement('span'); text.textContent = label; button.append(text); }
  else button.classList.add('text-control-icon');
  button.addEventListener('click', run); root.append(button); return button;
}

export function textControlChoices(root: HTMLElement, label: string, choices: Array<[string, string, IconName]>, read: () => string, write: (value: string) => void) {
  const group = document.createElement('div'); group.className = 'text-control-choices'; group.setAttribute('role', 'group'); group.setAttribute('aria-label', label);
  const buttons = choices.map(([value, name, glyph]) => {
    const button = textControlAction(group, name, () => { write(value); refresh(); }, glyph, true);
    button.dataset.value = value; return button;
  });
  textControlRow(root, label, group);
  function refresh() { for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.value === read())); }
  refresh(); return { refresh, group };
}
