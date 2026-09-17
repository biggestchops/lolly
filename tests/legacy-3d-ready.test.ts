// SPDX-License-Identifier: MPL-2.0
/**
 * The two legacy 3D tools: one page holds both, and an error panel is never "ready"
 * (plan 265 milestone 2, E3 and E4).
 *
 * Run with:
 *   node --test tests/legacy-3d-ready.test.ts
 *
 * `3d` and `flythrough` each vendor their own three.js, and the two builds are not
 * interchangeable: `3d` needs the WebGPU build's renderer, `flythrough` the WebGL one.
 * They used to publish both under `window.LollyThree`, so the second tool opened in a
 * session took the first one's library and reported "3D library failed to load." Each
 * bundle now publishes itself as `LollyThreeGpu` or `LollyThreeGl`, and each template
 * takes a global only when it carries the class it needs.
 *
 * Both templates also used to fire `tool:ready` from every failure path, so the batch
 * and export paths photographed the error panel and delivered it as the picture. They
 * now dispatch `tool:failed` with the message, mark the wrapper `data-export-error`
 * (which `host.export.render` refuses), and say nothing about being ready.
 *
 * The templates run for real here, in one jsdom window, with stub three builds and a
 * stub 2D context. The paths jsdom cannot reach - the three inside the GLTF load
 * callback - are driven through the same stub loader.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATES = {
  '3d': readFileSync(resolve(root, 'community/3d/template.html'), 'utf8'),
  flythrough: readFileSync(resolve(root, 'community/flythrough/template.html'), 'utf8'),
};

/** The state each template reads out of its JSON <script>, small but complete enough. */
const STATE = {
  '3d': {
    modelUrl: '/x.glb', width: 240, height: 180, exposure: 1, envIntensity: 1, envRotation: 0,
    shadows: true, camera: { fov: 40, yaw: 0, pitch: 0, distance: 1 }, move: 'none', duration: 3,
  },
  flythrough: {
    shotUrl: '/x.svg', width: 240, height: 180, move: 'none', duration: 3, poses: [{}],
  },
};

/** Split one template into its markup and its single behaviour script. */
function parts(id: keyof typeof TEMPLATES): { html: string; script: string } {
  const raw = TEMPLATES[id];
  const match = /<script>\n([\s\S]*?)<\/script>/.exec(raw);
  assert.ok(match, `${id}: one plain <script> block`);
  return {
    html: raw.replace(match[0], '').replace('{{{_state}}}', JSON.stringify(STATE[id])),
    script: match[1]!,
  };
}

interface Run {
  window: Window & typeof globalThis & Record<string, unknown>;
  /** What the tool said, in order: ready, or failed with its message. */
  events: string[];
  /** Which stub renderer each template actually constructed. */
  built: string[];
  /** The script tags the loader asked for. */
  requested: string[];
  run(id: keyof typeof TEMPLATES): void;
  panel(): string | null;
  exportBlock(): string | null;
}

/**
 * One page that can host both tools. `bundles` says which globals are already present
 * when the template runs; the loader's own <script> insertion is intercepted, and
 * `onLoad` decides what appears (or does not) before it reports success.
 */
function page(bundles: Record<string, unknown>, onLoad?: (w: Record<string, unknown>) => boolean): Run {
  const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', { runScripts: 'outside-only' });
  const w = dom.window as unknown as Run['window'];
  const events: string[] = [];
  const built: string[] = [];
  const requested: string[] = [];

  w.document.addEventListener('tool:ready', () => { events.push('ready'); });
  w.document.addEventListener('tool:failed', (e: Event) => {
    events.push(`failed: ${(e as CustomEvent<{ message?: string }>).detail?.message ?? ''}`);
  });

  // jsdom draws nothing, so hand both templates a 2D context and let them get as far
  // as their renderer. Their own WebGL/WebGPU objects are the stubs below.
  (w.HTMLCanvasElement.prototype as unknown as { getContext: () => unknown }).getContext =
    () => ({ drawImage() {}, clearRect() {}, fillRect() {}, getImageData: () => ({ data: new Uint8ClampedArray(4) }), canvas: null });

  for (const [name, value] of Object.entries(bundles)) w[name] = value;

  // The loader appends a <script src>; nothing is fetched here, so the stub decides
  // what the "bundle" published and whether it loaded at all.
  const head = w.document.head;
  const realAppend = head.appendChild.bind(head);
  (head as unknown as { appendChild: (el: Element) => Element }).appendChild = (el: Element) => {
    if (el.tagName !== 'SCRIPT') return realAppend(el);
    requested.push(el.getAttribute('src') ?? '');
    const script = el as HTMLScriptElement & { onload?: () => void; onerror?: () => void };
    setTimeout(() => {
      const ok = onLoad ? onLoad(w) : false;
      if (ok) script.onload?.();
      else script.onerror?.();
    }, 0);
    return el;
  };

  return {
    window: w,
    events,
    built,
    requested,
    run(id) {
      const { html, script } = parts(id);
      w.document.getElementById('host')!.innerHTML = html;
      w.eval(script);
    },
    panel: () => w.document.querySelector('.lolly3d-msg, .fly-msg')?.textContent ?? null,
    exportBlock: () => w.document.querySelector('[data-export-error]')?.getAttribute('data-export-error') ?? null,
  };
}

