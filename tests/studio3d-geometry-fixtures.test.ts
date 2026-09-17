// SPDX-License-Identifier: MPL-2.0
/**
 * Geometry fixtures for 3D Studio artwork (plan 265, B1).
 *
 * Each SVG in tests/fixtures/studio3d/geometry goes through the real loader
 * (loadStudioSource, source kind svg) at smoothness 24 and the default depth, with
 * bevel requests of 0.025 and 0.05 studio units. The checks read the finished meshes:
 * ray probes in SVG user space, one mesh per shape, holes counted from the closed
 * surface (a closed surface of genus g has V - E + F = 2 - 2g, and an extruded shape
 * with h holes has genus h), material groups, the applied bevel measured from the
 * z extent, finite positions, cap orientation (a cap triangle with no area faces no way
 * and is allowed, but its normals must still have a direction), and that every edge is
 * shared by exactly two triangles once vertices are merged by position.
 *
 * STUDIO_SUSE=1 adds the six private SUSE icons at both requests with the same mesh checks,
 * and prints each shape's applied bevel and the load time (printed, never asserted).
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import * as THREE from 'three';
import { buildStudioScene } from '../engine/src/studio3d.ts';
import { createNodeTextAPI } from '../packages/node-shell/src/text.ts';
import {
  loadStudioSource,
  type StudioAsset,
  type StudioShaper,
} from '../shells/web/src/lib/studio3d/source.ts';
import { inlineClassFills, installStudioDom, loadSvgFixture } from './helpers/studio3d-dom.ts';

const root = resolve(import.meta.dirname, '..');
const dir = join(root, 'tests/fixtures/studio3d/geometry');
const REQUESTS = [0.025, 0.05];
const DEPTH = 0.25;
const REDUCED = /bevel reduced/;

interface Fixture {
  file: string;
  /** Holes in each shape, in ascending order; the length is the shape count. */
  holes: number[];
  /** SVG user-space points that must hit a solid; the third entry names the paint when it matters. */
  hits: [number, number, string?][];
  /** SVG user-space points that must miss every solid. */
  misses: [number, number][];
  /** full: the applied bevel equals each request with no note. reduced: smaller, with a note. */
  bevel: 'full' | 'reduced';
}

const GREEN = 'paint:#30ba78',
  DARK = 'paint:#0c322c';

