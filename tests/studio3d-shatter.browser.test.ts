// SPDX-License-Identifier: MPL-2.0
/**
 * 3D Studio burst: the per-triangle shatter (plan 267, lane C).
 *
 * The page drives a renderer of its own, the way collection-preview.ts does (buildStudioScene
 * plus StudioRenderer), so this suite measures shatter.ts without waiting on the motion loop
 * or the pose that lane A and lane B build. It renders a subject at rest, prepares it, bursts
 * it and reads the frames back: paint reaches outside the shape the object drew at rest, much
 * less of that shape is drawn, the cast shadow changes with the burst, a subject over the
 * triangle budget is refused and left alone, two copies of one source hold different bursts,
 * and both an unbursting prepared subject and a cleared one come out byte for byte as the
 * subject did before it was ever prepared.
 *
 * With STUDIO_SHOTS set, a four-step sheet (0, 0.33, 0.66 and 1) is written for the badge and
 * the duck as review evidence.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  type StudioHarness,
  type StudioValues,
  saveShot,
  startStudioHarness,
  studioSkip,
} from './helpers/studio3d-browser.ts';
import { buildMultiMaterialGlb } from './helpers/studio3d-glb.ts';

/** One drawn frame: its PNG, how many pixels carry paint and the box those pixels cover. */
interface FrameFacts {
  label: string;
  png: string;
  drawn: number;
  boundsArea: number;
}

/** What one mesh's geometry looks like after preparation. */
interface MeshFacts {
  prepared: boolean;
  nonIndexed: boolean;
  vertices: number;
  triangles: number;
  /** Largest gap between a stored centroid and the mean of its triangle's three corners. */
  centroidError: number;
  /** True when all three corners of every triangle carry one seed. */
  seedShared: boolean;
  seedMin: number;
  seedMax: number;
  distinctSeeds: number;
}

interface MaskStats {
  /** Mean alpha over the pixels the mask frame drew. */
  maskMean: number;
  maskPixels: number;
  /** Total alpha outside the mask. */
  outside: number;
}

interface DiffFacts {
  total: number;
  left: number;
  right: number;
  worst: number;
}

interface ProbeFacts {
  report: { triangles: number; refused?: string };
  repeated: boolean;
  budget: number;
  sameGeometry: boolean;
  indexed: boolean;
  prepared: boolean;
}

interface ShatterApi {
  open(
    values: StudioValues,
    size?: number
  ): Promise<{ instances: number; meshes: number; shared: boolean }>;
  prepare(): { triangles: number; refused?: string }[];
  facts(): MeshFacts[];
  shared(): boolean;
  set(
    label: string,
    amounts: number[],
    spread: number,
    lift: number,
    opts?: { withoutDepth?: boolean }
  ): FrameFacts;
  clear(label: string): FrameFacts;
  draw(label: string): FrameFacts;
  stats(label: string, maskLabel: string): MaskStats;
  diff(a: string, b: string): DiffFacts;
  probe(segments: number): ProbeFacts;
  close(): void;
}

declare global {
  interface Window {
    /** The burst page API (see extraSource). */
    shatterTest?: ShatterApi;
  }
}