/** A three.js stand-in: the class the template checks for, and enough of the rest. */
function stubThree(kind: 'gpu' | 'gl', built: string[], gltf?: { result?: unknown; error?: boolean }) {
  const anyClass = (impl: Record<string, unknown> = {}) => function Any(this: Record<string, unknown>) { Object.assign(this, impl); return this; };
  const vec = () => ({ x: 0, y: 0, z: 0, set() {}, copy() {}, setScalar() {}, clone() { return vec(); }, addScalar() {} });
  const renderer = function Renderer(this: Record<string, unknown>) {
    built.push(kind);
    this.shadowMap = {};
    this.backend = { isWebGPUBackend: kind === 'gpu' };
    this.init = () => Promise.resolve(this);
    this.setPixelRatio = () => {};
    this.setSize = () => {};
    this.setClearColor = () => {};
    this.render = () => {};
    this.dispose = () => {};
    this.renderAsync = () => Promise.resolve();
    return this;
  };
  const three: Record<string, unknown> = {
    Scene: anyClass({ add() {}, traverse() {} }),
    Group: anyClass({ add() {}, position: vec(), rotation: { set() {} }, scale: { setScalar() {} } }),
    PerspectiveCamera: anyClass({ position: vec(), lookAt() {}, updateProjectionMatrix() {} }),
    OrthographicCamera: anyClass({ position: vec(), lookAt() {}, updateProjectionMatrix() {} }),
    PMREMGenerator: anyClass({ fromScene: () => ({ texture: {} }), dispose() {} }),
    RoomEnvironment: anyClass(),
    Euler: anyClass(),
    Clock: anyClass({ getDelta: () => 0, getElapsedTime: () => 0 }),
    Vector2: anyClass(vec()),
    Vector3: anyClass(vec()),
    Box3: anyClass({ setFromObject() { return this; }, isEmpty: () => true, getSize() {}, getCenter() {}, min: vec(), max: vec() }),
    Color: anyClass({ set() {}, getHex: () => 0 }),
    AmbientLight: anyClass({ position: vec() }),
    HemisphereLight: anyClass({ position: vec() }),
    DirectionalLight: anyClass({ position: vec(), shadow: { mapSize: { set() {} }, camera: {} }, target: { position: vec() } }),
    Mesh: anyClass({ position: vec(), rotation: { set() {}, x: 0, y: 0, z: 0 }, scale: vec(), receiveShadow: false, castShadow: false }),
    PlaneGeometry: anyClass(),
    BoxGeometry: anyClass(),
    SphereGeometry: anyClass(),
    ExtrudeGeometry: anyClass({ computeBoundingBox() {}, boundingBox: { min: vec(), max: vec() } }),
    ShapePath: anyClass({ toShapes: () => [] }),
    Shape: anyClass(),
    MeshBasicMaterial: anyClass(),
    MeshStandardMaterial: anyClass(),
    ShadowMaterial: anyClass(),
    CanvasTexture: anyClass({ dispose() {} }),
    TextureLoader: anyClass({ load: () => ({}) }),
    Raycaster: anyClass({ setFromCamera() {}, intersectObjects: () => [] }),
    ACESFilmicToneMapping: 1,
    SRGBColorSpace: 'srgb',
    PCFSoftShadowMap: 2,
    DoubleSide: 2,
    FrontSide: 0,
    GLTFLoader: function Loader(this: Record<string, unknown>) {
      this.load = (_url: string, onDone: (g: unknown) => void, _progress: unknown, onError: (e: Error) => void) => {
        setTimeout(() => {
          if (gltf?.error) onError(new Error('404'));
          else onDone(gltf?.result ?? { scene: null });
        }, 0);
      };
      return this;
    },
  };
  three[kind === 'gpu' ? 'WebGPURenderer' : 'WebGLRenderer'] = renderer;
  return three;
}

