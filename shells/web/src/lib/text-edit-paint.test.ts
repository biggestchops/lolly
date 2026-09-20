// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { patchTextEditingCanvas } from './text-edit-paint.ts';
const box = (id: string, text: string, x = 0) => `<div class="lolly-box" data-box-id="${id}" style="left:${x}px"><div class="lolly-box-text">${text}</div></div>`;
test('a canvas paint keeps the composing branch, logical selection and native nodes connected', () => {
  const dom = new JSDOM(`<main>${box('a', 'Other')}${box('b', 'Before')}</main>`), doc = dom.window.document, root = doc.querySelector('main')!;
  const text = root.querySelector('[data-box-id="b"] .lolly-box-text')!;
  text.innerHTML = '<span data-native-text-editor contenteditable="true">日本</span>';
  const editor = text.firstElementChild as HTMLElement, native = editor.firstChild!;
  editor.focus(); doc.getSelection()!.setBaseAndExtent(native, 1, native, 2);
  const removed: Node[] = [], observer = new dom.window.MutationObserver(() => {});
  observer.observe(root, { childList: true, subtree: true });
  assert.ok(patchTextEditingCanvas(root, box('b', 'Settled', 100) + box('a', 'Changed') + box('c', 'New')));
  for (const mutation of observer.takeRecords()) removed.push(...mutation.removedNodes);
  assert.ok(!removed.some(node => node === editor || node.contains(editor)));
  assert.equal(doc.getSelection()!.anchorNode, native); assert.equal(doc.getSelection()!.anchorOffset, 1);
  assert.equal(doc.activeElement, editor); assert.equal(editor.textContent, '日本');
  assert.equal(root.querySelector('[data-box-id="b"]')!.getAttribute('style'), 'left:100px');
  assert.equal(root.querySelector('[data-box-id="a"]')!.textContent, 'Changed');
  assert.deepEqual([...root.children].map(node => node.getAttribute('data-box-id')), ['b', 'a', 'c']);
  observer.disconnect(); dom.window.close();
});
