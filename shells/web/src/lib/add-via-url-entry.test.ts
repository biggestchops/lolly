// SPDX-License-Identifier: MPL-2.0
/**
 * lib/add-via-url-entry.ts - the asset picker's "Add from URL" entry. The
 * behaviour under test is the routing order (a tool link opens the render card,
 * an image is fetched and handed to the picker, anything else gets the capture
 * fallback), the stale-run guard shared with the search box, and the URL-entry
 * card's own wiring (Enter or Add submits, the back arrow dismisses).
 *
 * Run directly:  node --import ./tests/css-stub.mjs --test shells/web/src/lib/add-via-url-entry.test.ts
 *
 * jsdom gives a real https://lolly.tools origin, so a remote image takes the
 * proxy path; fetch is a controllable stub, so nothing hits the wire.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://lolly.tools/' });
globalThis.window = dom.window as unknown as typeof globalThis.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'location', { value: dom.window.location, configurable: true });

const { createUrlEntry } = await import('./add-via-url-entry.ts');
type Picker = Parameters<typeof createUrlEntry<string>>[0];

let respond: (url: string) => Response = () => new Response(new Uint8Array([1, 2]), { status: 200, headers: { 'content-type': 'image/png' } });
const fetched: string[] = [];
globalThis.fetch = (async (input: string | URL | Request) => { const u = String(input); fetched.push(u); return respond(u); }) as typeof fetch;

interface Trace {
  picker: Picker;
  events: string[];
  images: File[];
  takeoverEl: HTMLElement;
}

function makePicker(overrides: Partial<Picker> = {}): Trace {
  fetched.length = 0;
  const events: string[] = [];
  const images: File[] = [];
  const takeoverEl = document.createElement('div');
  document.body.replaceChildren(takeoverEl);
  const picker: Picker = {
    takeoverEl,
    showTakeover: (html) => { events.push('takeover'); takeoverEl.innerHTML = html; },
    dismissTakeover: () => { events.push('dismiss'); },
    describeUrl: async (url) => (url.includes('/tool/') ? `desc:${url}` : null),
    showToolCard: (desc, url) => { events.push(`tool ${desc} ${url}`); },
    useImage: async (file) => { images.push(file); events.push(`image ${file.name}`); },
    showFallback: (url) => { events.push(`fallback ${url}`); },
    ...overrides,
  };
  return { picker, events, images, takeoverEl };
}

test('a Lolly tool link opens the render card and fetches nothing', async () => {
  const { picker, events } = makePicker();
  await createUrlEntry(picker).handle('  https://lolly.tools/tool/qr-code?url=x  ');
  assert.deepEqual(events, ['takeover', 'tool desc:https://lolly.tools/tool/qr-code?url=x https://lolly.tools/tool/qr-code?url=x']);
  assert.equal(fetched.length, 0);
});

test('an image address is fetched and handed to the picker, with no fallback', async () => {
  respond = () => new Response(new Uint8Array([1, 2]), { status: 200, headers: { 'content-type': 'image/png' } });
  const { picker, events, images } = makePicker();
  await createUrlEntry(picker).handle('https://elsewhere.example/logo.png');
  assert.deepEqual(events, ['takeover', 'image logo.png']);
  assert.equal(images.length, 1);
  assert.equal(fetched.length, 1);
});

test('a slot that takes no tool renders goes straight to the image fetch', async () => {
  respond = () => new Response(new Uint8Array([1, 2]), { status: 200, headers: { 'content-type': 'image/png' } });
  const { picker, events } = makePicker({ describeUrl: null });
  await createUrlEntry(picker).handle('https://lolly.tools/tool/qr-code');
  assert.deepEqual(events, ['takeover', 'image qr-code.png']);
});

test('a page that is not an image gets the capture fallback', async () => {
  respond = () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } });
  const { picker, events } = makePicker();
  await createUrlEntry(picker).handle('https://elsewhere.example/about');
  assert.deepEqual(events, ['takeover', 'fallback https://elsewhere.example/about']);
});

test('a failure while storing the image falls back instead of throwing', async () => {
  respond = () => new Response(new Uint8Array([1]), { status: 200, headers: { 'content-type': 'image/png' } });
  const { picker, events } = makePicker({ useImage: async () => { throw new Error('quota'); } });
  await createUrlEntry(picker).handle('https://elsewhere.example/a.png');
  assert.deepEqual(events, ['takeover', 'fallback https://elsewhere.example/a.png']);
});

test('an empty entry does nothing', async () => {
  const { picker, events } = makePicker();
  await createUrlEntry(picker).handle('   ');
  assert.deepEqual(events, []);
});

test('a newer entry, or invalidate(), drops a detection still in flight', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  const { picker, events } = makePicker({
    describeUrl: async (url) => { if (url.endsWith('slow')) await gate; return `desc:${url}`; },
  });
  const entry = createUrlEntry(picker);
  const slow = entry.handle('https://lolly.tools/tool/slow');
  await entry.handle('https://lolly.tools/tool/fast');
  release();
  await slow;
  assert.deepEqual(events.filter((e) => e.startsWith('tool')), ['tool desc:https://lolly.tools/tool/fast https://lolly.tools/tool/fast']);

  let releaseAgain: () => void = () => {};
  const gateAgain = new Promise<void>((r) => { releaseAgain = r; });
  const second = makePicker({ describeUrl: async (url) => { await gateAgain; return `desc:${url}`; } });
  const entryAgain = createUrlEntry(second.picker);
  const pending = entryAgain.handle('https://lolly.tools/tool/qr-code');
  entryAgain.invalidate();
  releaseAgain();
  await pending;
  assert.deepEqual(second.events, ['takeover']);
});

test('the URL-entry card submits on Enter and on Add, and its back arrow dismisses', async () => {
  const { picker, events, takeoverEl } = makePicker();
  const entry = createUrlEntry(picker);
  entry.showCard();
  const input = takeoverEl.querySelector<HTMLInputElement>('.asset-picker-urlinput');
  assert.ok(input, 'the card renders its URL field');
  assert.equal(document.activeElement, input, 'the field takes focus');

  input.value = 'https://lolly.tools/tool/qr-code';
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(events.includes('tool desc:https://lolly.tools/tool/qr-code https://lolly.tools/tool/qr-code'));

  events.length = 0;
  entry.showCard();
  const again = takeoverEl.querySelector<HTMLInputElement>('.asset-picker-urlinput')!;
  again.value = '   ';
  takeoverEl.querySelector<HTMLButtonElement>('.url-go')!.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(events, ['takeover'], 'a blank field submits nothing');

  again.value = 'https://lolly.tools/tool/chart';
  takeoverEl.querySelector<HTMLButtonElement>('.url-go')!.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(events.includes('tool desc:https://lolly.tools/tool/chart https://lolly.tools/tool/chart'));

  events.length = 0;
  entry.showCard();
  takeoverEl.querySelector<HTMLButtonElement>('.asset-picker-toolcard-back')!.click();
  assert.deepEqual(events, ['takeover', 'dismiss']);
});