const settle = () => new Promise((r) => setTimeout(r, 5));

test('E3: both tools in one page each take their own three build', async () => {
  const built: string[] = [];
  const gpu = stubThree('gpu', built), gl = stubThree('gl', built);
  // The page as it is after `3d` loaded first: it won the old shared name too.
  const p = page({ LollyThreeGpu: gpu, LollyThreeGl: gl, LollyThree: gpu });

  p.run('3d');
  await settle();
  assert.deepEqual(built, ['gpu'], '3d built the WebGPU renderer');

  p.run('flythrough');
  await settle();
  assert.deepEqual(built, ['gpu', 'gl'], 'flythrough found the WebGL build beside it, not the WebGPU one');
  assert.deepEqual(p.requested, [], 'neither had to fetch a bundle');
  assert.ok(!p.events.some((e) => e.includes('library failed')), `no library failure: ${p.events.join(' | ')}`);
});

test('E3: a global carrying the wrong renderer is ignored and the tool loads its own bundle', async () => {
  const built: string[] = [];
  const gpu = stubThree('gpu', built);
  // Only the flythrough build is present, under the old shared name: the `3d` tool
  // must refuse it and ask for its own file, which then publishes LollyThreeGpu.
  const p = page({ LollyThree: stubThree('gl', built) }, (w) => { w.LollyThreeGpu = gpu; return true; });

  p.run('3d');
  await settle();
  assert.deepEqual(p.requested, ['/tools/3d/lib/three.min.js'], 'it fetched its own bundle');
  assert.deepEqual(built, ['gpu'], 'and used the build that bundle published');
  assert.ok(!p.events.some((e) => e.includes('library failed')), `the library was found: ${p.events.join(' | ')}`);
});

test('E3: flythrough refuses a WebGPU-only global the same way', async () => {
  const built: string[] = [];
  const gl = stubThree('gl', built);
  const p = page({ LollyThree: stubThree('gpu', built), LollyThreeGpu: stubThree('gpu', built) }, (w) => { w.LollyThreeGl = gl; return true; });

  p.run('flythrough');
  await settle();
  assert.deepEqual(p.requested, ['/tools/flythrough/lib/three.min.js']);
  assert.deepEqual(built, ['gl']);
});

// ── E4: no failure path says "ready" ────────────────────────────────────────

test('E4 (3d): the bundle loading but carrying no WebGPU renderer fails, and never says ready', async () => {
  const p = page({}, (w) => { w.LollyThreeGpu = { notARenderer: true }; return true; });
  p.run('3d');
  await settle();
  assert.deepEqual(p.events, ['failed: 3D library failed to load.']);
  assert.equal(p.panel(), '3D library failed to load.');
  assert.equal(p.exportBlock(), '3D library failed to load.', 'the wrapper is marked, so host.export refuses it');
});

test('E4 (3d): a bundle that will not load fails, and never says ready', async () => {
  const p = page({}, () => false);
  p.run('3d');
  await settle();
  assert.deepEqual(p.events, ['failed: 3D library failed to load.']);
});

test('E4 (3d): an init error fails with its own message', async () => {
  const built: string[] = [];
  const broken = stubThree('gpu', built);
  broken.PMREMGenerator = function Broken() { throw new Error('no environment here'); };
  const p = page({ LollyThreeGpu: broken });
  p.run('3d');
  await settle();
  assert.deepEqual(p.events, ['failed: no environment here']);
  assert.equal(p.exportBlock(), 'no environment here');
});

test('E4 (3d): a model with no scene fails', async () => {
  const built: string[] = [];
  const p = page({ LollyThreeGpu: stubThree('gpu', built, { result: { scene: null, scenes: [] } }) });
  p.run('3d');
  await settle();
  assert.deepEqual(p.events, ['failed: Model has no scene.']);
});

