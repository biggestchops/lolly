// SPDX-License-Identifier: MPL-2.0
/**
 * The shared document emoji style - views/tool/emoji-doc.ts.
 *
 * The design tool and Doc Studio render no sidebar at all, so the Document dock is
 * the only emoji control they have, and it is built BEFORE the sidebar section
 * seeds the value. This holder is what lets the dock read and write the same style
 * the section owns. What is pinned here is that the section registers itself, that
 * a write from the dock reaches the runtime and every writer, and that a retired
 * tool leaves nothing behind for the next one.
 *
 * Run directly:
 *   node --import ./tests/css-stub.mjs --test shells/web/src/views/tool/emoji-doc.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import type { HostV1 } from '@lolly-tools/core/host-v1';
import type { EmojiSetInfoV1, EmojiStyleV1 } from '@lolly-tools/core/emoji-v1';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://lolly.tools/' });
for (const k of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'Element', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'localStorage']) {
  (globalThis as Record<string, unknown>)[k] = (dom.window as unknown as Record<string, unknown>)[k];
}

const { mountEmojiSection } = await import('./emoji-section.ts');
const { emojiDocumentStyle, setEmojiDocumentStyle, onEmojiDocumentChange } = await import('./emoji-doc.ts');

const SET: EmojiSetInfoV1 = {
  pin: { id: 'community/emoji/twemoji/color-starter', pin: { version: '17.0.3' }, checksum: `sha256:${'a'.repeat(64)}` },
  family: 'Twemoji', style: 'Color (starter)', label: 'Twemoji Color (starter)',
  license: 'CC-BY-4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  attribution: 'Twemoji by Twitter, licensed CC BY 4.0.', glyphs: 180, coverageComplete: false,
};
const SET_KEY = 'community/emoji/twemoji/color-starter@17.0.3';

function fakeHost(): HostV1 {
  return {
    emoji: { sets: async () => [SET], manifest: async () => null, artwork: async () => null, parseXml: () => null },
    tokens: { colors: async () => [{ ref: '{color.brand.primary}', value: '#0c322c' }] },
    profile: { get: async () => ({}), subscribe: () => () => {} },
  } as unknown as HostV1;
}

function fakeRuntime() {
  const styles: (EmojiStyleV1 | null)[] = [];
  return {
    styles,
    emoji: { present: true, replaced: 1, unresolved: 0, style: null as EmojiStyleV1 | null },
    onEmojiChange: () => () => {},
    async setEmojiStyle(style: EmojiStyleV1 | null) { styles.push(style); this.emoji.style = style; },
    async applyEmojiToDom() { return { present: true, replaced: 0, unresolved: 0, census: [] }; },
  };
}

/** An editor layout: no `#emoji-section` anywhere, because no aside is rendered. */
function chromeless(): HTMLElement {
  document.body.innerHTML = '<div id="view"><div id="tool-canvas"></div></div>';
  return document.getElementById('view')!;
}

test('the section registers the holder even where there is no sidebar to show', async () => {
  const runtime = fakeRuntime();
  const written: (unknown)[] = [];
  const mounted = await mountEmojiSection({
    root: chromeless(), host: fakeHost(), runtime,
    url: { emoji: SET_KEY, emojifx: 'mono' },
    onStyle: (_style, params) => written.push(params),
  });

  // The seed reached the runtime and the holder, with no section in the document.
  assert.equal(emojiDocumentStyle()?.primary.id, SET.pin.id, 'the dock can read the set the link named');
  assert.equal(emojiDocumentStyle()?.treatment.mode, 'mono');
  assert.deepEqual(written.at(-1), { emoji: SET_KEY, emojifx: 'mono' });

  mounted.destroy();
  assert.equal(emojiDocumentStyle(), null, 'a retired tool leaves nothing for the next one');
});

test('a choice made in the dock drives the runtime and every writer', async () => {
  const runtime = fakeRuntime();
  const written: unknown[] = [];
  let told = 0;
  const off = onEmojiDocumentChange(() => { told++; });
  const mounted = await mountEmojiSection({
    root: chromeless(), host: fakeHost(), runtime, onStyle: (_s, params) => written.push(params),
  });
  const before = told;

  const style: EmojiStyleV1 = {
    schemaVersion: 1, primary: SET.pin, fallbacks: [], metricsPolicy: 'inline-em-v1',
    treatment: { mode: 'snap', strengthBps: 10000, palette: [{ id: '{color.brand.primary}', hex: '#0c322c' }], recipe: 'emoji-treatment-v1' },
  };
  setEmojiDocumentStyle(style);
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(emojiDocumentStyle()?.treatment.mode, 'snap');
  assert.equal(runtime.styles.at(-1)?.treatment.mode, 'snap', 'the canvas is redrawn with it');
  assert.deepEqual(written.at(-1), { emoji: SET_KEY, emojifx: 'snap' }, 'and the link, the session and the CLI all get it');
  assert.ok(told > before, 'the other surface is told to redraw its row');

  setEmojiDocumentStyle(null);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(emojiDocumentStyle(), null);
  assert.equal(written.at(-1), null, 'clearing is a change like any other');

  off();
  mounted.destroy();
});

test('writing with no tool mounted is a no-op, never a throw', () => {
  assert.equal(emojiDocumentStyle(), null);
  setEmojiDocumentStyle(null);
  assert.equal(emojiDocumentStyle(), null);
});
