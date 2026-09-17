// SPDX-License-Identifier: MPL-2.0
/**
 * THE SCENE BLOCK'S CHROME - the inspector section, the editor door and the add menu
 * (plan 265 milestone 3, lane D).
 *
 * A `kind: '3d'` box has no controls of its own. Its picture, its words, its lighting and
 * its motion are all the 3D Studio's answers, carried in one `scene` field as that tool's
 * own readable query. So the whole of this slice is a door: the inspector shows a Scene
 * section where any other box shows Image, the door opens the studio on the box's query,
 * and what comes back is written to the field in ONE commit.
 *
 * The four claims, each a way the door could be wrong rather than absent:
 *   - the section is gated by what the box IS, so a 3D box never offers "Set image" (an
 *     image would be painted over by the renderer) and an image box never offers a scene;
 *   - the door acts on the rows the SECTION was built for, because the studio is a modal
 *     and the canvas selection can move while it is open;
 *   - what is written back is the CANONICAL short query - the editor hands back an
 *     expanded link carrying every studio input and the embed's own size params, and
 *     writing that verbatim would put 2.5 KB in the document and blow the embed cap at
 *     two boxes (see engine/src/design-scene.ts);
 *   - and one gesture is one commit, so undo restores the scene the author came from,
 *     while cancelling writes nothing at all.
 *
 * Driven against the real modules: the shipped `community/design` manifest supplies the
 * field vocabulary and the add-kind labels, the `community/3d-studio` manifest is the
 * registered grammar, the still fixture from `tests/helpers/design-scene.ts` is the
 * document, and the round trip runs through the real `initFreeCanvas` and its real
 * `design.inspectorActions` port.
 *
 * Run directly:
 *   node --import ./tests/css-stub.mjs --test tests/design-inspector-scene.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

import { buildInputModel } from '../engine/src/inputs.ts';
import type { InputManifest, InputValue } from '../engine/src/inputs.ts';
import { serializeUrlState } from '../engine/src/url-mode.ts';
import { designSceneDecode, designSceneEncode } from '../engine/src/design-scene.ts';
import { buildEmbedUrl } from '../engine/src/tool-url.ts';
import { designSceneStill } from './helpers/design-scene.ts';

// The overlay reaches its timeline panel (and the panel its stylesheet) through a dynamic
// import, and Node has no idea what a .css module is. Registered in the file rather than
// left to `--import ./tests/css-stub.mjs`, so the suite also runs on its own.
registerHooks({
  load(url: string, ctx: unknown, next: (u: string, c: unknown) => unknown) {
    if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: 'export default {};' };
    return next(url, ctx);
  },
} as Parameters<typeof registerHooks>[0]);

// ── jsdom bootstrap (the free-canvas-design-ports.test.ts shape) ───────────────
const dom = new JSDOM('<!DOCTYPE html><body></body>');
const W = dom.window as unknown as typeof globalThis & { Event: typeof Event; MouseEvent: typeof MouseEvent };
for (const k of [
  'window', 'document', 'HTMLElement', 'HTMLInputElement', 'Element', 'KeyboardEvent', 'Event',
  'CustomEvent', 'MouseEvent', 'Node', 'getComputedStyle', 'MutationObserver',
]) {
  (globalThis as Record<string, unknown>)[k] = (dom.window as unknown as Record<string, unknown>)[k];
}
// The colour field escapes its own selectors with CSS.escape, which jsdom does not ship.
(dom.window as unknown as { CSS: { escape(s: string): string } }).CSS = {
  escape: (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`),
};
globalThis.CSS = (dom.window as unknown as { CSS: typeof globalThis.CSS }).CSS;
// A macrotask stands in for a frame, which is why every act below is followed by
// `settle()`: the overlay defers its repaint to rAF and the editor door to setTimeout.
globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
  dom.window.setTimeout(() => cb(0), 0) as unknown as number) as typeof requestAnimationFrame;
globalThis.cancelAnimationFrame = ((h: number) => dom.window.clearTimeout(h)) as typeof cancelAnimationFrame;
(globalThis as Record<string, unknown>).matchMedia = (q: string) =>
  ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
(globalThis as Record<string, unknown>).ResizeObserver = class { observe() {} disconnect() {} };
// The inspector remembers which groups are open per device, and jsdom's own localStorage
// is a SecurityError on this document's opaque origin.
const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as unknown as Storage;

const { initDesignInspector } = await import('../shells/web/src/views/design-inspector.ts');
const { initFreeCanvas } = await import('../shells/web/src/views/free-canvas.ts');
const { setSceneManifest } = await import('../shells/web/src/bridge/asset-dependencies.ts');
type Box = Record<string, unknown>;

// ── the shipped manifests ─────────────────────────────────────────────────────
const COMMUNITY = join(dirname(fileURLToPath(import.meta.url)), '..', 'community');
const readManifest = async (id: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(join(COMMUNITY, id, 'tool.json'), 'utf8')) as Record<string, unknown>;

const designManifest = await readManifest('design');
const studioManifest = (await readManifest('3d-studio')) as unknown as InputManifest;
const boxesInput = (designManifest.inputs as Array<Record<string, unknown>>)
  .find((i) => i.id === 'boxes') as { canvas: Record<string, unknown>; fields: Array<{ id: string }> };
const DESIGN_CFG = boxesInput.canvas;
const DESIGN_FIELDS = boxesInput.fields;
const ADD_KINDS = DESIGN_CFG.addKinds as Array<{ id: string; label?: string; seed?: Record<string, unknown> }>;

// The grammar the scene edit decodes and re-encodes with. The app registers it from the
// first canvas that draws a scene; a test registers it directly, which is also the
// statement that the door reads a REGISTERED manifest rather than guessing at a query.
setSceneManifest(studioManifest);

const STILL_BOXES = designSceneStill.boxes as unknown as Box[];
/** The fixture's 3D box and its scene, as lane T0 wrote them. */
const HERO = STILL_BOXES.find((b) => b.id === 'hero')!;
const HERO_SCENE = String(HERO.scene);