test('E4 (3d): a model with no visible geometry fails', async () => {
  const built: string[] = [];
  const p = page({ LollyThreeGpu: stubThree('gpu', built, { result: { scene: { traverse() {}, position: { x: 0, y: 0, z: 0 } } } }) });
  p.run('3d');
  await settle();
  assert.deepEqual(p.events, ['failed: Model has no visible geometry.'], 'the empty bounding box is refused');
});

test('E4 (3d): a model that will not load fails', async () => {
  const built: string[] = [];
  const p = page({ LollyThreeGpu: stubThree('gpu', built, { error: true }) });
  p.run('3d');
  await settle();
  assert.deepEqual(p.events, ['failed: Could not load the model.']);
});

test('E4 (flythrough): the bundle carrying no WebGL renderer fails, and never says ready', async () => {
  const p = page({}, (w) => { w.LollyThreeGl = { notARenderer: true }; return true; });
  p.run('flythrough');
  await settle();
  assert.deepEqual(p.events, ['failed: 3D library failed to load.']);
  assert.equal(p.exportBlock(), '3D library failed to load.');
});

test('E4 (flythrough): a bundle that will not load fails', async () => {
  const p = page({}, () => false);
  p.run('flythrough');
  await settle();
  assert.deepEqual(p.events, ['failed: 3D library failed to load.']);
});

test('E4 (flythrough): an init error fails with its own message', async () => {
  const built: string[] = [];
  const broken = stubThree('gl', built);
  broken.Scene = function Broken() { throw new Error('scene refused'); };
  const p = page({ LollyThreeGl: broken });
  p.run('flythrough');
  await settle();
  assert.deepEqual(p.events, ['failed: scene refused']);
});

test('E4: every failure site in both templates calls fail(), and only the success path says ready', () => {
  for (const [id, source] of Object.entries(TEMPLATES)) {
    // One call, on the path where a frame was actually drawn.
    assert.equal((source.match(/fireReady\(\);/g) ?? []).length, 1, `${id}: one fireReady() call site`);
    assert.match(source, /new CustomEvent\('tool:failed'/, `${id}: dispatches tool:failed`);
    assert.match(source, /setAttribute\('data-export-error', txt\)/, `${id}: marks the wrapper`);
    assert.ok(!/message\([^)]*\);\s*fireReady\(\)/.test(source), `${id}: no error path reports ready`);
  }
});

// ── E4: the shell half, waitForQuiescence ───────────────────────────────────

test('E4: waitForQuiescence resolves on tool:ready and rejects on tool:failed', async () => {
  const { waitForQuiescence } = await import('../shells/web/src/lib/render-lifecycle.ts');
  const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>');
  const g = globalThis as Record<string, unknown>;
  const saved = { doc: g.document, win: g.window, mo: g.MutationObserver };
  // jsdom ships no FontFaceSet, and the wait starts by awaiting document.fonts.ready.
  Object.defineProperty(dom.window.document, 'fonts', { value: { ready: Promise.resolve() }, configurable: true });
  g.document = dom.window.document;
  g.window = dom.window;
  g.MutationObserver = dom.window.MutationObserver;
  try {
    const node = dom.window.document.getElementById('host')!;

    (dom.window as unknown as { __toolHasReadySignal?: boolean }).__toolHasReadySignal = true;
    const ready = waitForQuiescence(node, { silenceMs: 5, timeoutMs: 4000 });
    await settle();                                   // the wait registers its listeners first
    dom.window.document.dispatchEvent(new dom.window.CustomEvent('tool:ready'));
    await ready;

    (dom.window as unknown as { __toolHasReadySignal?: boolean }).__toolHasReadySignal = true;
    const failed = waitForQuiescence(node, { silenceMs: 5, timeoutMs: 4000 });
    await settle();
    dom.window.document.dispatchEvent(
      new dom.window.CustomEvent('tool:failed', { detail: { message: 'Could not load the model.' } }),
    );
    await assert.rejects(failed, /Could not load the model\./, 'the batch and export paths see a failure, not a settled panel');

    // A tool that says nothing about readiness is untouched: silence still settles it.
    await waitForQuiescence(node, { silenceMs: 5, timeoutMs: 2000 });
  } finally {
    g.document = saved.doc; g.window = saved.win; g.MutationObserver = saved.mo;
  }
});
