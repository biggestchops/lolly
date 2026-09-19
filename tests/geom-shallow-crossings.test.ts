// SPDX-License-Identifier: MPL-2.0
/**
 * Shallow crossings between a shape and a near-copy of it.
 *
 * Pairs of this kind are what the clip search cannot separate, so each case here goes over
 * `CLIP_BUDGET.maxNodes` and is answered by the overrun search in engine/src/geom/intersect.ts:
 * the stretch where the two curves stay within the tolerance of each other is scanned for the
 * places where one changes sides of the other, and one contact is reported for it, plus the
 * stretch's two ends when it is longer than a thousandth of the pair's size. Nothing is moved
 * onto anything.
 *
 * The first attempt at the fuzz reproducer in tests/geom-coincident-repeats.test.ts simply
 * stopped the search on any stalled pair of pieces that were straight and within the
 * tolerance of each other. That was fast, and it dropped real crossings where two curves meet
 * at a very small angle: a boolean between a shape and a near-copy of it kept or dropped a
 * whole arc, and a third of a disc went missing. The cases here are what stops that from
 * coming back.
 *
 * Six cases that were here have gone, because the pairs behind them finish inside the budget
 * and so keep the clip search's own answers: a circle against a copy rounded to four
 * decimals, a disc rotated by a millionth of a radian, the pivot sweep, two sliver cases and
 * a repeated-stroke case. They were pinning a rewrite that is parked, not shipped behaviour;
 * the header of engine/src/geom/intersect.ts says where its evidence is.
 *
 * ## Oracles
 *
 * 1. **Membership.** A shape and a copy that differs from it by far less than the grid
 *    spacing fill the same grid points, except within a small margin of the boundary.
 *    Where two shapes meet along a shared edge, each grid point is in the result exactly
 *    when the region algebra says so. Membership is counted on outlines flattened to many
 *    chords, independently of the boolean module's own winding test.
 * 2. **Area.** The same statement for area, up to slivers far thinner than the margin.
 * 3. **Where the crossing is.** A copy rotated about a point on the curve crosses the
 *    original at that point and nowhere else nearby. A copy built as c1 + eps·p(t)·n,
 *    with p a cubic, crosses c1 where p changes sign and touches it at a double root.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGeomApi } from '../engine/src/geom-api.ts';
import type { GeomPathResult, GeomResult } from '../packages/core/src/host-v1.ts';
import { type Cubic, evalCubic, nearestOnCubic } from '../engine/src/geom/bezier.ts';
import { intersectCubics } from '../engine/src/geom/intersect.ts';

const geom = makeGeomApi();
const EXACT = { decimals: 12 } as const;

function pathOf(r: GeomPathResult, what: string): string {
  assert.ok(r.ok, `${what}: expected ok, got ${r.ok ? '' : `${r.code} - ${r.message}`}`);
  return r.d;
}

function val<T>(r: GeomResult<T>, what: string): T {
  assert.ok(r.ok, `${what}: expected ok, got ${r.ok ? '' : `${r.code} - ${r.message}`}`);
  return r.value;
}

const area = (d: string) => (d === '' ? 0 : Math.abs(val(geom.area(d), 'area')));
const num = (v: number) => String(+v.toPrecision(17));

type Op = 'union' | 'intersect' | 'difference' | 'xor';
const OPS: Op[] = ['union', 'intersect', 'difference', 'xor'];

/**
 * Winding number, from each curve flattened to 600 chords and a crossing count. It is
 * deliberately not `windingNumber`: the oracle must not share code with what it checks.
 */
