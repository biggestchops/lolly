// SPDX-License-Identifier: MPL-2.0
/**
 * The bevel inset model (shells/web/src/lib/studio3d/inset.ts) against three itself
 * (plan 265, B2).
 *
 * The pin builds ExtrudeGeometry with the studio's options for real prepared shapes and
 * reads back the vertices three placed on the back cap and on one intermediate bevel
 * layer. three stores positions as 32-bit floats, so the model's points are rounded to
 * 32 bits before they are compared; after that they agree within 1e-9 (in practice
 * exactly).
 *
 * The sweep behind studioInsetSafe is then compared with an all-pairs version of the same
 * three rules on seeded random shapes, and a few hand-made cases show each rule refusing
 * a real fold.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import {
  type StudioInsetModel,
  studioBevelOffsets,
  studioInsetLayer,
  studioInsetModel,
  studioInsetSafe,
} from '../shells/web/src/lib/studio3d/inset.ts';
import { prepareStudioSvg } from '../shells/web/src/lib/studio3d/source.ts';
import { installStudioDom } from './helpers/studio3d-dom.ts';

const dir = join(resolve(import.meta.dirname, '..'), 'tests/fixtures/studio3d/geometry');
const SEGMENTS = 5;
const SMOOTHNESS = 24;

installStudioDom();

/** The shapes the studio extrudes for a fixture, with roughly its source-to-studio scale. */
function preparedShapes(file: string): { shapes: THREE.Shape[]; scale: number } {
  const { svg } = prepareStudioSvg(readFileSync(join(dir, file), 'utf8'));
  const paths = new SVGLoader().parse(svg).paths;
  const box = new THREE.Box2();
  for (const path of paths)
    for (const sub of path.subPaths)
      for (const point of sub.getPoints(SMOOTHNESS)) box.expandByPoint(point);
  const size = box.getSize(new THREE.Vector2());
  return {
    shapes: paths.flatMap((path) => path.toShapes()),
    scale: 3.25 / Math.max(size.x, size.y),
  };
}

const key = (x: number, y: number) => `${x} ${y}`;

/** Distinct (x, y) of the vertices in one group at one z, as 32-bit values. */
function layerOf(geometry: THREE.BufferGeometry, group: number, z: number): Set<string> {
  const p = geometry.getAttribute('position'),
    g = geometry.groups[group]!;
  const found = new Set<string>();
  for (let i = g.start; i < g.start + g.count; i++)
    if (p.getZ(i) === Math.fround(z)) found.add(key(p.getX(i), p.getY(i)));
  return found;
}

/** The model's points at one offset, rounded to 32 bits as three stores them. */
function modelLayer(model: StudioInsetModel, offset: number): Map<string, [number, number]> {
  const { x, y } = studioInsetLayer(model, offset);
  const points = new Map<string, [number, number]>();
  for (let i = 0; i < x.length; i++) {
    const px = Math.fround(x[i]!),
      py = Math.fround(y[i]!);
    points.set(key(px, py), [px, py]);
  }
  return points;
}

/** Every vertex three placed matches a model point within 1e-9; the sidewall layer matches the model both ways. */
function assertLayer(
  geometry: THREE.BufferGeometry,
  model: StudioInsetModel,
  offset: number,
  z: number,
  label: string,
  cap: boolean
): void {
  const expected = modelLayer(model, offset);
  const side = layerOf(geometry, 1, z);
  assert.ok(side.size > 0, `${label}: the sidewall has a layer at z = ${z}`);
  assert.deepEqual([...side].sort(), [...expected.keys()].sort(), `${label}: sidewall layer`);
  if (!cap) return;
  const lid = layerOf(geometry, 0, z);
  assert.ok(lid.size >= 3, `${label}: the back cap has vertices`);
  let worst = 0;
  for (const point of lid) {
    const [x, y] = point.split(' ').map(Number) as [number, number];
    const match = expected.get(point);
    assert.ok(match, `${label}: cap vertex ${point} is a model point`);
    worst = Math.max(worst, Math.abs(match[0] - x), Math.abs(match[1] - y));
  }
  assert.ok(worst <= 1e-9, `${label}: cap vertices within 1e-9 (worst ${worst})`);
}