const FIXTURES: Fixture[] = [
  {
    file: 'ring-opposite.svg',
    holes: [1],
    hits: [
      [20, 5],
      [34, 20],
      [20, 35],
    ],
    misses: [
      [20, 20],
      [14, 20],
      [20, 26],
    ],
    bevel: 'full',
  },
  {
    file: 'ring-same-nonzero.svg',
    holes: [0],
    hits: [
      [20, 20],
      [20, 5],
      [14, 20],
    ],
    misses: [
      [1, 1],
      [39, 39],
    ],
    bevel: 'full',
  },
  {
    file: 'ring-same-evenodd.svg',
    holes: [1],
    hits: [
      [20, 5],
      [6, 20],
    ],
    misses: [
      [20, 20],
      [26, 20],
    ],
    bevel: 'full',
  },
  {
    file: 'disc-two-holes.svg',
    holes: [2],
    hits: [
      [20, 20],
      [20, 6],
      [4, 20],
      [36, 20],
    ],
    misses: [
      [12, 20],
      [28, 20],
      [10, 18],
    ],
    bevel: 'full',
  },
  {
    file: 'disc-four-holes.svg',
    holes: [4],
    hits: [
      [20, 20],
      [20, 5],
      [13, 20],
      [27, 20],
    ],
    misses: [
      [13, 13],
      [27, 13],
      [13, 27],
      [27, 27],
    ],
    bevel: 'full',
  },
  {
    file: 'letter-b-straight.svg',
    holes: [2],
    hits: [
      [11, 20],
      [20, 20],
      [20, 7],
      [29, 13],
      [20, 33, DARK],
    ],
    misses: [
      [19, 13.5],
      [19, 26.5],
      [34, 20],
    ],
    bevel: 'full',
  },
  {
    file: 'letter-b-curved.svg',
    holes: [2],
    hits: [
      [11, 20],
      [18, 19],
      [18, 7],
      [27, 12],
      [18, 33],
    ],
    misses: [
      [18, 13],
      [19, 26],
      [30, 3],
    ],
    bevel: 'full',
  },
  {
    file: 'letter-b-outfit.svg',
    holes: [2],
    hits: [
      [13.8, 20],
      [20, 19.3],
      [20, 8],
      [28.5, 26],
      [20, 31.5],
    ],
    misses: [
      [20, 13.8],
      [21, 25.4],
      [34, 20],
    ],
    bevel: 'full',
  },
  {
    file: 'nested-four.svg',
    holes: [1, 1],
    hits: [
      [20, 4.5],
      [20, 14],
      [26, 20],
    ],
    misses: [
      [20, 20],
      [20, 9.5],
      [30.5, 20],
    ],
    bevel: 'full',
  },
  {
    file: 'outline-icon.svg',
    holes: [0, 1, 1],
    hits: [
      [8, 20],
      [32, 20],
      [20, 8],
      [14, 20],
      [20, 20],
    ],
    misses: [
      [11, 20],
      [12, 12],
      [2, 2],
      [17, 20],
    ],
    bevel: 'full',
  },
  {
    file: 'concave-slot.svg',
    holes: [0],
    hits: [
      [12, 20],
      [28, 20],
      [20, 31.85],
    ],
    misses: [
      [20, 20],
      [20, 6],
    ],
    bevel: 'reduced',
  },
  {
    file: 'acute-v.svg',
    holes: [0],
    hits: [
      [14.15, 20],
      [25.85, 20],
    ],
    misses: [
      [20, 20],
      [12, 20],
    ],
    bevel: 'reduced',
  },
  {
    file: 'degenerate.svg',
    holes: [0, 0],
    hits: [
      [12, 12],
      [30, 26],
    ],
    misses: [
      [6, 2],
      [20, 20],
      [5, 35],
      [26, 30],
    ],
    bevel: 'full',
  },
  {
    file: 'in-line-union.svg',
    holes: [0],
    hits: [
      [15, 15],
      [28, 4.5],
      [8, 29],
    ],
    misses: [
      [28, 10],
      [4, 15],
      [20, 2],
    ],
    bevel: 'full',
  },
  {
    file: 'two-colours.svg',
    holes: [0, 0],
    hits: [
      [14, 20, GREEN],
      [26, 20, DARK],
      [19.9, 20, GREEN],
      [20.1, 20, DARK],
    ],
    misses: [
      [6, 20],
      [34, 20],
    ],
    bevel: 'full',
  },
  {
    file: 'transformed-group.svg',
    holes: [1],
    hits: [
      [26, 11.5],
      [35, 20],
    ],
    misses: [
      [26, 20],
      [12, 20],
      [14, 11.5],
    ],
    bevel: 'full',
  },
];

function meshesOf(asset: StudioAsset): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  asset.object.traverse((node) => {
    if (node instanceof THREE.Mesh) meshes.push(node);
  });
  return meshes;
}

function paintOf(mesh: THREE.Mesh): string {
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  return material?.name ?? '';
}

/** Paints hit by a ray straight down the extrusion axis at an SVG user-space point. */
function probe(meshes: THREE.Mesh[], x: number, y: number): string[] {
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const ray = new THREE.Raycaster(new THREE.Vector3(x, y, 1e3), new THREE.Vector3(0, 0, -1));
  const found: string[] = [];
  for (const mesh of meshes) {
    const local = new THREE.Mesh(mesh.geometry, material);
    local.updateMatrixWorld(true);
    if (ray.intersectObject(local).length) found.push(paintOf(mesh));
  }
  material.dispose();
  return found;
}