const extraSource = `
import * as BURST_THREE from 'three';
import { StudioRenderer as BurstRenderer } from './shells/web/src/lib/studio3d/renderer.ts';
import { buildStudioScene as burstScene } from './engine/src/studio3d.ts';
import {
  prepareShatter as prepareBurst,
  setShatter as setBurst,
  clearShatter as clearBurst,
  MAX_SHATTER_TRIANGLES as BURST_BUDGET,
} from './shells/web/src/lib/studio3d/shatter.ts';

let burstCanvas = null;
let burstRenderer = null;
let burstSize = 220;
const burstFrames = new Map();

// The placed copies of the renderer. Lane B reaches them through its own Instance list; this
// page reads the same field, so the suite does not wait on the motion integration.
const burstInstances = () => burstRenderer.instances;
const burstMeshes = () => {
  const out = [];
  for (const instance of burstInstances())
    instance.object.traverse((node) => { if (node.isMesh) out.push(node); });
  return out;
};
const materialsOf = (mesh) => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]);
const materialSet = (instance) => {
  const out = new Set();
  instance.object.traverse((node) => { if (node.isMesh) for (const m of materialsOf(node)) out.add(m); });
  return out;
};

const measure = (frame) => {
  const { data, width, height } = frame;
  let drawn = 0, minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] <= 8) continue;
      drawn++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  return { drawn, boundsArea: maxX < 0 ? 0 : (maxX - minX + 1) * (maxY - minY + 1) };
};

const drawFrame = (label) => {
  // The renderer keeps the frame it drew while nothing in its key changed, and the burst is
  // not part of that key on this path, so the key is cleared to ask for a fresh frame.
  burstRenderer.frameKey = '';
  burstRenderer.render(burstSize, burstSize, 'export', 0);
  const copy = document.createElement('canvas');
  copy.width = burstCanvas.width;
  copy.height = burstCanvas.height;
  const ctx = copy.getContext('2d');
  ctx.drawImage(burstCanvas, 0, 0);
  const frame = {
    data: ctx.getImageData(0, 0, copy.width, copy.height).data,
    width: copy.width,
    height: copy.height,
    png: burstCanvas.toDataURL(),
  };
  burstFrames.set(label, frame);
  return { label, png: frame.png, ...measure(frame) };
};

window.shatterTest = {
  async open(values, size = 220) {
    window.shatterTest.close();
    burstSize = size;
    burstCanvas = document.createElement('canvas');
    burstRenderer = new BurstRenderer(burstCanvas);
    const recipe = burstScene({ version: 1, values: { ...studioDefaults, ...values } });
    await burstRenderer.update(recipe, read, shapeText);
    return {
      instances: burstInstances().length,
      meshes: burstMeshes().length,
      shared: window.shatterTest.shared(),
    };
  },
  shared() {
    const list = burstInstances();
    if (list.length < 2) return false;
    const first = materialSet(list[0]);
    for (const material of materialSet(list[1])) if (first.has(material)) return true;
    return false;
  },
  prepare() {
    return burstInstances().map((instance) => prepareBurst(instance.asset));
  },
  facts() {
    return burstMeshes().map((mesh) => {
      const geometry = mesh.geometry;
      const position = geometry.getAttribute('position');
      const centroid = geometry.getAttribute('aCentroid');
      const seed = geometry.getAttribute('aSeed');
      const base = {
        prepared: !!(centroid && seed),
        nonIndexed: geometry.index === null,
        vertices: position.count,
        triangles: Math.floor(position.count / 3),
        centroidError: -1,
        seedShared: false,
        seedMin: -1,
        seedMax: -1,
        distinctSeeds: 0,
      };
      if (!centroid || !seed) return base;
      let error = 0, shared = true, min = 1, max = 0;
      const seeds = new Set();
      for (let i = 0; i + 2 < position.count; i += 3) {
        const cx = (position.getX(i) + position.getX(i + 1) + position.getX(i + 2)) / 3;
        const cy = (position.getY(i) + position.getY(i + 1) + position.getY(i + 2)) / 3;
        const cz = (position.getZ(i) + position.getZ(i + 1) + position.getZ(i + 2)) / 3;
        for (let v = i; v < i + 3; v++) {
          error = Math.max(
            error,
            Math.abs(centroid.getX(v) - cx),
            Math.abs(centroid.getY(v) - cy),
            Math.abs(centroid.getZ(v) - cz)
          );
          if (seed.getX(v) !== seed.getX(i)) shared = false;
        }
        const value = seed.getX(i);
        seeds.add(value);
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
      return { ...base, centroidError: error, seedShared: shared, seedMin: min, seedMax: max, distinctSeeds: seeds.size };
    });
  },
  set(label, amounts, spread, lift, opts = {}) {
    const list = burstInstances();
    amounts.forEach((amount, i) => {
      if (list[i]) setBurst(list[i].object, amount, spread, lift);
    });
    if (!opts.withoutDepth) return drawFrame(label);
    // The same burst with no depth material on any mesh: the colour pass is untouched, so
    // every pixel that moves between the two frames is the cast shadow.
    const held = burstMeshes().map((mesh) => [mesh, mesh.customDepthMaterial]);
    for (const [mesh] of held) mesh.customDepthMaterial = undefined;
    try {
      return drawFrame(label);
    } finally {
      for (const [mesh, material] of held) mesh.customDepthMaterial = material;
    }
  },
  clear(label) {
    for (const instance of burstInstances()) clearBurst(instance.object);
    return drawFrame(label);
  },
  draw: drawFrame,
  stats(label, maskLabel) {
    const frame = burstFrames.get(label), mask = burstFrames.get(maskLabel);
    let inside = 0, count = 0, outside = 0;
    for (let p = 0; p < frame.width * frame.height; p++) {
      const alpha = frame.data[p * 4 + 3];
      if (mask.data[p * 4 + 3] > 8) {
        inside += alpha;
        count++;
      } else outside += alpha;
    }
    return { maskMean: count ? inside / count : 0, maskPixels: count, outside };
  },
  diff(a, b) {
    const x = burstFrames.get(a), y = burstFrames.get(b);
    let total = 0, left = 0, right = 0, worst = 0;
    for (let p = 0; p < x.width * x.height; p++) {
      let delta = 0;
      for (let c = 0; c < 4; c++) delta = Math.max(delta, Math.abs(x.data[p * 4 + c] - y.data[p * 4 + c]));
      if (!delta) continue;
      total++;
      worst = Math.max(worst, delta);
      if (p % x.width < x.width / 2) left++;
      else right++;
    }
    return { total, left, right, worst };
  },
  probe(segments) {
    const geometry = new BURST_THREE.PlaneGeometry(2, 2, segments, segments);
    const mesh = new BURST_THREE.Mesh(geometry, new BURST_THREE.MeshPhysicalMaterial());
    const group = new BURST_THREE.Group();
    group.add(mesh);
    const asset = {
      object: group,
      info: { slots: [], triangles: segments * segments * 2, warnings: [] },
      originals: new Map(),
      dispose() {},
    };
    const report = prepareBurst(asset);
    const again = prepareBurst(asset);
    const facts = {
      report,
      repeated: again.triangles === report.triangles && again.refused === report.refused,
      budget: BURST_BUDGET,
      sameGeometry: mesh.geometry === geometry,
      indexed: mesh.geometry.index !== null,
      prepared: !!mesh.geometry.getAttribute('aCentroid'),
    };
    mesh.geometry.dispose();
    geometry.dispose();
    return facts;
  },
  close() {
    if (burstRenderer) burstRenderer.dispose();
    burstRenderer = null;
    burstCanvas = null;
    burstFrames.clear();
  },
};
`;