for (const file of [
  'ring-opposite.svg',
  'disc-two-holes.svg',
  'disc-four-holes.svg',
  'letter-b-outfit.svg',
])
  test(`the inset model reproduces three's bevel layers for ${file}`, () => {
    const { shapes, scale } = preparedShapes(file);
    assert.ok(shapes.length > 0);
    for (const request of [0.025, 0.05]) {
      const depth = 0.25 / scale,
        bevel = request / scale;
      for (const [index, shape] of shapes.entries()) {
        const label = `${file} shape ${index} at ${request}`;
        const model = studioInsetModel(shape, SMOOTHNESS);
        const geometry = new THREE.ExtrudeGeometry(shape, {
          depth,
          curveSegments: SMOOTHNESS,
          steps: 1,
          bevelSegments: SEGMENTS,
          bevelEnabled: true,
          bevelSize: bevel,
          bevelOffset: -bevel,
          bevelThickness: bevel,
        });
        try {
          assert.equal(model.starts.length - 2, shape.holes.length, `${label}: holes`);
          assert.equal(
            geometry.groups[1]!.count,
            6 * model.x.length * (1 + 2 * SEGMENTS),
            `${label}: one sidewall quad per model point per layer`
          );
          const offsets = studioBevelOffsets(bevel, SEGMENTS);
          assert.equal(offsets[0], -bevel);
          // The back cap is at z = -bevelThickness and uses the full inset.
          assertLayer(geometry, model, offsets[0]!, -bevel, `${label} cap`, true);
          // Layer b = 2 is at z = -bevelThickness * cos(2 / 5 * pi / 2).
          const t = 2 / SEGMENTS;
          assertLayer(
            geometry,
            model,
            offsets[2]!,
            -(bevel * Math.cos((t * Math.PI) / 2)),
            `${label} step 2`,
            false
          );
          // The sidewall keeps the flattened source.
          assertLayer(geometry, model, 0, 0, `${label} sidewall`, false);
        } finally {
          geometry.dispose();
        }
      }
    }
  });

test('bevel layer offsets follow three: -bevel at the cap, rising to the sidewall', () => {
  const bevel = 0.37;
  const offsets = studioBevelOffsets(bevel, SEGMENTS);
  assert.equal(offsets.length, SEGMENTS);
  for (const [b, offset] of offsets.entries()) {
    const t = b / SEGMENTS;
    assert.equal(offset, bevel * Math.sin((t * Math.PI) / 2) + -bevel);
  }
  for (let b = 1; b < SEGMENTS; b++) assert.ok(offsets[b]! > offsets[b - 1]!);
  assert.ok(offsets[SEGMENTS - 1]! < 0);
});

function polygon(points: [number, number][]): THREE.Path {
  const path = new THREE.Path();
  path.moveTo(...points[0]!);
  for (const point of points.slice(1)) path.lineTo(...point);
  return path;
}

function shapeOf(outer: [number, number][], holes: [number, number][][] = []): THREE.Shape {
  const shape = new THREE.Shape(polygon(outer).getPoints());
  for (const hole of holes) shape.holes.push(polygon(hole));
  return shape;
}

const square = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  clockwise = false
): [number, number][] =>
  clockwise
    ? [
        [x0, y0],
        [x0, y1],
        [x1, y1],
        [x1, y0],
      ]
    : [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ];