function winder(d: string): (x: number, y: number) => number {
  if (d === '') return () => 0;
  const polys = val(geom.parse(d), 'parse').map((c) => {
    const pts: number[] = [];
    for (const k of c.curves) {
      for (let i = 0; i < 600; i++) {
        const p = evalCubic([...k] as Cubic, i / 600);
        pts.push(p.x, p.y);
      }
    }
    const last = c.curves[c.curves.length - 1]!;
    pts.push(last[6]!, last[7]!);
    return pts;
  });
  return (x, y) => {
    let w = 0;
    for (const pts of polys) {
      const m = pts.length / 2;
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % m;
        const x0 = pts[2 * i]!, y0 = pts[2 * i + 1]!, x1 = pts[2 * j]!, y1 = pts[2 * j + 1]!;
        const side = (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0);
        if (y0 <= y && y1 > y && side > 0) w++;
        else if (y0 > y && y1 <= y && side < 0) w--;
      }
    }
    return w;
  };
}

/** Nonzero membership, from `winder`. */
function filler(d: string): (x: number, y: number) => boolean {
  const w = winder(d);
  return (x, y) => w(x, y) !== 0;
}

/** Distance to a path's outline, parsed once. */
function distanceTo(d: string): (x: number, y: number) => number {
  const curves = val(geom.parse(d), 'parse').flatMap((c) => c.curves.map((k) => [...k] as Cubic));
  return (x, y) => Math.min(...curves.map((k) => nearestOnCubic(k, x, y).distance));
}

/** A region below the curve `lower` and a region above `upper`, down to y = -0.3·L and up
 *  to y = 0.5·L. When the two curves are near-copies the regions meet along them. */
function tiles(lower: number[], upper: number[], L: number): { A: string; B: string } {
  const edge = (c: number[]) => `M${num(c[0]!)} ${num(c[1]!)} C${c.slice(2).map(num).join(' ')}`;
  return {
    A: `${edge(lower)} L${num(lower[6]!)} ${num(-0.3 * L)} L${num(lower[0]!)} ${num(-0.3 * L)} Z`,
    B: `${edge(upper)} L${num(upper[6]!)} ${num(0.5 * L)} L${num(upper[0]!)} ${num(0.5 * L)} Z`,
  };
}

/**
 * Check the self-union of A and B together and all four booleans of A and B, where A and B
 * meet along a shared edge: membership on a grid, skipping points within 2e-3·L of either
 * outline, and area. The two regions overlap, or leave a gap, only in slivers far thinner
 * than that.
 */
function checkTiles(A: string, B: string, L: number, opts: { decimals?: number } = {}): void {
  const windA = winder(A), windB = winder(B);
  const fromA = distanceTo(A), fromB = distanceTo(B);
  const aA = area(A), aB = area(B);
  const grid: { x: number; y: number; wa: number; wb: number }[] = [];
  for (let i = 0; i <= 14; i++) {
    for (let j = 0; j <= 14; j++) {
      const x = L * (-0.05 + (i + 0.137) * 0.075), y = L * (-0.35 + (j + 0.219) * 0.062);
      if (Math.min(fromA(x, y), fromB(x, y)) < 2e-3 * L) continue;
      grid.push({ x, y, wa: windA(x, y), wb: windB(x, y) });
    }
  }
  assert.ok(grid.length > 180, `grid too thin (${grid.length})`);
  // The self-union fills the path made of both outlines by the nonzero rule, so a point is
  // in it where the two winding numbers do not cancel, not wherever it is in either region.
  // A and B run in opposite senses, so a point in both would be left out.
  type Rule = (wa: number, wb: number) => boolean;
  const cases: [string, string, Rule, number][] = [
    ['selfUnion', pathOf(geom.selfUnion(`${A} ${B}`, opts), 'selfUnion'), (wa, wb) => wa + wb !== 0, aA + aB],
    ...OPS.map((op): [string, string, Rule, number] => [
      op, pathOf(geom[op]([A, B], opts), op),
      op === 'union' ? (wa, wb) => wa !== 0 || wb !== 0 : op === 'intersect' ? (wa, wb) => wa !== 0 && wb !== 0
        : op === 'difference' ? (wa, wb) => wa !== 0 && wb === 0 : (wa, wb) => (wa !== 0) !== (wb !== 0),
      op === 'intersect' ? 0 : op === 'difference' ? aA : aA + aB,
    ]),
  ];
  for (const [op, d, rule, want] of cases) {
    const got = area(d);
    assert.ok(Math.abs(got - want) <= 2e-3 * (aA + aB), `${op}: area ${got}, expected ${want}`);
    const filled = filler(d);
    for (const { x, y, wa, wb } of grid) {
      assert.equal(filled(x, y), rule(wa, wb), `${op} at (${x}, ${y}): winding in A ${wa}, in B ${wb}`);
    }
  }
}

