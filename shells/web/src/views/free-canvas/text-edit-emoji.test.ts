// SPDX-License-Identifier: MPL-2.0
/**
 * Editing a Design text box that carries emoji artwork (plan 252, stage B4).
 *
 * Emoji in a rendered text box are pack artwork - an `<svg>` inside a `.lolly-emoji`
 * span, with the characters kept in a clipped span beside it - so a caret cannot sit
 * in them and the rich-text char model must never meet them. The contract this file
 * pins is the whole round trip: the characters come back BEFORE the element becomes
 * editable, the commit carries exactly what was typed, and the artwork is drawn again
 * when the edit ends, whether it was committed or cancelled.
 *
 * Driven through real DOM events against the real `initFreeCanvas`, on the jsdom
 * harness free-canvas-flip.test.ts established: an in-memory runtime that echoes
 * `setInput` back through `getModel`. Only the runtime's emoji pass is doubled, and it
 * paints REAL placement markup, so the revert under test is the engine's own
 * `revertEmojiDom` reached the way the shell reaches it (`views/emoji-mount.ts`).
 *
 * Run directly:
 *   node --test shells/web/src/views/free-canvas/text-edit-emoji.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import type { Box } from '../free-canvas-math.ts';
import { initFreeCanvas } from '../free-canvas.ts';
import { mountEmoji } from '../emoji-mount.ts';

// ── jsdom bootstrap (same shape as free-canvas-flip.test.ts) ──────────────────
const dom = new JSDOM('<!DOCTYPE html><body></body>');
const W = dom.window as unknown as typeof globalThis & { MouseEvent: typeof MouseEvent; KeyboardEvent: typeof KeyboardEvent };
for (const k of ['window', 'document', 'HTMLElement', 'KeyboardEvent', 'Event', 'MouseEvent', 'Node', 'getComputedStyle', 'MutationObserver', 'getSelection']) {
  (globalThis as Record<string, unknown>)[k] = (dom.window as unknown as Record<string, unknown>)[k];
}
const rafQueue: Array<() => void> = [];
(globalThis as Record<string, unknown>).requestAnimationFrame = (fn: FrameRequestCallback): number => {
  rafQueue.push(() => fn(0));
  return rafQueue.length;
};
(globalThis as Record<string, unknown>).cancelAnimationFrame = (): void => {};
function frames(n = 3): void {
  for (let i = 0; i < n; i++) {
    const pending = rafQueue.splice(0, rafQueue.length);
    for (const fn of pending) fn();
  }
}
(globalThis as Record<string, unknown>).matchMedia = (q: string) =>
  ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
(globalThis as Record<string, unknown>).ResizeObserver = class { observe() {} disconnect() {} };

const rect = (left: number, top: number, width: number, height: number): DOMRect => ({
  left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() { return this; },
} as DOMRect);

function pointerEvent(type: string, o: { x: number; y: number }): MouseEvent {
  const e = new W.MouseEvent(type, { bubbles: true, cancelable: true, clientX: o.x, clientY: o.y, button: 0 });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  Object.defineProperty(e, 'pointerType', { value: 'mouse' });
  Object.defineProperty(e, 'buttons', { value: type === 'pointermove' ? 1 : 0 });
  return e;
}

const tick = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

// ── the emoji pass, doubled ───────────────────────────────────────────────────

const GRIN = '\u{1F600}';

/**
 * One placement, in the shape `engine/src/emoji-dom.ts` writes: the artwork, then the
 * characters it stands for in a clipped span. The engine's `revertEmojiDom` finds it by
 * the class and puts `data-emoji` back, so this is the real contract and not a stand-in
 * the revert was written around.
 */
const PLACEMENT = `<span class="lolly-emoji" role="img" data-emoji="${GRIN}" data-emoji-at="3"`
  + ' aria-label="grinning face" data-emoji-key="1f600" data-emoji-sum="00112233445566ff"'
  + ' style="display:inline-block;position:relative;width:1em;height:1em">'
  + '<svg aria-hidden="true" focusable="false" viewBox="0 0 36 36" style="display:block;width:100%;height:100%">'
  + '<circle cx="18" cy="18" r="18" fill="#ffcc4d"></circle></svg>'
  + '<span class="lolly-emoji-text" style="position:absolute;width:1px;height:1px;overflow:hidden">'
  + `${GRIN}</span></span>`;

/** Draw the placement over every bare emoji, the way a real pass would. Elements a
 *  person is editing are skipped, exactly as the engine skips them. */
