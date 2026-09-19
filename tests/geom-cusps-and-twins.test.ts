// SPDX-License-Identifier: MPL-2.0
/**
 * Crossings at a cusp, and boundaries that a boolean has to decide twice.
 *
 * Four cases, each one a shape whose answer a reader can check against a region rather than
 * against the intersector's own opinion:
 *
 * 1. A touch beside two crossings, which has to come back as three points and not as one.
 * 2. A cusp curve against an exact copy of itself, which shares its whole boundary and so
 *    meets it at its two ends and nowhere else. This pair goes over `CLIP_BUDGET.maxNodes`
 *    and is answered by the overrun search, where `sharedRun` settles it.
 * 3. A closed band two weld radii thick, which is a region and must not be swallowed as a
 *    sliver.
 * 4. A curve that starts exactly on the line capping it, whose shared vertex depends on a
 *    root that is a rounding error outside [0, 1].
 *
 * The regions: A is below a base curve, down to a line; B is above a near-copy of it, up
 * to another line. Both are written out in full, every coordinate at 17 significant
 * digits, so a case reproduces whatever builds them.
 *
 * ## What used to be here
 *
 * This file was written while the whole intersector was being replaced, and most of it pinned
 * the replacement's answers: a crossing found at a cusp apex, a triple root read as one
 * point, a pair crossing four times at icon coordinates, a ray cast that counts crossings at
 * a cusp, a cubic whose leading coefficient is a billionth of the rest. Those answers are not
 * shipped. The pairs behind them finish inside the budget, so the clip search answers them as
 * it always has, and the rewrite that improved them is parked with its evidence (see the
 * header of engine/src/geom/intersect.ts, which also records the `cubicRoots01` bug that
 * remains open). Keeping those tests would have pinned work that is not in the tree.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGeomApi } from '../engine/src/geom-api.ts';
import type { GeomContour, GeomPathResult, GeomResult } from '../packages/core/src/host-v1.ts';
import { type Cubic, evalCubic, nearestOnCubic } from '../engine/src/geom/bezier.ts';
import { cubicRoots01, intersectCubics, intersectLineCubic } from '../engine/src/geom/intersect.ts';

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
const parsed = (d: string): GeomContour[] => (d === '' ? [] : val(geom.parse(d), 'parse'));

/** Hits in both orders, each as [t on the first-named curve, t on the second]. */
function bothOrders(c1: Cubic, c2: Cubic): { name: string; hits: [number, number][] }[] {
  return [
    { name: 'c1 x c2', hits: intersectCubics(c1, c2).map((h): [number, number] => [h.t1, h.t2]) },
    { name: 'c2 x c1', hits: intersectCubics(c2, c1).map((h): [number, number] => [h.t2, h.t1]) },
  ];
}

/** How far a hit is from the curve it is furthest from. Every hit must be on both. */
const onBoth = (c1: Cubic, c2: Cubic, [t1, t2]: [number, number]): number => {
  const p = evalCubic(c1, t1), q = evalCubic(c2, t2);
  return Math.max(nearestOnCubic(c2, p.x, p.y).distance, nearestOnCubic(c1, q.x, q.y).distance);
};

/**
 * The walk snaps every join, so the pieces of a contour meet EXACTLY, not within the weld
 * radius. Every consumer reads the output as a chain, and a gap of a billionth is still a
 * gap. Checked on every result these tests produce.
 */
function assertChainedExactly(d: string, what: string): void {
  for (const [ci, c] of parsed(d).entries()) {
    assert.ok(c.curves.length > 0, `${what}: contour ${ci} has no curves`);
    for (let i = 1; i < c.curves.length; i++) {
      const a = c.curves[i - 1]!, b = c.curves[i]!;
      assert.equal(b[0], a[6], `${what}: contour ${ci} breaks in x between curves ${i - 1} and ${i}`);
      assert.equal(b[1], a[7], `${what}: contour ${ci} breaks in y between curves ${i - 1} and ${i}`);
    }
    if (c.closed) {
      const first = c.curves[0]!, last = c.curves[c.curves.length - 1]!;
      assert.equal(last[6], first[0], `${what}: contour ${ci} does not close in x`);
      assert.equal(last[7], first[1], `${what}: contour ${ci} does not close in y`);
    }
  }
}