/** c1 moved along +y by eps·p(t), where p(t) = (t - a)²(t - t0): the copy touches c1 at
 *  t = a and crosses it at t = t0. */
function touchThenCross(c1: number[], a: number, t0: number, eps: number): number[] {
  const k2 = -(2 * a + t0), k1 = a * a + 2 * a * t0, k0 = -a * a * t0;
  const b = [k0, k0 + k1 / 3, k0 + (2 * k1) / 3 + k2 / 3, k0 + k1 + k2 + 1];
  return c1.map((v, i) => (i % 2 === 1 ? +(v + eps * b[(i - 1) / 2]!).toPrecision(17) : v));
}

test('two shapes sharing a curved edge whose far end was rounded to four decimals', () => {
  // The start vertex and first handle are exact, the far handle and vertex rounded. The
  // two edges cross 0.686 of the way along, inside a sliver no wider than 5e-6. Reporting
  // that crossing at the shared start instead, as the previous version of this fix did,
  // lost 35 percent of the self-union: both edges were then decided at their midpoints,
  // which lie on the wrong side of the crossing.
  const e1 = [0, 0, 38.68476271629333, -5.575015544891357, 67.65078037977219, 6.817111968994141, 104.65711593627928, -3.291616439819336];
  const e2 = [0, 0, 38.68476271629333, -5.575015544891357, 67.6508, 6.8171, 104.6571, -3.2916];
  const hits = intersectCubics(e1 as Cubic, e2 as Cubic).filter((h) => h.t1 > 0);
  assert.equal(hits.length, 1, JSON.stringify(hits));
  assert.ok(Math.abs(hits[0]!.t1 - 0.686074) < 1e-5 && Math.abs(hits[0]!.t2 - 0.686074) < 1e-5, JSON.stringify(hits));
  const { A, B } = tiles(e1, e2, 100);
  checkTiles(A, B, 100);
  checkTiles(A, B, 100, EXACT);
});

test('a crossing after a second-order touch at a shared start is reported where it is', () => {
  // The copy agrees with the curve to second order at their shared start and crosses it
  // further on, with the two never more than a few millionths apart before the crossing
  // and parting beyond it. The previous version of this fix reported each of these at the
  // shared start and lost the region below the edge from the self-union.
  const flat = [0, 0, 100 / 3, 0.1, 200 / 3, 0.1, 100, 0];
  for (const t0 of [0.53, 0.6, 0.7]) {
    const c2 = touchThenCross(flat, 0, t0, 1e-4);
    const hits = intersectCubics(flat as Cubic, c2 as Cubic);
    assert.ok(hits.some((h) => Math.abs(h.t1 - t0) < 1e-6 && Math.abs(h.t2 - t0) < 1e-6),
      `t0 = ${t0}: ${JSON.stringify(hits)}`);
    const { A, B } = tiles(flat, c2, 100);
    checkTiles(A, B, 100, EXACT);
  }
  // The same with the touch at the shared far end, on a large arc.
  const arc = [0, 0, 300, 200, 700, 200, 1000, 0];
  const c2 = touchThenCross(arc, 1, 0.5, 1e-3);
  const hits = intersectCubics(arc as Cubic, c2 as Cubic);
  assert.ok(hits.some((h) => Math.abs(h.t1 - 0.5) < 1e-6 && Math.abs(h.t2 - 0.5) < 1e-6), JSON.stringify(hits));
  const { A, B } = tiles(arc, c2, 1000);
  checkTiles(A, B, 1000, EXACT);
});

