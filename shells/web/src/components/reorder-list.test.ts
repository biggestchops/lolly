// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { wireReorderList } from './reorder-list.ts';

function fixture(layout: 'list' | 'grid') {
  const dom = new JSDOM('<body><div id="rows"></div></body>', { pretendToBeVisual: true });
  const root = dom.window.document.querySelector<HTMLElement>('#rows')!;
  root.innerHTML = ['a', 'b', 'c', 'd', 'e'].map(id => `<div data-reorder-row="${id}"><button data-reorder-handle>${id}</button></div>`).join('');
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame;
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame;
  globalThis.getComputedStyle = dom.window.getComputedStyle as typeof getComputedStyle;
  const handles = [...root.querySelectorAll<HTMLButtonElement>('button')];
  const list = [...root.children] as HTMLElement[];
  list.forEach((row, i) => {
    row.getBoundingClientRect = () => ({ left: layout === 'grid' ? i % 3 * 100 : 0, top: layout === 'grid' ? Math.floor(i / 3) * 100 : i * 100, width: 100, height: 100 }) as DOMRect;
    row.scrollIntoView = () => {};
  });
  handles.forEach(handle => {
    handle.setPointerCapture = () => {};
    handle.hasPointerCapture = () => false;
  });
  const moves: number[][] = [], messages: string[] = [];
  const stop = wireReorderList(root, (from, to) => moves.push([from, to]), text => messages.push(text), { layout, position: (i, count) => `Colour ${i + 1}/${count}` });
  const key = (value: string, index = 0): void => { handles[index]!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })); };
  const pointer = (type: string, x: number, y: number): void => {
    const event = new dom.window.MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    handles[0]!.dispatchEvent(event);
  };
  return { handles, moves, messages, key, pointer, close: () => { stop(); dom.window.close(); } };
}

test('grid keyboard moves by columns, cancels without writing, and commits once on drop', () => {
  const f = fixture('grid');
  try {
    f.key(' '); f.key('ArrowDown'); f.key('ArrowRight');
    assert.deepEqual(f.moves, []);
    assert.equal(f.messages.at(-1), 'Colour 5/5');
    f.key('Escape'); assert.deepEqual(f.moves, []);
    f.key(' ', 4); f.key('ArrowUp', 4); f.key('ArrowUp', 4); f.key('Enter', 4);
    assert.deepEqual(f.moves, [[4, 1]], 'a partial last row still moves by the full column count');
    assert.equal(f.handles[4]!.getAttribute('aria-pressed'), 'false');
  } finally { f.close(); }
});

test('horizontal pointer travel reorders a grid, while a tap or lost capture makes no write', () => {
  const f = fixture('grid');
  try {
    f.pointer('pointerdown', 50, 50); f.pointer('pointerup', 50, 50);
    assert.deepEqual(f.moves, []);
    f.pointer('pointerdown', 50, 50); f.pointer('pointermove', 250, 50); f.pointer('lostpointercapture', 250, 50);
    assert.deepEqual(f.moves, []);
    f.pointer('pointerdown', 50, 50); f.pointer('pointermove', 250, 50); f.pointer('pointerup', 250, 50);
    assert.deepEqual(f.moves, [[0, 2]]);
  } finally { f.close(); }
});

test('the existing list gesture stays vertical, and Tab cancels without trapping focus', () => {
  const f = fixture('list');
  try {
    f.key(' '); f.key('ArrowDown'); f.key('Tab');
    assert.deepEqual(f.moves, []);
    f.key(' '); f.key('ArrowDown'); f.key(' ');
    assert.deepEqual(f.moves, [[0, 1]]);
  } finally { f.close(); }
});