interface MeshReport {
  paint: string;
  groups: number[];
  /** Applied bevel in studio units, from the z extent. */
  bevel: number;
  finite: boolean;
  triangles: number;
  /** Cap triangles at the lowest z facing +z or at the highest z facing -z. */
  capsFlipped: number;
  /** Cap triangles with no area in 32-bit positions; they face no way and are allowed. */
  capsFlat: number;
  /** Cap triangles at neither end. */
  capsOffEnds: number;
  /** Vertex normals that are not finite or have no length (they shade as NaN). */
  badNormals: number;
  /** Edges shared by other than two triangles, after merging vertices. */
  openEdges: number;
  /** Triangles that lose a vertex to the merge. */
  collapsed: number;
  /** Genus of the closed surface, which is the hole count of an extruded shape. */
  genus: number;
}

/** Read one finished mesh; `scale` is the loader's source-to-studio scale. */
function inspectMesh(mesh: THREE.Mesh, scale: number): MeshReport {
  const geometry = mesh.geometry,
    p = geometry.getAttribute('position'),
    n = geometry.getAttribute('normal');
  let badNormals = 0;
  for (let i = 0; i < n.count; i++) {
    const length = n.getX(i) ** 2 + n.getY(i) ** 2 + n.getZ(i) ** 2;
    if (!(length > 0 && Number.isFinite(length))) badNormals++;
  }
  let finite = true,
    low = Infinity,
    high = -Infinity;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) finite = false;
    low = Math.min(low, z);
    high = Math.max(high, z);
  }
  const cap = geometry.groups.find((g) => g.materialIndex === 0);
  let capsFlipped = 0,
    capsFlat = 0,
    capsOffEnds = 0;
  const epsilon = (high - low) * 1e-6;
  if (cap)
    for (let i = cap.start; i < cap.start + cap.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(p, i),
        b = new THREE.Vector3().fromBufferAttribute(p, i + 1),
        c = new THREE.Vector3().fromBufferAttribute(p, i + 2);
      const normal = b.clone().sub(a).cross(c.clone().sub(a));
      const top = Math.min(a.z, b.z, c.z) > high - epsilon,
        bottom = Math.max(a.z, b.z, c.z) < low + epsilon;
      if (!top && !bottom) capsOffEnds++;
      else if (normal.lengthSq() === 0) capsFlat++;
      else if (top ? !(normal.z > 0) : !(normal.z < 0)) capsFlipped++;
    }
  const ids = new Map<string, number>();
  const id = (i: number) => {
    const key = [p.getX(i), p.getY(i), p.getZ(i)].map((v) => Math.round(v / 1e-6)).join(',');
    const known = ids.get(key);
    if (known !== undefined) return known;
    ids.set(key, ids.size);
    return ids.size - 1;
  };
  const edges = new Map<string, number>();
  let collapsed = 0;
  for (let i = 0; i < p.count; i += 3) {
    const t = [id(i), id(i + 1), id(i + 2)];
    if (new Set(t).size < 3) {
      collapsed++;
      continue;
    }
    for (let k = 0; k < 3; k++) {
      const u = t[k]!,
        v = t[(k + 1) % 3]!;
      const key = u < v ? `${u}:${v}` : `${v}:${u}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  const openEdges = [...edges.values()].filter((n) => n !== 2).length;
  const faces = p.count / 3 - collapsed;
  const euler = ids.size - edges.size + faces;
  return {
    paint: paintOf(mesh),
    groups: geometry.groups.map((g) => g.materialIndex ?? -1),
    bevel: ((high - low) * scale - DEPTH) / 2,
    finite,
    triangles: p.count / 3,
    capsFlipped,
    capsFlat,
    capsOffEnds,
    badNormals,
    openEdges,
    collapsed,
    genus: (2 - euler) / 2,
  };
}

function scaleOf(asset: StudioAsset): number {
  const raw = asset.object.children[0]!;
  return raw.scale.x;
}

function svg(file: string): string {
  return readFileSync(join(dir, file), 'utf8');
}

/** Close enough for a bevel read back from 32-bit positions. */
function sameBevel(applied: number, requested: number): boolean {
  return Math.abs(applied - requested) <= requested * 1e-4;
}

installStudioDom();

for (const fixture of FIXTURES)
  test(`geometry fixture ${fixture.file}`, async (t) => {
    for (const request of REQUESTS) {
      const asset = await loadSvgFixture(svg(fixture.file), { bevel: request });
      const where = `${fixture.file} at ${request}`;
      try {
        const meshes = meshesOf(asset),
          scale = scaleOf(asset);
        const reports = meshes.map((mesh) => inspectMesh(mesh, scale));
        t.diagnostic(
          `${request}: applied ${reports.map((r) => r.bevel.toPrecision(3)).join(', ')}; ${reports.map((r) => r.triangles).join(', ')} triangles`
        );
        assert.equal(meshes.length, fixture.holes.length, `${where}: shape count`);
        assert.deepEqual(
          reports.map((r) => r.genus).sort((a, b) => a - b),
          fixture.holes,
          `${where}: holes per shape`
        );
        for (const [x, y, paint] of fixture.hits) {
          const found = probe(meshes, x, y);
          assert.ok(found.length > 0, `${where}: (${x}, ${y}) should hit a solid`);
          if (paint) assert.deepEqual(found, [paint], `${where}: (${x}, ${y}) paint`);
        }
        for (const [x, y] of fixture.misses)
          assert.deepEqual(probe(meshes, x, y), [], `${where}: (${x}, ${y}) should miss`);
        for (const r of reports) {
          const label = `${where} ${r.paint}`;
          assert.ok(r.finite, `${label}: every position is finite`);
          assert.equal(r.collapsed, 0, `${label}: no triangle collapses when vertices merge`);
          assert.equal(r.openEdges, 0, `${label}: every edge is shared by two triangles`);
          assert.equal(r.capsOffEnds, 0, `${label}: cap triangles are at the two ends`);
          assert.equal(r.capsFlipped, 0, `${label}: caps face out`);
          assert.equal(r.badNormals, 0, `${label}: every normal has a direction`);
          if (r.bevel > 1e-6) assert.deepEqual(r.groups, [0, 1, 2], `${label}: surface groups`);
        }
        const notes = asset.info.warnings.filter((w) => REDUCED.test(w));
        const applied = reports.map((r) => r.bevel);
        if (fixture.bevel === 'full') {
          assert.deepEqual(notes, [], `${where}: no bevel note`);
          for (const value of applied)
            assert.ok(
              sameBevel(value, request),
              `${where}: applied ${value}, requested ${request}`
            );
        } else {
          assert.ok(notes.length > 0, `${where}: a reduction carries a note`);
          assert.ok(
            applied.some((value) => value < request * 0.99),
            `${where}: applied ${applied.join(', ')} should be below ${request}`
          );
        }
      } finally {
        asset.dispose();
      }
    }
  });

test('a cap triangle with no area takes the normal of its cap', async () => {
  const asset = await loadSvgFixture(svg('in-line-union.svg'), { bevel: 0.025 });
  try {
    const [mesh] = meshesOf(asset);
    assert.ok(mesh);
    const scale = scaleOf(asset);
    const report = inspectMesh(mesh, scale);
    assert.ok(report.capsFlat > 0, 'the fixture still gives the cap a triangle with no area');
    const p = mesh.geometry.getAttribute('position'),
      n = mesh.geometry.getAttribute('normal'),
      cap = mesh.geometry.groups[0]!;
    const middle = DEPTH / scale / 2;
    let checked = 0;
    for (let i = cap.start; i < cap.start + cap.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(p, i),
        b = new THREE.Vector3().fromBufferAttribute(p, i + 1),
        c = new THREE.Vector3().fromBufferAttribute(p, i + 2);
      if (b.clone().sub(a).cross(c.clone().sub(a)).lengthSq() !== 0) continue;
      for (let j = i; j < i + 3; j++) {
        assert.deepEqual([n.getX(j), n.getY(j), n.getZ(j)], [0, 0, p.getZ(j) > middle ? 1 : -1]);
        checked++;
      }
    }
    assert.equal(checked, report.capsFlat * 3);
  } finally {
    asset.dispose();
  }
});

test('the Outfit B fixture is the outline its comment records', async () => {
  const text = svg('letter-b-outfit.svg');
  const font = readFileSync(join(root, 'shells/web/public/fonts/Outfit[wght].ttf'));
  const hash = createHash('sha256').update(font).digest('hex');
  assert.ok(text.includes(`SHA-256 ${hash}`), 'the font file changed since the outline was made');
  const { d } = await createNodeTextAPI({ repoRoot: root }).toPath({
    text: 'B',
    fontUrl: '/fonts/Outfit[wght].ttf',
    fontSize: 40,
    variations: ['wght=700'],
  });
  let i = 0;
  const moved = d.replace(/-?[0-9.]+/g, (n) =>
    String(Math.round((Number(n) + (i++ % 2 ? 34 : 8)) * 100) / 100)
  );
  assert.ok(text.includes(`d="${moved}"`), 'the committed path matches a fresh outline');
});

/** The real host text API as the studio shaper, always on the Outfit face. */
function outfitShaper(): StudioShaper {
  const api = createNodeTextAPI({ repoRoot: root });
  return async (line, font, fontSize) => {
    const shaped = await api.toPath({
      text: line,
      fontUrl: '/fonts/Outfit[wght].ttf',
      fontSize,
      letterSpacing: font.tracking * fontSize,
      variations: [`wght=${font.weight}`],
    });
    return { d: shaped.d, advance: shaped.advanceWidth };
  };
}

test('words show the finer-bevel note only when a letter is really reduced', async () => {
  const load = async (words: string, bevel: number, depth = DEPTH) => {
    const scene = buildStudioScene({
      version: 1,
      values: { source: 'text', words, wordWeight: 700, shape: { bevel, depth } },
    });
    return loadStudioSource(
      scene,
      async () => new Uint8Array(),
      new AbortController().signal,
      outfitShaper()
    );
  };
  const note = /finer bevel than requested/;
  for (const bevel of REQUESTS) {
    const word = await load('B', bevel);
    try {
      assert.deepEqual(
        word.info.warnings.filter((w) => note.test(w) || REDUCED.test(w)),
        [],
        `B at ${bevel}`
      );
      const scale = scaleOf(word);
      for (const mesh of meshesOf(word))
        assert.ok(sameBevel(inspectMesh(mesh, scale).bevel, bevel), `B at ${bevel}`);
    } finally {
      word.dispose();
    }
  }
  // A long word makes each letter thin next to the whole, so the maximum bevel is reduced.
  const long = await load('Illumination', 0.15, 2);
  try {
    assert.equal(long.info.warnings.filter((w) => note.test(w)).length, 1);
    assert.equal(long.info.warnings.filter((w) => REDUCED.test(w)).length, 0);
  } finally {
    long.dispose();
  }
});

const SUSE_ICONS = join(root, 'brands/suse/catalog/assets/suse/icons');

test('private SUSE icons keep a bevel on every shape', {
  skip:
    (!process.env.STUDIO_SUSE && 'STUDIO_SUSE is not set; private SUSE fixtures are opt-in.') ||
    (!existsSync(SUSE_ICONS) && 'The private SUSE brand pack is not checked out.'),
}, async (t) => {
  for (const id of ['security', 'database', 'linux', 'brain', 'lightbulb', 'network'])
    for (const request of REQUESTS) {
      const text = inlineClassFills(readFileSync(join(SUSE_ICONS, `icon-${id}.svg`), 'utf8'));
      const started = performance.now();
      const asset = await loadSvgFixture(text, { bevel: request });
      const elapsed = performance.now() - started;
      try {
        const scale = scaleOf(asset);
        const reports = meshesOf(asset).map((mesh) => inspectMesh(mesh, scale));
        t.diagnostic(
          `${id} at ${request}: ${elapsed.toFixed(1)} ms, applied ${reports.map((r) => `${r.paint.slice(6)} ${r.bevel.toFixed(5)}`).join(', ')}`
        );
        for (const r of reports) {
          const label = `${id} at ${request} ${r.paint}`;
          assert.ok(r.finite, `${label}: finite`);
          assert.equal(r.collapsed, 0, `${label}: no triangle collapses`);
          assert.equal(r.openEdges, 0, `${label}: closed`);
          assert.equal(r.capsOffEnds + r.capsFlipped, 0, `${label}: caps face out`);
          assert.equal(r.badNormals, 0, `${label}: every normal has a direction`);
          // The plan asks for a bevel on every shape at the default request only.
          if (request === 0.025)
            assert.deepEqual(r.groups, [0, 1, 2], `${label}: has a bevel group`);
        }
      } finally {
        asset.dispose();
      }
    }
});

import { STUDIO_ICONS, studioIconPath } from './helpers/studio3d-icons.ts';

/**
 * The twelve public icon fixtures (plan 265 milestone 2, T0), through the checks above.
 *
 * They stand in for a brand icon family in the collection work, so what matters here is
 * that each one really extrudes: the right number of shapes, the holes the drawing has,
 * a closed surface, caps that face out, and the full bevel at both requests with no
 * reduction note. The set was drawn for that last point (no detail under about three
 * units, no corner sharper than about 45 degrees, deep overlaps where one colour meets
 * itself), so a note appearing here means an icon changed, not that the studio did.
 */
type IconCase = Pick<Fixture, 'file' | 'holes' | 'hits' | 'misses'>;

const ICON_CASES: IconCase[] = [
  {
    file: 'bolt-ring.svg',
    holes: [0, 1],
    hits: [
      [20, 4, GREEN],
      [4, 20, GREEN],
      [36, 20, GREEN],
      [20, 20, DARK],
    ],
    misses: [
      [11, 20],
      [20, 29],
      [1, 20],
    ],
  },
  {
    file: 'gear.svg',
    holes: [0, 1],
    hits: [
      [20, 4, GREEN],
      [4, 20, GREEN],
      [20, 20, DARK],
    ],
    misses: [
      [20, 14],
      [6, 6],
      [1, 20],
    ],
  },
  {
    file: 'leaf.svg',
    holes: [0, 1],
    hits: [
      [10, 27, GREEN],
      [27, 17, GREEN],
      [20, 20, DARK],
    ],
    misses: [
      [4, 20],
      [34, 20],
      [30, 30],
      [10, 10],
    ],
  },
  {
    file: 'play.svg',
    holes: [0, 1],
    hits: [
      [10, 20, DARK],
      [30, 20, DARK],
      [20, 8, DARK],
      [20, 20, GREEN],
    ],
    misses: [
      [4, 20],
      [20, 4],
      [7, 7],
    ],
  },
  {
    file: 'cloud.svg',
    holes: [0, 1],
    hits: [
      [20, 10, DARK],
      [8, 20, DARK],
      [28, 20, DARK],
      [19, 20, GREEN],
    ],
    misses: [
      [20, 5],
      [2, 20],
      [20, 31],
    ],
  },
  {
    file: 'padlock.svg',
    holes: [0, 1],
    hits: [
      [20, 34, GREEN],
      [10, 30, GREEN],
      [20, 21.5, GREEN],
      [15, 17, DARK],
      [24, 17, DARK],
    ],
    misses: [
      [20, 27],
      [20, 15],
      [4, 20],
    ],
  },
  {
    file: 'magnifier.svg',
    holes: [0, 1],
    hits: [
      [16.5, 6, DARK],
      [6, 16.5, DARK],
      [32, 32, DARK],
      [16.5, 16.5, GREEN],
    ],
    misses: [
      [10, 16.5],
      [30, 16.5],
      [16.5, 30],
    ],
  },
  {
    file: 'bell.svg',
    holes: [0, 0],
    hits: [
      [20, 10, GREEN],
      [10, 26, GREEN],
      [20, 31, DARK],
    ],
    misses: [
      [20, 27.5],
      [6, 20],
      [32, 26],
    ],
  },
  {
    file: 'house.svg',
    holes: [0, 1],
    hits: [
      [20, 12, GREEN],
      [6, 30, GREEN],
      [34, 22, GREEN],
      [20, 23, DARK],
    ],
    misses: [
      [20, 6],
      [6, 12],
      [34, 34],
    ],
  },
  {
    file: 'pin.svg',
    holes: [0, 1],
    hits: [
      [20, 7, GREEN],
      [9, 17, GREEN],
      [20, 33, GREEN],
      [20, 16, DARK],
    ],
    misses: [
      [20, 2],
      [8, 30],
      [34, 17],
    ],
  },
  {
    file: 'chat.svg',
    holes: [0, 0, 0, 3],
    hits: [
      [20, 12, GREEN],
      [14, 31, GREEN],
      [13, 18, DARK],
      [20, 18, DARK],
      [27, 18, DARK],
    ],
    misses: [
      [20, 4],
      [2, 18],
      [20, 32],
    ],
  },
  {
    file: 'star.svg',
    holes: [0, 1],
    hits: [
      [20, 5, GREEN],
      [5, 15, GREEN],
      [12, 32, GREEN],
      [20, 20, DARK],
    ],
    misses: [
      [20, 32],
      [4, 30],
      [20, 1],
    ],
  },
];

for (const icon of STUDIO_ICONS)
  test(`icon fixture ${icon.file} (${icon.weight})`, async (t) => {
    const fixture = ICON_CASES.find((entry) => entry.file === icon.file);
    assert.ok(fixture, `${icon.file} is in STUDIO_ICONS with no case here`);
    const text = readFileSync(studioIconPath(icon.file), 'utf8');
    assert.ok(text.includes('SPDX-License-Identifier: MPL-2.0'), `${icon.file}: licence comment`);
    for (const request of REQUESTS) {
      const asset = await loadSvgFixture(text, { bevel: request });
      const where = `${icon.file} at ${request}`;
      try {
        const meshes = meshesOf(asset),
          scale = scaleOf(asset);
        const reports = meshes.map((mesh) => inspectMesh(mesh, scale));
        t.diagnostic(
          `${request}: applied ${reports.map((r) => r.bevel.toPrecision(3)).join(', ')}; ${reports.map((r) => r.triangles).join(', ')} triangles`
        );
        assert.equal(meshes.length, fixture.holes.length, `${where}: shape count`);
        assert.deepEqual(
          reports.map((r) => r.genus).sort((a, b) => a - b),
          fixture.holes,
          `${where}: holes per shape`
        );
        for (const [x, y, paint] of fixture.hits) {
          const found = probe(meshes, x, y);
          assert.ok(found.length > 0, `${where}: (${x}, ${y}) should hit a solid`);
          if (paint) assert.deepEqual(found, [paint], `${where}: (${x}, ${y}) paint`);
        }
        for (const [x, y] of fixture.misses)
          assert.deepEqual(probe(meshes, x, y), [], `${where}: (${x}, ${y}) should miss`);
        for (const r of reports) {
          const label = `${where} ${r.paint}`;
          assert.ok(r.finite, `${label}: every position is finite`);
          assert.equal(r.collapsed, 0, `${label}: no triangle collapses when vertices merge`);
          assert.equal(r.openEdges, 0, `${label}: every edge is shared by two triangles`);
          assert.equal(r.capsOffEnds, 0, `${label}: cap triangles are at the two ends`);
          assert.equal(r.capsFlipped, 0, `${label}: caps face out`);
          assert.equal(r.badNormals, 0, `${label}: every normal has a direction`);
          if (r.bevel > 1e-6) assert.deepEqual(r.groups, [0, 1, 2], `${label}: surface groups`);
          assert.ok(sameBevel(r.bevel, request), `${where}: applied ${r.bevel}, requested ${request}`);
        }
        assert.deepEqual(
          asset.info.warnings.filter((w) => REDUCED.test(w)),
          [],
          `${where}: no bevel note`
        );
      } finally {
        asset.dispose();
      }
    }
  });