const click = (el: EventTarget): void => { el.dispatchEvent(new W.MouseEvent('click', { bubbles: true })); };
const settle = async (): Promise<void> => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };

// ── the inspector column, on a bare stage against fakes ───────────────────────

interface InspectorFixture {
  el: HTMLElement;
  sections(): string[];
  select(ids: string[]): void;
  opened: string[][];
  destroy(): void;
}

function mountInspector(rows: Box[] = STILL_BOXES): InspectorFixture {
  store.clear();
  const doc = dom.window.document;
  doc.body.innerHTML = '<div id="stage"><div id="tool-canvas"></div></div>';
  const stageEl = doc.getElementById('stage')!;
  const canvasEl = doc.getElementById('tool-canvas')!;

  let boxes = rows.map((b) => ({ ...b }));
  const subs: Array<() => void> = [];
  const opened: string[][] = [];
  let selected: string[] = [];
  const selSubs: Array<(ids: string[]) => void> = [];

  const handle = initDesignInspector({
    stageEl, canvasEl,
    model: {
      blockId: 'boxes',
      cfg: DESIGN_CFG as never,
      frame: { frameField: 'frame', frameKind: 'frame', orderField: 'order', clipChildrenField: 'clipChildren', labelField: 'name' },
      getBoxes: () => boxes as never,
      commit: (next) => { boxes = next as unknown as Box[]; subs.slice().forEach((f) => { f(); }); },
      setField: (ids, field, value) => {
        const want = new Set(ids);
        boxes = boxes.map((b) => (want.has(String(b.id)) ? { ...b, [field]: value } : b));
        subs.slice().forEach((f) => { f(); });
      },
      subscribe: (cb) => { subs.push(cb); return () => { subs.splice(subs.indexOf(cb), 1); }; },
      getInput: () => undefined,
      setInput: () => {},
    },
    selection: {
      get: () => [...selected],
      set: (ids) => { selected = [...ids]; selSubs.slice().forEach((f) => { f([...selected]); }); },
      onChange: (cb) => { selSubs.push(cb); return () => { selSubs.splice(selSubs.indexOf(cb), 1); }; },
    },
    artboard: { active: () => 'board', focus: () => {}, onChange: () => () => {} },
    actions: {
      pickImage: () => {},
      openGradient: () => {},
      arrange: () => {},
      openTimeline: () => {},
      openStudio: (ids) => { opened.push([...ids]); },
    },
    fields: DESIGN_FIELDS,
    fonts: { options: () => [['sans', 'Sans']], weights: () => [['400', 'Regular']] },
  });
  // Built detached: the host owns the berth, so the harness plays the host.
  const slot = doc.createElement('div');
  slot.className = 'edge-dock-slot';
  stageEl.appendChild(slot);
  slot.appendChild(handle.el);

  return {
    el: handle.el,
    sections: () => [...handle.el.querySelectorAll<HTMLElement>('.fc-insp-sec')].map((s) => s.dataset.sec ?? ''),
    select: (ids) => { selected = [...ids]; selSubs.slice().forEach((f) => { f([...selected]); }); },
    opened,
    destroy: () => { handle.destroy(); doc.body.innerHTML = ''; },
  };
}