const BADGE: StudioValues = { source: 'primitive', primitive: 'badge', outputMode: 'object' };
const TETRA: StudioValues = {
  source: 'model',
  upload: { url: '/tetra.stl', name: 'tetra.stl' },
  outputMode: 'object',
};
const MULTI: StudioValues = {
  source: 'model',
  upload: { url: '/multi.glb', name: 'multi.glb' },
  outputMode: 'object',
};
/** Two copies of one loaded GLB: in source mode both wear the model's own material objects. */
const TWO_DUCKS: StudioValues = {
  source: 'arrangement',
  outputMode: 'object',
  objects: [
    { name: 'Left', kind: 'model', asset: { url: '/duck.glb', name: 'duck.glb' }, x: -1.8 },
    { name: 'Right', kind: 'model', asset: { url: '/duck.glb', name: 'duck.glb' }, x: 1.8 },
  ],
};

const SHEET_STEPS = [0, 0.33, 0.66, 1];

let harness: StudioHarness | undefined;

function studio(): StudioHarness {
  if (!harness) throw new Error('The 3D Studio harness did not start.');
  return harness;
}

describe('3D Studio burst', { skip: studioSkip }, () => {
  before(async () => {
    harness = await startStudioHarness({
      size: 256,
      routes: { '/multi.glb': buildMultiMaterialGlb() },
      extraSource,
    });
  });
  after(async () => {
    await harness?.close();
  });

  it('shatters an extruded badge, an STL and an indexed multi-material GLB', async (t) => {
    const page = await studio().open();
    try {
      for (const [name, values] of [
        ['badge', BADGE],
        ['stl', TETRA],
        ['glb', MULTI],
      ] as [string, StudioValues][]) {
        const facts = await page.evaluate(
          async ({ values }) => {
            const api = window.shatterTest!;
            const opened = await api.open(values);
            const before = api.draw('rest');
            const reports = api.prepare();
            const prepared = api.facts();
            const inert = api.set('inert', [0], 2, 0);
            const burst = api.set('burst', [0.5], 2, 0);
            const cleared = api.clear('cleared');
            return {
              opened,
              reports,
              prepared,
              before,
              inert,
              burst,
              cleared,
              restAlpha: api.stats('rest', 'rest'),
              burstAlpha: api.stats('burst', 'rest'),
            };
          },
          { values }
        );
        t.diagnostic(
          `${name}: ${JSON.stringify({
            triangles: facts.reports.map((r) => r.triangles),
            meshes: facts.prepared.length,
            rest: facts.before.boundsArea,
            burst: facts.burst.boundsArea,
            restMean: Math.round(facts.restAlpha.maskMean),
            burstMean: Math.round(facts.burstAlpha.maskMean),
            restOutside: facts.restAlpha.outside,
            burstOutside: facts.burstAlpha.outside,
          })}`
        );

        // 1. Preparation converts every mesh and reports triangles, with nothing refused.
        assert.equal(facts.reports.length, 1, `${name}: one placed copy`);
        assert.equal(facts.reports[0]!.refused, undefined, `${name}: not refused`);
        assert.ok(facts.reports[0]!.triangles > 0, `${name}: triangles counted`);
        for (const mesh of facts.prepared) {
          assert.equal(mesh.prepared, true, `${name}: attributes added`);
          assert.equal(mesh.nonIndexed, true, `${name}: triangles unshared`);
          assert.equal(mesh.vertices, mesh.triangles * 3, `${name}: three vertices per triangle`);
          assert.ok(mesh.centroidError < 1e-3, `${name}: centroid is the triangle mean`);
          assert.equal(mesh.seedShared, true, `${name}: one seed per triangle`);
          assert.ok(mesh.seedMin >= 0 && mesh.seedMax < 1, `${name}: seeds in [0, 1)`);
          if (mesh.triangles > 4)
            assert.ok(mesh.distinctSeeds > 1, `${name}: seeds differ between triangles`);
        }

        // 2. The burst draws a different picture, and paint reaches outside the shape the
        // object drew at rest, which is the piece flight.
        assert.notEqual(facts.burst.png, facts.before.png, `${name}: the burst redraws`);
        assert.ok(
          facts.burstAlpha.outside > facts.restAlpha.outside + 1000,
          `${name}: pieces reach outside the resting silhouette (${facts.restAlpha.outside} to ${facts.burstAlpha.outside})`
        );
        // A subject of many small triangles also covers a wider box. A subject of a few big
        // ones, the four facets of the harness tetrahedron, does not: each piece shrinks by
        // half while it travels, and half of a facet that spanned the frame is smaller than
        // what it left behind. The silhouette test below is what holds for both.
        if (facts.reports[0]!.triangles > 100)
          assert.ok(
            facts.burst.boundsArea > facts.before.boundsArea * 1.2,
            `${name}: the pieces cover a wider box (${facts.before.boundsArea} to ${facts.burst.boundsArea})`
          );

        // 3. Inside the object's own silhouette there is much less paint than at rest.
        assert.ok(
          facts.burstAlpha.maskMean < facts.restAlpha.maskMean * 0.5,
          `${name}: the silhouette empties (${facts.restAlpha.maskMean} to ${facts.burstAlpha.maskMean})`
        );

        // 4. Amount 0 and a cleared burst are the frame the subject drew before preparation.
        assert.equal(facts.inert.png, facts.before.png, `${name}: amount 0 is inert`);
        assert.equal(facts.cleared.png, facts.before.png, `${name}: clearShatter restores`);
      }
    } finally {
      await page.close();
    }
  });

  it('shatters the cast shadow with the object', async (t) => {
    const page = await studio().open();
    try {
      const facts = await page.evaluate(async () => {
        const api = window.shatterTest!;
        await api.open({ source: 'primitive', primitive: 'badge', outputMode: 'object-shadow' });
        const rest = api.draw('rest');
        api.prepare();
        const inert = api.set('inert', [0], 2, 0);
        const burst = api.set('burst', [0.5], 2, 0);
        const flat = api.set('flat', [0.5], 2, 0, { withoutDepth: true });
        return {
          rest,
          inert,
          burst,
          flat,
          restToBurst: api.diff('rest', 'burst'),
          depth: api.diff('burst', 'flat'),
          inertToRest: api.diff('rest', 'inert'),
        };
      });
      t.diagnostic(`shadow: ${JSON.stringify({ restToBurst: facts.restToBurst, depth: facts.depth })}`);
      assert.equal(facts.inert.png, facts.rest.png, 'amount 0 draws the resting shadow');
      assert.equal(facts.inertToRest.total, 0, 'amount 0 moves no pixel');
      assert.ok(facts.restToBurst.total > 200, 'the frame with its shadow changes with the burst');
      // Both frames draw the same pieces; only the depth material differs, so every pixel
      // that moves is shadow.
      assert.ok(
        facts.depth.total > 100,
        `the shadow follows the pieces (${facts.depth.total} pixels differ from the same burst with no depth material)`
      );
    } finally {
      await page.close();
    }
  });

  it('refuses a subject over the triangle budget and leaves its geometry alone', async (t) => {
    const page = await studio().open();
    try {
      const facts = await page.evaluate(() => {
        const api = window.shatterTest!;
        return { over: api.probe(400), under: api.probe(10) };
      });
      t.diagnostic(`budget: ${JSON.stringify(facts)}`);
      assert.equal(facts.over.report.triangles, 320_000);
      assert.ok(facts.over.report.triangles > facts.over.budget, 'the probe is over the budget');
      assert.match(
        facts.over.report.refused ?? '',
        /Burst gives every triangle a flight of its own, and this object has 320,000 of them, more than the 250,000 the studio can shatter\. Simplify the model, or choose another motion\./
      );
      assert.equal(facts.over.sameGeometry, true, 'the geometry object is the one it was');
      assert.equal(facts.over.indexed, true, 'it is still indexed');
      assert.equal(facts.over.prepared, false, 'no attributes were added');
      assert.equal(facts.over.repeated, true, 'a second prepare reports the same refusal');

      assert.equal(facts.under.report.refused, undefined, 'under the budget it prepares');
      assert.equal(facts.under.report.triangles, 200);
      assert.equal(facts.under.indexed, false);
      assert.equal(facts.under.prepared, true);
      assert.equal(facts.under.repeated, true, 'preparing twice is one conversion');
    } finally {
      await page.close();
    }
  });

  it('holds a different burst on each copy of one loaded source', async (t) => {
    const page = await studio().open();
    try {
      const facts = await page.evaluate(
        async ({ values }) => {
          const api = window.shatterTest!;
          const opened = await api.open(values);
          api.prepare();
          const rest = api.set('rest', [0, 0], 1.2, 0);
          const left = api.set('left', [0.6, 0], 1.2, 0);
          const right = api.set('right', [0, 0.6], 1.2, 0);
          const shared = api.shared();
          const cleared = api.clear('cleared');
          return {
            opened,
            rest,
            shared,
            cleared,
            restToLeft: api.diff('rest', 'left'),
            restToRight: api.diff('rest', 'right'),
            leftToRight: api.diff('left', 'right'),
            leftDrawn: left.drawn,
            rightDrawn: right.drawn,
          };
        },
        { values: TWO_DUCKS }
      );
      t.diagnostic(
        `two copies: ${JSON.stringify({
          opened: facts.opened,
          restToLeft: facts.restToLeft.total,
          restToRight: facts.restToRight.total,
          leftToRight: facts.leftToRight.total,
        })}`
      );
      assert.equal(facts.opened.instances, 2, 'two copies of one source');
      assert.equal(facts.opened.shared, true, 'the copies wear the same GLB materials at rest');
      assert.equal(facts.shared, false, 'each copy gets its own patched materials');
      // One shared set of uniforms would make the second call overwrite the first, so a
      // burst on the first copy alone would draw the resting frame.
      assert.ok(facts.restToLeft.total > 200, 'bursting the first copy alone redraws');
      assert.ok(facts.restToRight.total > 200, 'bursting the second copy alone redraws');
      assert.ok(facts.leftToRight.total > 200, 'the two bursts are not the same picture');
      assert.equal(facts.cleared.png, facts.rest.png, 'clearing both copies restores the frame');
    } finally {
      await page.close();
    }
  });

  it('draws a four-step sheet for review', async (t) => {
    const page = await studio().open();
    try {
      for (const [name, values] of [
        ['badge', { source: 'primitive', primitive: 'badge' }],
        ['duck', { source: 'model', upload: { url: '/duck.glb', name: 'duck.glb' } }],
      ] as [string, StudioValues][]) {
        const sheet = await page.evaluate(
          async ({ values, steps }) => {
            const api = window.shatterTest!;
            await api.open(values, 320);
            api.prepare();
            return steps.map((amount) => ({
              amount,
              frame: api.set(`step-${amount}`, [amount], 2, 1.5),
            }));
          },
          { values, steps: SHEET_STEPS }
        );
        for (const step of sheet) await saveShot(`shatter-${name}-${step.amount}.png`, step.frame.png);
        t.diagnostic(
          `${name} sheet: ${JSON.stringify(sheet.map((step) => [step.amount, step.frame.drawn]))}`
        );
        assert.equal(sheet.length, SHEET_STEPS.length);
        // A studio scene fills the frame, so the sheet is read by its steps being four
        // different pictures rather than by how much paint each one carries.
        assert.equal(
          new Set(sheet.map((step) => step.frame.png)).size,
          SHEET_STEPS.length,
          `${name}: every step draws something of its own`
        );
      }
    } finally {
      await page.close();
    }
  });

  it('has no browser or shader errors', () => {
    // A patched program that does not compile shows up here rather than in a picture: three
    // reports the shader log through the console, which the harness collects from every page.
    assert.deepEqual(studio().errors, []);
  });
});
