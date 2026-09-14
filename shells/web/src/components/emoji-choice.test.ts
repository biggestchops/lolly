// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import type { HostV1 } from '@lolly-tools/core/host-v1';
import type { EmojiSetInfoV1, EmojiStyleV1 } from '@lolly-tools/core/emoji-v1';
import { mountEmojiChoice } from './emoji-choice.ts';

const set: EmojiSetInfoV1 = {
  pin: { id: 'test/color', pin: { version: '1.0.0' }, checksum: `sha256:${'a'.repeat(64)}` },
  family: 'Test', style: 'Color', label: 'Test Color', license: 'CC0-1.0', licenseUrl: '', attribution: '', glyphs: 1, coverageComplete: false,
};
const style: EmojiStyleV1 = { schemaVersion: 1, primary: set.pin, fallbacks: [], metricsPolicy: 'inline-em-v1', treatment: { mode: 'original', strengthBps: 0 } };
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 10));
function fixture(initial: EmojiStyleV1 | null = null) {
  const dom = new JSDOM('<main></main>');
  Object.assign(globalThis, { document: dom.window.document, window: dom.window, HTMLElement: dom.window.HTMLElement });
  const root = dom.window.document.querySelector('main')!;
  let current = initial, grids = 0, saved: object = {};
  const host = { emoji: { sets: async () => [set] }, profile: { get: async () => saved, set: async (next: object) => { saved = next; } } } as unknown as HostV1;
  const selection = { host, value: () => current, set: async (next: EmojiStyleV1) => { current = next; } };
  const grid = async (body: HTMLElement) => { grids++; body.textContent = 'GRID'; return () => { body.replaceChildren(); }; };
  const select = () => {
    const input = root.querySelector<HTMLSelectElement>('[data-emoji-set]')!;
    input.value = 'test/color@1.0.0'; input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  };
  const click = (text: string) => [...root.querySelectorAll('button')].find(button => button.textContent === text)!.click();
  return { root, selection, grid, select, click, state: () => ({ current, grids, saved }) };
}

test('first use requires an explicit set and Continue; the choice seeds future work', async () => {
  const f = fixture();
  const destroy = await mountEmojiChoice(f.root, f.selection, f.grid);
  assert.equal(f.state().grids, 0);
  assert.equal(f.root.querySelector<HTMLButtonElement>('.emoji-choice > button')!.disabled, true);
  f.select();
  assert.equal(f.state().current, null, 'selection is a draft until Continue');
  f.click('Continue'); await tick();
  assert.deepEqual(f.state().current, style);
  assert.equal(f.state().grids, 1);
  assert.deepEqual((f.state().saved as { emoji: { pin: unknown } }).emoji.pin, set.pin);
  destroy();
});

test('existing document choices open the grid and cancel leaves their style and preference alone', async () => {
  const f = fixture(style);
  const destroy = await mountEmojiChoice(f.root, f.selection, f.grid);
  assert.equal(f.state().grids, 1);
  f.click('Change emoji set'); await tick();
  assert.equal(f.root.querySelector<HTMLInputElement>('.emoji-remember input')!.checked, false);
  f.click('Cancel'); await tick();
  assert.deepEqual(f.state().current, style);
  assert.deepEqual(f.state().saved, {});
  assert.equal(f.state().grids, 2);
  destroy();
});

test('a failed grid load can be retried without discarding the selected set', async () => {
  const f = fixture(style);
  let calls = 0;
  const destroy = await mountEmojiChoice(f.root, f.selection, async (body) => {
    if (++calls === 1) throw new Error('offline');
    return f.grid(body);
  });
  assert.match(f.root.textContent!, /Emoji could not load/);
  f.click('Try again'); await tick();
  assert.equal(f.state().grids, 1);
  assert.deepEqual(f.state().current, style);
  destroy();
});