test('a 3D box shows the Scene section where an image box shows Image', () => {
  const f = mountInspector();
  try {
    f.select(['hero']);
    const scene = f.sections();
    assert.ok(scene.includes('scene'), `the 3D box has a Scene section (saw ${scene.join(', ')})`);
    assert.ok(!scene.includes('image'), 'and no Image section: the renderer would paint over any image set here');
    // Everything an ordinary box carries it keeps: it still moves, paints and arrives.
    for (const sec of ['object', 'fill', 'appearance', 'motion', 'present']) {
      assert.ok(scene.includes(sec), `a scene box keeps its ${sec} section`);
    }
    f.select(['logo']);
    const image = f.sections();
    assert.ok(image.includes('image'), 'the image box still shows Image');
    assert.ok(!image.includes('scene'), 'and never a Scene section');
  } finally { f.destroy(); }
});

test('the Scene section names what the author set, and says when there is nothing', () => {
  const f = mountInspector();
  try {
    f.select(['hero']);
    const body = f.el.querySelector<HTMLElement>('.fc-insp-sec[data-sec="scene"]')!;
    assert.match(body.textContent ?? '', /Words/, 'the source is named');
    assert.match(body.textContent ?? '', /Lolly tools/, 'and so are the scene words');
    assert.ok(body.querySelector('[data-act="editscene"]'), 'the door is there');
  } finally { f.destroy(); }

  const empty = mountInspector(STILL_BOXES.map((b) => (b.id === 'hero' ? { ...b, scene: '' } : b)));
  try {
    empty.select(['hero']);
    const body = empty.el.querySelector<HTMLElement>('.fc-insp-sec[data-sec="scene"]')!;
    assert.match(body.textContent ?? '', /Empty scene/, 'a box with no scene yet says so rather than showing a blank');
  } finally { empty.destroy(); }
});

test('the Edit in 3D Studio door dispatches openStudio with the rows it was built for', () => {
  const f = mountInspector();
  try {
    f.select(['hero']);
    const door = f.el.querySelector<HTMLButtonElement>('[data-act="editscene"]')!;
    assert.match(door.textContent ?? '', /Edit in 3D Studio/);
    click(door);
    assert.deepEqual(f.opened, [['hero']], 'the door opens on the box the section was rendered for');
  } finally { f.destroy(); }
});

// ── the round trip, through the real overlay ──────────────────────────────────

const NATIVE = 1000;
const rect = (left: number, top: number, width: number, height: number): DOMRect => ({
  left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() { return this; },
} as DOMRect);

/** What the embed editor hands back: an expanded query plus the embed's own size params,
 *  exactly as `bridge/compose.ts` mints a tool-sourced asset's identity. */