// ── 1. a crossing at a cusp ───────────────────────────────────────────────────

test('a touch beside two crossings is reported beside them, not instead of them', () => {
  // A touch at 0.46 and crossings at 0.48 and 0.50, all inside one stretch where the two
  // curves stay within the tolerance of each other. The fold that moved a crossing onto a
  // touch beside it is gone: all three come back where they are, and the stretch reports
  // its two ends as well.
  const c1: Cubic = [0, 0, 3, 3, 7, 3, 10, 0];
  const c2: Cubic = [-0.06698322253877806, 0, 3.0766100383384334, 3, 6.912440645773979, 3, 10.1, 0];
  for (const { name, hits } of bothOrders(c1, c2)) {
    const what = `${name}: ${JSON.stringify(hits)}`;
    assert.ok(hits.some(([t1]) => Math.abs(t1 - 0.46) < 1e-3), `no touch, ${what}`);
    assert.ok(hits.some(([t1]) => Math.abs(t1 - 0.48) < 1e-6), `no crossing at 0.48, ${what}`);
    assert.ok(hits.some(([t1]) => Math.abs(t1 - 0.5) < 1e-5), `no crossing at 0.50, ${what}`);
    for (const h of hits) assert.ok(onBoth(c1, c2, h) <= 1e-8, `not on both curves, ${what}`);
  }
});

test('a cusp curve and an exact copy of it meet only at their ends', () => {
  // The copy is the same curve to within a ten-billionth, at the same parameters. It has no
  // crossing to report, and both copies have to be decided alike or one of them is dropped
  // and the union loses the region behind it.
  const c1: Cubic = [0, 0, 1, 1, 0, 1, 1, 0];
  const c2: Cubic = [-4.2857142857142864e-10, 0, 1.000000000047619, 1, 5.238095238095239e-10, 1, 1.000000001, 0];
  for (const { name, hits } of bothOrders(c1, c2)) {
    const what = `${name}: ${JSON.stringify(hits)}`;
    assert.equal(hits.length, 2, what);
    assert.deepEqual(hits[0], [0, 0], what);
    assert.ok(Math.abs(hits[1]![0] - 1) < 1e-9 && Math.abs(hits[1]![1] - 1) < 1e-9, what);
  }
  const A = 'M0 0 C1 1 0 1 1 0 L1 -0.3 L0 -0.3 Z';
  const B = 'M-4.2857142857142864e-10 0 C1.000000000047619 1 5.238095238095239e-10 1 1.000000001 0 L1 1.2 L0 1.2 Z';
  const d = pathOf(geom.selfUnion(`${A} ${B}`, EXACT), 'selfUnion');
  assert.equal(parsed(d).length, 1, 'the self-union is one contour');
  assert.ok(Math.abs(area(d) - 1.5) < 1e-6, `self-union area ${area(d)}, expected 1.5`);
  assertChainedExactly(d, 'exact copy');
});

// ── 4. the root solve a near-copy needs ───────────────────────────────────────

