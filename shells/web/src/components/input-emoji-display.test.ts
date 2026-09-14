// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountInputEmojiDisplay } from './input-emoji-display.ts';

const emoji = '\u{1f600}';
function fixture() {
  const dom = new JSDOM('<span><textarea aria-label="Text"></textarea></span>', { pretendToBeVisual: true });
  const field = dom.window.document.querySelector('textarea')!;
  const wrapper = field.parentElement!;
  field.value = `Hi ${emoji}`;
  return { dom, field, wrapper };
}
function artwork(node: HTMLElement) {
  const value = node.textContent!;
  const glyph = node.ownerDocument.createElement('span');
  glyph.className = 'lolly-emoji'; glyph.dataset.emoji = emoji; glyph.textContent = emoji;
  node.replaceChildren(value.slice(0, -emoji.length), glyph);
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('artwork preserves the accessible native value and restores empty text and teardown', async () => {
  const { dom, field, wrapper } = fixture();
  field.style.setProperty('-webkit-text-fill-color', 'navy');
  const display = mountInputEmojiDisplay(field, wrapper, async node => artwork(node));
  await settle();
  assert.equal(field.value, `Hi ${emoji}`);
  assert.equal(field.getAttribute('aria-label'), 'Text');
  assert.equal(wrapper.querySelector('.input-emoji-display')?.getAttribute('aria-hidden'), 'true');
  assert.equal(field.style.getPropertyValue('-webkit-text-fill-color'), 'transparent');
  field.value = '';
  field.dispatchEvent(new dom.window.Event('input'));
  assert.equal(field.style.getPropertyValue('-webkit-text-fill-color'), 'navy');
  assert.equal(wrapper.querySelector<HTMLElement>('.input-emoji-display')?.hidden, true);
  display.dispose();
  assert.equal(wrapper.querySelector('.input-emoji-display'), null);
  dom.window.close();
});

test('a delayed pass cannot cover a newer edit, composition or disposed field', async () => {
  const { dom, field, wrapper } = fixture();
  const pending: (() => void)[] = [];
  const display = mountInputEmojiDisplay(field, wrapper, node => new Promise<void>(resolve => {
    pending.push(() => { artwork(node); resolve(); });
  }));
  field.value = `New ${emoji}`;
  field.dispatchEvent(new dom.window.Event('input'));
  pending.shift()!(); await settle();
  assert.equal(field.style.getPropertyValue('-webkit-text-fill-color'), '');
  pending.shift()!(); await settle();
  assert.equal(wrapper.querySelector('.input-emoji-display')?.textContent, field.value);
  field.dispatchEvent(new dom.window.CompositionEvent('compositionstart'));
  assert.equal(field.style.getPropertyValue('-webkit-text-fill-color'), '');
  field.dispatchEvent(new dom.window.CompositionEvent('compositionend'));
  display.dispose(); pending.shift()!(); await settle();
  assert.equal(wrapper.querySelector('.input-emoji-display'), null);
  assert.equal(field.style.getPropertyValue('-webkit-text-fill-color'), '');
  dom.window.close();
});

test('ASCII skips artwork and a render error leaves the field editable', async () => {
  const { dom, field, wrapper } = fixture();
  field.value = 'ordinary text';
  let calls = 0;
  const display = mountInputEmojiDisplay(field, wrapper, async () => { ++calls; throw new Error('unavailable'); });
  assert.equal(calls, 0);
  field.value = emoji; display.refresh(); await settle();
  assert.equal(calls, 1);
  assert.equal(field.value, emoji);
  assert.equal(field.style.getPropertyValue('-webkit-text-fill-color'), '');
  display.dispose(); dom.window.close();
});