function editorReturn(values: Record<string, InputValue>): { id: string; meta: { toolUrl: string } } {
  const expanded = serializeUrlState(buildInputModel(studioManifest, { initial: values }), { keepUserIds: true });
  const url = buildEmbedUrl({ toolId: '3d-studio', format: 'png', query: `${expanded}&w=640&h=640` })!;
  return { id: url, meta: { toolUrl: url } };
}

interface CanvasFixture {
  stageEl: HTMLElement;
  design: { inspectorActions: { openStudio(ids: string[]): void } };
  boxes(): Box[];
  commits(): number;
  edits: Array<[string, string]>;
  destroy(): void;
}

function mountCanvas(rows: Box[], edited: (() => unknown | null) | null): CanvasFixture {
  const doc = dom.window.document;
  const viewEl = doc.createElement('div');
  const stageEl = doc.createElement('div');
  const canvasEl = doc.createElement('div');
  stageEl.appendChild(canvasEl);
  viewEl.appendChild(stageEl);
  doc.body.appendChild(viewEl);
  stageEl.getBoundingClientRect = () => rect(0, 0, NATIVE, NATIVE);
  canvasEl.getBoundingClientRect = () => rect(0, 0, NATIVE, NATIVE);

  const model = new Map<string, unknown>([['boxes', rows.map((b) => ({ ...b }))]]);
  const subs: Array<() => void> = [];
  let commits = 0;
  const edits: Array<[string, string]> = [];
  const runtime = {
    getModel: () => [...model.entries()].map(([id, value]) => ({ id, value })),
    setInput(id: string, value: unknown) {
      if (id === 'boxes') commits++;
      model.set(id, value);
      for (const s of subs) s();
    },
    subscribe(fn: () => void) { subs.push(fn); return () => { subs.splice(subs.indexOf(fn), 1); }; },
  };
  const handle = initFreeCanvas({
    viewEl, stageEl, canvasEl,
    runtime: runtime as never,
    host: {} as never,
    input: { id: 'boxes', canvas: DESIGN_CFG as never, fields: DESIGN_FIELDS as never },
    nativeW: NATIVE, nativeH: NATIVE,
    frame: { frameField: 'frame', frameKind: 'frame', orderField: 'order', clipChildrenField: 'clipChildren' },
    setCanvasSize: () => {},
    ...(edited
      ? { editTool: (url: string, mode: string) => { edits.push([url, mode]); return Promise.resolve(edited()); } }
      : {}),
  } as never);
  return {
    stageEl,
    design: handle.design as never,
    boxes: () => model.get('boxes') as Box[],
    commits: () => commits,
    edits,
    destroy() { handle.destroy(); viewEl.remove(); doc.body.innerHTML = ''; },
  };
}

test('the studio round trip writes scene once, canonically, and moves nothing else', async () => {
  // The author changes two things in the studio and applies.
  const next = { ...designSceneDecode(HERO_SCENE, studioManifest), words: 'Ship it', studio: 'electric' };
  const f = mountCanvas(STILL_BOXES, () => editorReturn(next));
  try {
    const before = f.boxes();
    f.design.inspectorActions.openStudio(['hero']);
    await settle();

    assert.equal(f.edits.length, 1, 'the studio was opened once');
    assert.equal(f.edits[0]![1], 'edit', 'in edit mode, like an image box re-opening its source tool');
    assert.equal(f.edits[0]![0], buildEmbedUrl({ toolId: '3d-studio', format: 'png', query: HERO_SCENE }),
      'and opened on the box\'s own scene, not on the studio defaults');

    assert.equal(f.commits(), 1, 'one commit, so one undo step');
    const hero = f.boxes().find((b) => b.id === 'hero')!;
    assert.equal(hero.scene, designSceneEncode(next, studioManifest),
      'the field holds the canonical short query, not the expanded link the editor returned');
    assert.match(String(hero.scene), /words=Ship\+it/, 'the edit is in it');
    assert.doesNotMatch(String(hero.scene), /(^|&)w=/, 'and the embed size params are not');
    assert.ok(String(hero.scene).length < 200,
      `the field stays small (${String(hero.scene).length} bytes), which is what keeps a share link under its cap`);

    // One field moved, on one row: that is what makes the single undo step restore the
    // scene the author came from rather than half a document.
    const changed = f.boxes().flatMap((row, i) => {
      const was = before[i]!;
      return Object.keys({ ...was, ...row }).filter((k) => String(row[k] ?? '') !== String(was[k] ?? ''))
        .map((k) => `${String(row.id)}.${k}`);
    });
    assert.deepEqual(changed, ['hero.scene']);
    assert.equal(before.find((b) => b.id === 'hero')!.scene, HERO_SCENE,
      'and the previous array still holds the old scene, which is what an undo hands back');
  } finally { f.destroy(); }
});