test('each rule refuses a real fold and accepts the same shape with a smaller bevel', () => {
  const safe = (shape: THREE.Shape, bevel: number) =>
    studioInsetSafe(studioInsetModel(shape, SMOOTHNESS), bevel, SEGMENTS);
  // A strip 0.2 wide: its short edges reverse once the bevel passes 0.1.
  const strip = shapeOf(square(0, 0, 0.2, 3));
  assert.equal(safe(strip, 0.09), true);
  assert.equal(safe(strip, 0.11), false);
  // A square 0.2 wide: it keeps its orientation past 0.099 but not 1% of its area.
  const dot = shapeOf(square(0, 0, 0.2, 0.2));
  assert.equal(safe(dot, 0.08), true);
  assert.equal(safe(dot, 0.095), false);
  // A frame with a 0.1 wall. At 0.075 the grown hole holds the whole shrunken outline, so
  // no edge crosses at any layer; only the containment rule sees it.
  const frame = shapeOf(square(0, 0, 3, 3), [square(0.1, 0.1, 2.9, 2.9, true)]);
  assert.equal(safe(frame, 0.04), true);
  assert.equal(safe(frame, 0.075), false);
  // Two holes 0.3 apart: they meet once the bevel passes 0.15.
  const pair = shapeOf(square(0, 0, 6, 3), [
    square(1, 1, 2.85, 2, true),
    square(3.15, 1, 5, 2, true),
  ]);
  assert.equal(safe(pair, 0.14), true);
  assert.equal(safe(pair, 0.16), false);
  // A notch whose two sides pass each other: the contour crosses itself.
  const notch = shapeOf([
    [0, 0],
    [4, 0],
    [4, 3],
    [2.1, 3],
    [2.1, 1],
    [1.9, 1],
    [1.9, 3],
    [0, 3],
  ]);
  assert.equal(safe(notch, 0.3), true, 'a notch only widens as the solid shrinks');
  const tongue = shapeOf([
    [0, 0],
    [4, 0],
    [4, 1],
    [2.1, 1],
    [2.1, 3],
    [1.9, 3],
    [1.9, 1],
    [0, 1],
  ]);
  assert.equal(safe(tongue, 0.09), true);
  assert.equal(safe(tongue, 0.11), false, 'a tongue 0.2 wide folds past 0.1');
  // No bevel is always safe; a negative or missing size never is.
  assert.equal(safe(strip, 0), true);
  assert.equal(safe(strip, -1), false);
  assert.equal(safe(strip, Number.NaN), false);
});