function paintEmoji(root: Element): number {
  let painted = 0;
  const texts = [
    ...(root.classList?.contains('lolly-box-text') ? [root] : []),
    ...Array.from(root.querySelectorAll('.lolly-box-text')),
  ];
  for (const el of texts) {
    if (el.getAttribute('contenteditable') === 'true') continue;
    if (el.querySelector('.lolly-emoji')) continue;
    if (!(el.textContent ?? '').includes(GRIN)) continue;
    el.innerHTML = (el.textContent ?? '').split(GRIN).join(PLACEMENT);
    painted++;
  }
  return painted;
}

// ── fixture ───────────────────────────────────────────────────────────────────

const NATIVE = 1000;

function canvasCfg(): Record<string, unknown> {
  return {
    idField: 'id', xField: 'x', yField: 'y', wField: 'w', hField: 'h', rotationField: 'rot',
    fillField: 'bg', opacityField: 'opacity', shapeField: 'shape', radiusField: 'radius',
    textField: 'text', groupField: 'group', clipField: 'clip',
    addKinds: [{ id: 'text', label: 'Text', seed: {} }],
  };
}

interface Fixture {
  stageEl: HTMLElement;
  canvasEl: HTMLElement;
  textEl: HTMLElement;
  boxes(): Box[];
  /** Every element the doubled pass was asked to draw over. */
  passes: () => Element[];
  paint(): Promise<void>;
  destroy(): void;
}

function mount(text: string, withPass = true): Fixture {
  const viewEl = dom.window.document.createElement('div');
  const stageEl = dom.window.document.createElement('div');
  const canvasEl = dom.window.document.createElement('div');
  stageEl.appendChild(canvasEl);
  viewEl.appendChild(stageEl);
  dom.window.document.body.appendChild(viewEl);
  canvasEl.style.width = NATIVE + 'px';
  canvasEl.style.height = NATIVE + 'px';
  stageEl.getBoundingClientRect = () => rect(0, 0, NATIVE, NATIVE);
  canvasEl.getBoundingClientRect = () => rect(0, 0, NATIVE, NATIVE);

  // What the tool's template paints for one text box. The harness runs the overlay, not
  // the tool, so the box element is written here the way hooks.js writes it.
  const boxEl = dom.window.document.createElement('div');
  boxEl.className = 'lolly-box';
  boxEl.setAttribute('data-box-id', 't1');
  const textEl = dom.window.document.createElement('div');
  textEl.className = 'lolly-box-text';
  textEl.textContent = text;
  boxEl.appendChild(textEl);
  canvasEl.appendChild(boxEl);

  const initial: Box[] = [{ kind: 'text', shape: 'rect', id: 't1', x: 300, y: 300, w: 200, h: 120, bg: '', text } as Box];
  const model = new Map<string, unknown>([['boxes', initial]]);
  const subs: Array<() => void> = [];
  const passes: Element[] = [];
  const pass = {
    async applyEmojiToDom(node: unknown) {
      passes.push(node as Element);
      const replaced = paintEmoji(node as Element);
      return { present: true, replaced, unresolved: 0 };
    },
  };
  const runtime = {
    getModel: () => [...model.entries()].map(([id, value]) => ({ id, value })),
    setInput(id: string, value: unknown) { model.set(id, value); for (const s of subs) s(); },
    subscribe(fn: () => void) { subs.push(fn); return () => { subs.splice(subs.indexOf(fn), 1); }; },
    ...(withPass ? pass : {}),
  };
  const handle = initFreeCanvas({
    viewEl, stageEl, canvasEl,
    runtime: runtime as never,
    host: {} as never,
    input: { id: 'boxes', canvas: canvasCfg() as never, fields: [] },
    nativeW: NATIVE, nativeH: NATIVE,
  });
  frames();
  return {
    stageEl, canvasEl, textEl,
    boxes: () => model.get('boxes') as Box[],
    passes: () => passes,
    async paint() { await mountEmoji(canvasEl, { runtime: pass }); },
    destroy() { handle.destroy(); viewEl.remove(); dom.window.document.body.innerHTML = ''; },
  };
}

/** Select the box the way a click does: a pointerdown+up inside its model rect. */
function select(f: Fixture): void {
  f.canvasEl.dispatchEvent(pointerEvent('pointerdown', { x: 400, y: 360 }));
  f.canvasEl.dispatchEvent(pointerEvent('pointerup', { x: 400, y: 360 }));
  frames();
}