test('cancelling the studio writes nothing at all', async () => {
  const f = mountCanvas(STILL_BOXES, () => null);
  try {
    f.design.inspectorActions.openStudio(['hero']);
    await settle();
    assert.equal(f.edits.length, 1, 'the studio opened');
    assert.equal(f.commits(), 0, 'and a dismissal is not an edit');
    assert.equal(f.boxes().find((b) => b.id === 'hero')!.scene, HERO_SCENE);
  } finally { f.destroy(); }
});

// ── the add menu ──────────────────────────────────────────────────────────────

function pointerEvent(type: string, x: number, y: number): MouseEvent {
  const e = new W.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  for (const [k, value] of [['pointerId', 1], ['pointerType', 'mouse'], ['timeStamp', 0]] as const) {
    Object.defineProperty(e, k, { value });
  }
  return e;
}

test('the Add menu offers 3D scene, seeded from the manifest', async () => {
  const seed = ADD_KINDS.find((k) => k.id === '3d');
  assert.ok(seed, 'the Design manifest declares a 3d add-kind');
  assert.equal(seed!.label, '3D scene');
  assert.equal(seed!.seed?.kind, '3d');
  assert.ok(String(seed!.seed?.scene ?? '').length > 0, 'a new scene box arrives with a scene, never blank');

  const f = mountCanvas([], null);
  try {
    const add = f.stageEl.querySelector<HTMLButtonElement>('.fc-btn-add');
    assert.ok(add, 'the rail has an Add button');
    click(add!);
    await settle();
    const labels = [...f.stageEl.querySelectorAll<HTMLElement>('.fc-pop-item, .fc-pop-gitem')]
      .map((b) => (b.textContent ?? '').trim());
    assert.ok(labels.includes('3D scene'), `the Add menu lists it (saw ${labels.join(', ')})`);
  } finally { f.destroy(); }
});

test('adding a 3D scene opens the studio straight away, on the seeded scene', async () => {
  const seed = ADD_KINDS.find((k) => k.id === '3d')!;
  const f = mountCanvas([], () => null);
  try {
    click(f.stageEl.querySelector<HTMLButtonElement>('.fc-btn-add')!);
    await settle();
    const item = [...f.stageEl.querySelectorAll<HTMLElement>('.fc-pop-item, .fc-pop-gitem')]
      .find((b) => (b.textContent ?? '').trim() === '3D scene')!;
    click(item);
    await settle();
    // A tap places the box at its seeded size, the way a finger does.
    const canvasEl = f.stageEl.firstElementChild!;
    canvasEl.dispatchEvent(pointerEvent('pointerdown', 500, 500));
    canvasEl.dispatchEvent(pointerEvent('pointerup', 500, 500));
    await settle();

    assert.equal(f.boxes().length, 1, 'the box is placed');
    assert.equal(f.boxes()[0]!.kind, '3d');
    // …and the editor is already open on it, so a new scene is not the manifest's badge
    // until somebody happens to find the inspector.
    assert.equal(f.edits.length, 1, 'the studio opened itself');
    assert.equal(f.edits[0]![0],
      buildEmbedUrl({ toolId: '3d-studio', format: 'png', query: String(seed.seed?.scene ?? '') }),
      'on the scene the manifest seeded, not on a blank studio');
  } finally { f.destroy(); }
});