// All-pairs reference for the sweep: the same three rules, without the sweep's shortcuts.
function side(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function meets(
  m: StudioInsetModel,
  x: Float64Array,
  y: Float64Array,
  a: number,
  b: number
): boolean {
  const a2 = m.next[a]!,
    b2 = m.next[b]!;
  const [ax, ay, bx, by, cx, cy, dx, dy] = [
    x[a]!,
    y[a]!,
    x[a2]!,
    y[a2]!,
    x[b]!,
    y[b]!,
    x[b2]!,
    y[b2]!,
  ];
  if (
    Math.max(ax, bx) < Math.min(cx, dx) ||
    Math.max(cx, dx) < Math.min(ax, bx) ||
    Math.max(ay, by) < Math.min(cy, dy) ||
    Math.max(cy, dy) < Math.min(ay, by)
  )
    return false;
  const o1 = side(ax, ay, bx, by, cx, cy),
    o2 = side(ax, ay, bx, by, dx, dy),
    o3 = side(cx, cy, dx, dy, ax, ay),
    o4 = side(cx, cy, dx, dy, bx, by);
  return !((o1 > 0 && o2 > 0) || (o1 < 0 && o2 < 0) || (o3 > 0 && o4 > 0) || (o3 < 0 && o4 < 0));
}

function containment(m: StudioInsetModel, x: Float64Array, y: Float64Array): string[] {
  const out: string[] = [];
  for (let h = 1; h + 1 < m.starts.length; h++) {
    const p = m.starts[h]!;
    const odd: number[] = [];
    for (let c = 0; c + 1 < m.starts.length; c++) {
      if (c === h) continue;
      let inside = false;
      for (let a = m.starts[c]!; a < m.starts[c + 1]!; a++) {
        const b = m.next[a]!;
        if (x[a]! > x[p]! === x[b]! > x[p]!) continue;
        if (y[a]! + ((x[p]! - x[a]!) * (y[b]! - y[a]!)) / (x[b]! - x[a]!) > y[p]!) inside = !inside;
      }
      if (inside) odd.push(c);
    }
    out.push(odd.join(','));
  }
  return out;
}

function referenceSafe(m: StudioInsetModel, bevel: number): boolean {
  const offsets = studioBevelOffsets(bevel, SEGMENTS),
    full = offsets[0]!;
  const n = m.x.length;
  const inset = studioInsetLayer(m, full);
  for (let a = 0; a < n; a++) {
    const b = m.next[a]!;
    const dot =
      (m.x[b]! - m.x[a]!) * (inset.x[b]! - inset.x[a]!) +
      (m.y[b]! - m.y[a]!) * (inset.y[b]! - inset.y[a]!);
    if (!(dot > 0)) return false;
  }
  for (let c = 0; c + 1 < m.starts.length; c++) {
    const area = (s: number) => {
      const layer = studioInsetLayer(m, s);
      let sum = 0;
      for (let p = m.starts[c + 1]! - 1, q = m.starts[c]!; q < m.starts[c + 1]!; p = q++)
        sum += layer.x[p]! * layer.y[q]! - layer.x[q]! * layer.y[p]!;
      return sum;
    };
    // Area is quadratic in the offset: fit it through three layers and test the ends and the vertex.
    const start = area(0),
      middle = area(full / 2),
      end = area(full);
    const bend = 2 * (end + start - 2 * middle),
      slope = end - start - bend;
    if (!(end / start > 0.01)) return false;
    const t = -slope / (2 * bend);
    if (t > 0 && t < 1 && !((start + slope * t + bend * t * t) / start > 0.01)) return false;
  }
  const before = containment(m, m.x, m.y);
  for (const offset of offsets) {
    const { x, y } = studioInsetLayer(m, offset);
    for (let a = 0; a < n; a++)
      for (let b = a + 1; b < n; b++)
        if (m.next[a] !== b && m.next[b] !== a && meets(m, x, y, a, b)) return false;
    if (containment(m, x, y).some((value, h) => value !== before[h])) return false;
  }
  return true;
}

/** mulberry32: a small seeded generator so the random shapes are the same on every run. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function blob(
  next: () => number,
  cx: number,
  cy: number,
  radius: number,
  points: number,
  clockwise: boolean
): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < points; i++) {
    const angle = ((clockwise ? -i : i) / points) * Math.PI * 2;
    const r = radius * (0.55 + 0.45 * next());
    out.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
  }
  return out;
}

test('the sweep agrees with an all-pairs check on seeded random shapes', () => {
  const next = random(265);
  let refused = 0,
    accepted = 0;
  for (let round = 0; round < 160; round++) {
    const holes: [number, number][][] = [];
    const count = Math.floor(next() * 4);
    for (let h = 0; h < count; h++)
      holes.push(
        blob(
          next,
          -1.2 + 2.4 * next(),
          -1.2 + 2.4 * next(),
          0.2 + 0.6 * next(),
          5 + Math.floor(next() * 8),
          next() < 0.8
        )
      );
    const shape = shapeOf(blob(next, 0, 0, 3, 6 + Math.floor(next() * 14), next() < 0.5), holes);
    // Curves as well as corners: some rounds replace a hole with a circle.
    if (next() < 0.3) {
      const circle = new THREE.Path();
      circle.absarc(next() - 0.5, next() - 0.5, 0.3 + 0.4 * next(), 0, Math.PI * 2, next() < 0.5);
      shape.holes.push(circle);
    }
    const model = studioInsetModel(shape, 1 + Math.floor(next() * 12));
    for (const bevel of [0.02, 0.1, 0.3, 0.8]) {
      const fast = studioInsetSafe(model, bevel, SEGMENTS);
      assert.equal(fast, referenceSafe(model, bevel), `round ${round}, bevel ${bevel}`);
      if (fast) accepted++;
      else refused++;
    }
  }
  assert.ok(
    accepted > 50 && refused > 50,
    `both answers are exercised (${accepted} accepted, ${refused} refused)`
  );
});

test('holes turn with the outer contour only when three turns them', () => {
  // A clockwise outer contour is kept as drawn, and so is a hole wound the same way; that
  // hole then moves the other way under a bevel, as three draws it.
  const outer = square(0, 0, 4, 4, true);
  const hole = square(1, 1, 3, 3, true);
  const model = studioInsetModel(shapeOf(outer, [hole]), SMOOTHNESS);
  const { x, y } = studioInsetLayer(model, -0.1);
  const first = model.starts[1]!;
  const holeXs = Array.from(x.subarray(first, first + 4));
  const holeYs = Array.from(y.subarray(first, first + 4));
  assert.ok(Math.min(...holeXs) > 1 && Math.max(...holeXs) < 3, 'the same-wound hole shrinks');
  assert.ok(Math.min(...holeYs) > 1 && Math.max(...holeYs) < 3);
  const geometry = new THREE.ExtrudeGeometry(shapeOf(outer, [hole]), {
    depth: 1,
    curveSegments: SMOOTHNESS,
    steps: 1,
    bevelSegments: SEGMENTS,
    bevelEnabled: true,
    bevelSize: 0.1,
    bevelOffset: -0.1,
    bevelThickness: 0.1,
  });
  try {
    assertLayer(geometry, model, -0.1, -0.1, 'same-wound hole', true);
  } finally {
    geometry.dispose();
  }
});