test('a closed band two weld radii thick is a region, not a sliver', () => {
  // The walk drops a chain that bounds no more area than the weld radius times its length,
  // because a chain the slack join closed on itself after a piece or two is a manufactured
  // sliver. Applied to every chain, the same test deleted real geometry: at a tolerance of
  // 0.001 the weld radius is 2, and this band is 4 units thick, so its own area is under the
  // bar. The test now applies only to a chain that needed a wide join somewhere.
  const A = 'M0 0 L1000 0 L1000 4 L0 4 Z';
  const B = 'M0 2 L1000 2 L1000 6 L0 6 Z';
  const opts = { decimals: 12, tolerance: 0.001 } as const;
  const one = (d: string, what: string): number => {
    assert.equal(parsed(d).length, 1, `${what} is not one contour: ${d}`);
    return area(d);
  };
  assert.ok(Math.abs(one(pathOf(geom.intersect([A, B], opts), 'intersect'), 'intersect') - 2000) < 1e-6);
  assert.ok(Math.abs(one(pathOf(geom.difference([A, B], opts), 'difference'), 'difference') - 2000) < 1e-6);
  assert.ok(Math.abs(one(pathOf(geom.union([A, B], opts), 'union'), 'union') - 6000) < 1e-6);
  assert.ok(Math.abs(one(pathOf(geom.selfUnion(`${A} ${B}`, opts), 'selfUnion'), 'selfUnion') - 6000) < 1e-6);
  const x = pathOf(geom.xor([A, B], opts), 'xor');
  assert.equal(parsed(x).length, 2, `xor is not two contours: ${x}`);
  assert.ok(Math.abs(area(x) - 4000) < 1e-6, `xor area ${area(x)}`);

  // The same band bowed and turned, so the answer is not a property of axis-aligned
  // rectangles: the same 1000 by 4 band with its long sides bowed by 1.3, rotated by 0.7
  // radians and moved to (10, -5). Written out in full, as everything here is.
  const bowedA =
    'M10 -5 C264.10991276808716 210.73352392270016 520.7322745164014 423.4841633149908 '
    + '774.8421872844885 639.217687237691 L772.2653165355377 642.277055986829 '
    + 'C518.1554037674506 426.5435320641287 261.5330420191364 213.7928926718381 '
    + '7.423129251049236 -1.940631250862046 Z';
  const bowedB =
    'M8.711564625524618 -3.470315625431023 C262.8214773936118 212.26320829726913 '
    + '519.443839141926 425.0138476895598 773.5537519100131 640.74737161226 '
    + 'L770.9768811610624 643.8067403613979 C516.8669683929752 428.0732164386977 '
    + '260.244606644661 215.32257704640708 6.134693876573854 -0.41094687629306925 Z';
  const bowed = pathOf(geom.intersect([bowedA, bowedB], opts), 'bowed intersect');
  assert.equal(parsed(bowed).length, 1, `the bowed intersect is not one contour: ${bowed}`);
  assert.ok(Math.abs(area(bowed) - 2000) < 0.5, `bowed intersect area ${area(bowed)}, expected 2000`);
});

test('a curve that starts exactly on the line capping it keeps that vertex', () => {
  // The distance polynomial of a cap line against the curve it caps is near-linear, and its
  // root falls a rounding error outside [0, 1]: at -1.1e-19 for this pair. A solver that
  // looks only within [0, 1] finds no sign change and reports nothing, and then the T
  // junction loses its shared vertex, the contact search scatters cuts along the cap, and the
  // walk closes garbage. Every root here is accepted with a parameter slack of 1e-9 either
  // side and clamped, which is what keeps this vertex.
  assert.deepEqual(cubicRoots01(0, 0, 1000.0000000000002, 1.1102230246251565e-16), [0]);
  const B0: Cubic = [
    8.711564625524618, -3.470315625431023, 262.8214773936118, 212.26320829726913,
    519.443839141926, 425.0138476895598, 773.5537519100131, 640.74737161226,
  ];
  const hits = intersectLineCubic(7.423129251049236, -1.940631250862046, 10, -5, B0);
  assert.equal(hits.length, 1, JSON.stringify(hits));
  assert.ok(Math.abs(hits[0]!.t1 - 0.5) < 1e-9, JSON.stringify(hits));
  assert.ok(Math.abs(hits[0]!.t2) < 1e-9, JSON.stringify(hits));
});