/** F2 opens the edit with the caret at the end (Enter would select all). */
function openEdit(): void {
  dom.window.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true }));
  frames();
}

function editKey(el: HTMLElement, key: string, meta = false): void {
  el.dispatchEvent(new W.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, metaKey: meta }));
  frames();
}

// ── tests ─────────────────────────────────────────────────────────────────────

test('a text box drawn with emoji artwork is plain text the moment it becomes editable', async () => {
  const f = mount(`Hi ${GRIN}`);
  try {
    await f.paint();
    assert.equal(f.textEl.querySelectorAll('.lolly-emoji').length, 1, 'the pass drew the artwork');

    select(f);
    openEdit();

    assert.equal(f.textEl.getAttribute('contenteditable'), 'true', 'the box is being edited');
    assert.equal(f.textEl.querySelector('.lolly-emoji'), null, 'no artwork is left under the caret');
    assert.equal(f.textEl.querySelector('svg'), null, 'and no svg either');
    assert.equal(f.textEl.textContent, `Hi ${GRIN}`, 'the characters came back exactly');
  } finally {
    f.destroy();
  }
});

test('the committed text is the typed text, with no artwork markup in it', async () => {
  const f = mount(`Hi ${GRIN}`);
  try {
    await f.paint();
    select(f);
    openEdit();
    // What typing leaves behind in the editable: the same plain text node, longer.
    f.textEl.textContent = `Hi ${GRIN} there`;
    editKey(f.textEl, 'Enter', true);

    assert.equal(f.boxes()[0]!.text, `Hi ${GRIN} there`, 'one emoji, in the characters the user typed');
    assert.equal(f.textEl.getAttribute('contenteditable'), null, 'the edit is over');

    await tick();
    assert.ok(f.passes().includes(f.textEl), 'the pass was asked to draw the box again');
    assert.equal(f.textEl.querySelectorAll('.lolly-emoji').length, 1, 'and the artwork is back');
  } finally {
    f.destroy();
  }
});

test('cancelling restores plain text and draws the artwork again', async () => {
  const f = mount(`Hi ${GRIN}`);
  try {
    await f.paint();
    select(f);
    openEdit();
    f.textEl.textContent = `Hi ${GRIN} discarded`;
    editKey(f.textEl, 'Escape');

    assert.equal(f.boxes()[0]!.text, `Hi ${GRIN}`, 'the model kept the text it had');
    assert.equal(f.textEl.textContent, `Hi ${GRIN}`, 'and the view was restored from the plain-text capture');

    await tick();
    assert.ok(f.passes().includes(f.textEl), 'the pass was asked to draw the box again');
    assert.equal(f.textEl.querySelectorAll('.lolly-emoji').length, 1, 'the artwork is drawn again after the cancel');
  } finally {
    f.destroy();
  }
});

test('a host with no emoji pass edits and commits exactly as before', async () => {
  // The overlay reads the pass off the runtime by shape, so an older bridge, the CLI or a
  // test double without it must lose nothing. Nothing is drawn, so nothing is reverted.
  const f = mount(`Hi ${GRIN}`, false);
  try {
    select(f);
    openEdit();
    assert.equal(f.textEl.getAttribute('contenteditable'), 'true');
    f.textEl.textContent = `Hi ${GRIN} plain`;
    editKey(f.textEl, 'Enter', true);
    assert.equal(f.boxes()[0]!.text, `Hi ${GRIN} plain`);
  } finally {
    f.destroy();
  }
});

test('unchanged legacy edits preserve special spaces, literal Markdown and terminal breaks', () => {
  for (const source of ['Hello\u00a0there', '*literal* **symbols** _text_', 'First\nlast\n', 'A\u202fB\u2009C', 'office e\u0301 👨‍👩‍👧‍👦']) {
    const f = mount(source, false);
    try {
      select(f); openEdit(); editKey(f.textEl, 'Enter', true);
      assert.equal(f.boxes()[0]!.text, source);
      assert.equal(f.textEl.textContent, source);
      assert.equal(f.boxes()[0]!.h, 120);
    } finally { f.destroy(); }
  }
});

test('a legacy edit changed and reverted before Done retains its original encoding', () => {
  const source = '*literal*\u00a0text\n', f = mount(source, false);
  try {
    select(f); openEdit();
    f.textEl.textContent = `${source}added`;
    f.textEl.textContent = source;
    editKey(f.textEl, 'Enter', true);
    assert.equal(f.boxes()[0]!.text, source);
  } finally { f.destroy(); }
});