test('a touch beside a crossing is reported, so no piece is decided on the touch', () => {
  // The copy touches the curve at t = 0.25 and crosses it at t = 0.5. With only the
  // crossing reported, the boolean cut both curves at 0.5 and decided the first halves at
  // their midpoints, t = 0.25, exactly on the touch: the self-union lost three eighths of
  // its area. The boolean's own contact search is not asked once a crossing has been found.
  const flat = [0, 0, 1 / 3, 0.001, 2 / 3, 0.001, 1, 0];
  const c2 = touchThenCross(flat, 0.25, 0.5, 1e-2);
  const hits = intersectCubics(flat as Cubic, c2 as Cubic);
  assert.ok(hits.some((h) => Math.abs(h.t1 - 0.25) < 1e-3 && Math.abs(h.t2 - 0.25) < 1e-3), `no touch: ${JSON.stringify(hits)}`);
  assert.ok(hits.some((h) => Math.abs(h.t1 - 0.5) < 1e-6 && Math.abs(h.t2 - 0.5) < 1e-6), `no crossing: ${JSON.stringify(hits)}`);
  for (const h of hits) {
    const p = evalCubic(flat as Cubic, h.t1), q = evalCubic(c2 as Cubic, h.t2);
    assert.ok(Math.hypot(p.x - q.x, p.y - q.y) < 1e-8, `(${h.t1}, ${h.t2}) name different points`);
  }
  const { A, B } = tiles(flat, c2, 1);
  checkTiles(A, B, 1, EXACT);
});

test('a shallow crossing on a bisection boundary is found', () => {
  // The two arcs touch at t = 0.25 and cross at exactly t = 0.5, where the search's first
  // bisection falls. A clip there cut one piece down to the single parameter 0.5, a point
  // with no direction to clip against, and the other piece was then only halved, one level
  // at a time, until the depth cap dropped the pair. The search before this change lost it
  // the same way.
  const c1: Cubic = [0, 0, 300, 200, 700, 200, 1000, 0];
  const c2: Cubic = [0, -0.003125, 300, 200.00729166666667, 700, 199.984375, 1000, 0.028125];
  for (const [a, b] of [[c1, c2], [c2, c1]] as const) {
    const hits = intersectCubics(a, b);
    assert.ok(hits.some((h) => Math.abs(h.t1 - 0.5) < 1e-7 && Math.abs(h.t2 - 0.5) < 1e-7), JSON.stringify(hits));
  }
});

test('a crossing that needs more halvings than the depth cap allows is found', () => {
  // Two edges 900 units long share their start and part slowly, crossing at t = 0.754
  // and again at t = 0.969, where they meet at 7e-6 rad. The search ran out of depth on
  // the second before its pieces were short enough to stop on, and the self-union then
  // came back with five contours and 3 percent too much area.
  const e1 = [0, 0, 255.85393905639648, -71.97589874267578, 847.323140501976, 90.13946056365967, 908.0758810043336, -47.45546281337738];
  const e2 = [0, 0, 255.85393905639648, -71.97589874267578, 847.3223696260452, 90.13983451277018, 908.0761807448865, -47.45579047131538];
  for (const [a, b] of [[e1, e2], [e2, e1]] as const) {
    const hits = intersectCubics(a as Cubic, b as Cubic).filter((h) => h.t1 > 0);
    assert.equal(hits.length, 2, JSON.stringify(hits));
    assert.ok(Math.abs(hits[0]!.t1 - 0.754209) < 1e-5 && Math.abs(hits[1]!.t1 - 0.969165) < 1e-5, JSON.stringify(hits));
  }
  const { A, B } = tiles(e1, e2, 1000);
  checkTiles(A, B, 1000);
});
