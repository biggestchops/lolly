// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import type { HostV1 } from '@lolly-tools/core/host-v1';
import type { Runtime } from '../../../../engine/src/runtime.ts';
import type { InputModelItem } from '../../../../engine/src/inputs.ts';
import { insertInputEmoji, mountInputEmoji } from './input-emoji.ts';

function fixture(html = '<input value="Hello world">') {
  const dom = new JSDOM(`<main>${html}</main>`);
  Object.assign(globalThis, { document: dom.window.document, window: dom.window });
  return dom.window.document.querySelector('input,textarea') as HTMLInputElement | HTMLTextAreaElement;
}

test('insertion replaces the selection and leaves the caret after the complete emoji', () => {
  for (const html of ['<input value="Hello world">', '<textarea>Hello world</textarea>']) {
    const field = fixture(html);
    const changes: string[] = [];
    field.addEventListener('input', () => changes.push(field.value));
    assert.equal(insertInputEmoji(field, '\u{1f44b}\u{1f3fd}', 6, 11), true);
    assert.equal(field.value, 'Hello \u{1f44b}\u{1f3fd}');
    assert.equal(field.selectionStart, field.value.length);
    assert.equal(field.ownerDocument.activeElement, field);
    assert.deepEqual(changes, [field.value]);
  }
});

test('insertion respects length, read-only fields, cancellation and removed controls', () => {
  const field = fixture('<input value="hi" maxlength="3">');
  assert.equal(insertInputEmoji(field, '\u{1f600}', 2, 2), false);
  assert.equal(field.value, 'hi');
  field.maxLength = 10; field.readOnly = true;
  assert.equal(insertInputEmoji(field, '\u{1f600}', 2, 2), false);
  field.readOnly = false;
  field.addEventListener('beforeinput', event => event.preventDefault(), { once: true });
  assert.equal(insertInputEmoji(field, '\u{1f600}', 2, 2), false);
  field.remove();
  assert.equal(insertInputEmoji(field, '\u{1f600}', 2, 2), false);
});

test('generic fields offer insertion without adding it to URLs, numbers or managed controls', () => {
  fixture('<label>Title<input class="field-input" data-input-id="title"></label><input class="field-input" data-input-id="url"><input class="field-input" data-input-id="count"><div data-input-id="cards"><input class="block-field" data-field-id="cards:0:title"></div><div inert><input class="field-input" data-input-id="locked"></div>');
  const root = document.querySelector('main')!;
  const model = [{ id: 'title', type: 'text', label: 'Title' }, { id: 'url', type: 'url' }, { id: 'count', type: 'number' }, { id: 'locked', type: 'text' }, { id: 'cards', type: 'blocks', fields: [{ id: 'title', type: 'text', label: 'Card title' }] }] as InputModelItem[];
  const destroy = mountInputEmoji(root, model, { emoji: {} } as HostV1, { emoji: { style: null }, onEmojiChange: () => () => {} } as unknown as Runtime);
  assert.equal(root.querySelectorAll('.input-emoji-trigger').length, 2);
  assert.equal(root.querySelector('[data-input-id="title"]')?.getAttribute('aria-label'), 'Title');
  assert.equal(root.querySelector('[data-field-id="cards:0:title"]')?.getAttribute('aria-label'), 'Card title');
  destroy();
});

test('a modal that makes the whole app inert at mount does not remove the buttons', () => {
  // The template chooser traps focus by making #app inert while the sidebar mounts.
  const dom = new JSDOM('<div id="app" inert><main><input class="field-input" data-input-id="title"><div inert><input class="field-input" data-input-id="locked"></div></main></div>');
  Object.assign(globalThis, { document: dom.window.document, window: dom.window });
  const root = dom.window.document.querySelector('main')!;
  const model = [{ id: 'title', type: 'text' }, { id: 'locked', type: 'text' }] as InputModelItem[];
  const destroy = mountInputEmoji(root, model, { emoji: {} } as HostV1, { emoji: { style: null }, onEmojiChange: () => () => {} } as unknown as Runtime);
  const triggers = root.querySelectorAll('.input-emoji-trigger');
  assert.equal(triggers.length, 1, 'the open field gets a button and the locked one still does not');
  assert.equal(triggers[0]!.parentElement?.querySelector('[data-input-id]')?.getAttribute('data-input-id'), 'title');
  destroy();
});
