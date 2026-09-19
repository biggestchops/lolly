// SPDX-License-Identifier: MPL-2.0
/**
 * How the intersector decides a stretch where two curves stay within the tolerance of each
 * other, and what a boolean makes of the answer.
 *
 * These are pairs the clip search cannot finish inside `CLIP_BUDGET.maxNodes`, so each is
 * answered by the overrun search in engine/src/geom/intersect.ts: the clip stops on pairs of
 * pieces it cannot separate, and the stopped stretches are scanned for the side one curve is
 * on of the other (`scanStalled`). Three cases are pinned, each one a way the scan lost an
 * answer while it was being written:
 *
 * 1. A crossing at zero angle, where the gap grows as the cube of the distance from it. The
 *    clip closed on single points inside the zone where the curves agree to within the
 *    tolerance, and one sample at such a point never shows a change of side. The scan now
 *    reads the side outside each stretch, where the curves have clearly parted.
 * 2. A touch just after a crossing, on a curved pair. The zone around them needed more
 *    stalled pairs than the search kept, the dropped ones held the touch, and a boolean
 *    then decided a piece where its two sides could not be told apart. A second, false
 *    touch came from two samples a hair apart whose gaps differed by rounding.
 * 3. A crossing the clip closed on at a point a hair past the end of the piece it kept.
 *
 * What the overrun search answers for such a pair: ONE contact per stretch where the two
 * curves stay within the tolerance of each other, plus the stretch's two ends when it is
 * longer than a thousandth of the pair's size, and nothing moved onto anything. So a crossing
 * and a touch a hundredth apart come back as one contact and two run ends.
 *
 * Two cases that were written here while the whole file was being replaced have gone, because
 * their pairs do not go over the budget and so are answered by the clip search as they always
 * were: a shared start vertex where the curves agree to third order, and a crossing beside a
 * touch with a sliver between them about one weld radius wide. Both remain open against the
 * clip search. The evidence is in the parked round 3 and round 4 reports named in the header
 * of engine/src/geom/intersect.ts.
 *
 * Every pair is written out in full. The constructions: a base curve c1, then
 * c2 = c1 + eps·p(t) along y in Bernstein form, with eps = rel·L, then both rotated by phi
 * about the origin and moved by (tx, ty), every coordinate rounded to 17 significant
 * digits. The two regions are A, below c1 down to y = -0.3·L, and B, above c2 up to
 * y = 0.5·L, in the same frame, so the two meet along the shared edge and their union has
 * the area of both.
 *
 * ## Known limits, in boolean.ts
 *
 * Two near-copy cases come out wrong in a boolean at the weld radius, and neither is decided
 * in the intersector, so neither is pinned here:
 *
 * - a sliver exactly as wide as the boolean's weld radius, where rounding decides whether
 *   its two sides are welded;
 * - two arcs running within the weld radius of each other over their last third and
 *   touching at the end, where the sliver between them survives as a contour of its own.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGeomApi } from '../engine/src/geom-api.ts';
import type { GeomPathResult, GeomResult } from '../packages/core/src/host-v1.ts';
import { type Cubic, evalCubic, nearestOnCubic } from '../engine/src/geom/bezier.ts';
import { intersectCubics, SCAN_LIMITS } from '../engine/src/geom/intersect.ts';

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

/** How far a hit is from the curve it is furthest from. Every hit must be on both. */
const onBoth = (c1: Cubic, c2: Cubic, [t1, t2]: [number, number]): number => {
  const p = evalCubic(c1, t1), q = evalCubic(c2, t2);
  return Math.max(nearestOnCubic(c2, p.x, p.y).distance, nearestOnCubic(c1, q.x, q.y).distance);
};

/** Hits in both orders, as [t1, t2] on the first-named curve and the second. */
function bothOrders(c1: Cubic, c2: Cubic): { name: string; hits: [number, number][] }[] {
  return [
    { name: 'c1 x c2', hits: intersectCubics(c1, c2).map((h) => [h.t1, h.t2]) },
    { name: 'c2 x c1', hits: intersectCubics(c2, c1).map((h) => [h.t2, h.t1]) },
  ];
}

/** Areas of the self-union and the four booleans of A and B. */
function areas(A: string, B: string): Record<string, number> {
  const out: Record<string, number> = { selfUnion: area(pathOf(geom.selfUnion(`${A} ${B}`, EXACT), 'selfUnion')) };
  for (const op of ['union', 'intersect', 'difference', 'xor'] as const) {
    out[op] = area(pathOf(geom[op]([A, B], EXACT), op));
  }
  return out;
}

test('a crossing at zero angle is found inside the zone where the curves agree', () => {
  // arc L = 100, p = (t - t0)³, rel = 1e-6. The curves agree to within 1e-9 over about
  // 0.02 either side of t0, and the clip closes on single points anywhere in that zone.
  // The search before the scan reported 1 and 3 points at 0.312 and 0.7758, and the scan
  // before this change reported nothing. The zone is 0.04 long, which is well over a
  // thousandth of the pair's size, so its two ends come back with the crossing.
  const c1: Cubic = [0, 0, 30, 30, 70, 30, 100, 0];
  const copies: [number, Cubic][] = [
    [0.3, [0, -0.0000026999999999999996, 30, 30.0000063, 70, 29.9999853, 100, 0.00003430000000000001]],
    [0.77, [0, -0.0000456533, 30, 30.0000136367, 70, 29.9999959267, 100, 0.0000012166999999999815]],
    // Closer to an end than a quarter of the curve, in a sliver thinner than 1e-8 of the
    // pair's size: these two used to be reported at the vertex the sliver runs into, and
    // are now reported where they are.
    [0.1, [0, -1.0000000000000001e-7, 30, 30.0000009, 70, 29.9999919, 100, 0.0000729]],
    [0.9, [0, -0.0000729, 30, 30.0000081, 70, 29.9999991, 100, 9.999999999998898e-8]],
  ];
  for (const [t0, c2] of copies) {
    for (const { name, hits } of bothOrders(c1, c2)) {
      const what = `t0 = ${t0}, ${name}: ${JSON.stringify(hits)}`;
      assert.equal(hits.length, 3, what);
      const inside = hits.filter(([t1]) => Math.abs(t1 - t0) < 1.2e-2);
      assert.equal(inside.length, 1, `${what}: not one crossing inside the zone`);
      assert.equal(inside[0], hits[1], `${what}: the crossing is not between the zone's ends`);
      for (const [t1, t2] of hits) {
        assert.ok(Math.abs(t1 - t2) < 1e-6, `${what}: the two parameters disagree`);
        assert.ok(onBoth(c1, c2, [t1, t2]) <= 1e-9 * 100, `${what}: a hit is not on both curves`);
      }
    }
  }
});

/** arc L = 10, p = 100·(t - 0.79)²·(t - 0.77), rel = 1e-8: a crossing at 0.77 and a touch
 *  at 0.79, the curves never more than 1e-8 apart between them. */
const TOUCH_AFTER_CROSSING: { phi: number; c1: Cubic; c2: Cubic; A: string; B: string }[] = [
  {
    phi: -2.1,
    c1: [0, 0, 1.0750897861470483, -4.104166413746194, -0.9442946322523822, -7.557003880341689, -5.048461045998575, -8.632093666488737],
    c2: [-0.000004148213036086828, 0.0000024260732948819377, 1.0750909342989494, -4.104167085240315, -0.944294949542249, -7.557003694775406, -5.04846095844325, -8.632093717695279],
    A: 'M0 0 C1.0750897861470483 -4.104166413746194 -0.9442946322523822 -7.557003880341689 -5.048461045998575 -8.632093666488737 L-7.638089145945196 -7.117555352689164 L-2.589628099946621 1.5145383137995727 Z',
    B: 'M-0.000004148213036086828 0.0000024260732948819377 C1.0750909342989494 -4.104167085240315 -0.944294949542249 -7.557003694775406 -5.04846095844325 -8.632093717695279 L-0.7324142127542066 -11.156324189488025 L4.316046833244369 -2.5242305229992876 Z',
  },
  {
    phi: 1.3,
    c1: [0, 0, -2.0881780703778166, 3.693171042125341, -1.0181827558794674, 7.547403783794113, 2.6749882862458736, 9.63558185417193],
    c2: [0.0000046304463090953004, -0.0000012854843458734583, -2.0881793520033476, 3.693171397924641, -1.0181824017043852, 7.547403685469568, 2.6749881885121667, 9.635581881304336],
    A: 'M0 0 C-2.0881780703778166 3.693171042125341 -1.0181827558794674 7.547403783794113 2.6749882862458736 9.63558185417193 L5.565662842497453 8.833085368298168 L2.8906745562515788 -0.802496485873762 Z',
    B: 'M0.0000046304463090953004 -0.0000012854843458734583 C-2.0881793520033476 3.693171397924641 -1.0181824017043852 7.547403685469568 2.6749881885121667 9.635581881304336 L-2.1428026408400913 10.973075997294867 L-4.817790927085965 1.3374941431229368 Z',
  },
];

/** The crossing at 0.77 and the touch at 0.79 are 0.02 apart inside one stretch of contact,
 *  so one contact answers both. It is reported at the crossing. */
const oneContact = (hits: [number, number][]) =>
  hits.filter(([t1, t2]) => Math.abs(t1 - 0.77) < 1e-4 && Math.abs(t2 - 0.77) < 1e-4);

test('a touch just after a crossing is reported, and the boolean survives it', () => {
  // The search before the scan returned 27 to 29 scattered points here, which a boolean
  // reads as a shared stretch and does not cut. The scan before this change reported only
  // the crossing, and the self-union came back with 41.82 or 88.18 of 80. The area bound is
  // half a percent: the self-union at phi = -2.1 is 79.84, off by a sliver's worth.
  //
  // The two points are one contact at the tolerance asked for, and the stretch around them
  // is 0.1 long, so what comes back is that contact and the stretch's two ends. What the
  // boolean needs is a cut on each side of the contact, which the ends give it.
  for (const { phi, c1, c2, A, B } of TOUCH_AFTER_CROSSING) {
    for (const { name, hits } of bothOrders(c1, c2)) {
      const what = `phi = ${phi}, ${name}: ${JSON.stringify(hits)}`;
      assert.equal(hits.length, 3, what);
      assert.equal(oneContact(hits).length, 1, `no contact at the crossing, ${what}`);
      assert.equal(oneContact(hits)[0], hits[1], `the contact is not between the ends, ${what}`);
      assert.ok(hits[0]![0] < 0.75 && hits[2]![0] > 0.82, `the ends are not outside the contact, ${what}`);
      for (const h of hits) assert.ok(onBoth(c1, c2, h) <= 1e-9 * 10, `a hit is not on both curves, ${what}`);
    }
    const got = areas(A, B);
    for (const op of ['selfUnion', 'union', 'xor'] as const) {
      assert.ok(Math.abs(got[op]! - 80) <= 0.4, `phi = ${phi}, ${op}: area ${got[op]}, expected 80`);
    }
    assert.ok(got.intersect! < 1e-4, `phi = ${phi}, intersect: area ${got.intersect}`);
    assert.ok(Math.abs(got.difference! - 45.3) <= 0.4, `phi = ${phi}, difference: area ${got.difference}`);
  }
});

test('the run ends go when the scan keeps too few stalled pairs, and the contact stays', () => {
  // The zone around the crossing and the touch leaves between 6384 and 6589 stalled pairs.
  // Keeping only four of them truncates the zone: which four survive depends on the order the
  // search stalls pairs in, so the run the scan sees is a piece of the real one and the ends
  // it reports are the ends of that piece. What must not change is the contact itself, which
  // is certified by the sides OUTSIDE the zone and is the point of reading it by parity. So
  // this pins the contact and the promise that every hit lies on both curves, and leaves the
  // truncated run's ends unpinned: they are a property of the sampling, not of the pair. Two
  // thousand pairs, which is where this limit used to sit and where the scan before this
  // change lost the touch, still changes nothing.
  const { c1, c2 } = TOUCH_AFTER_CROSSING[0]!;
  const saved = SCAN_LIMITS.maxStalledPairs;
  try {
    SCAN_LIMITS.maxStalledPairs = 2048;
    const plenty = intersectCubics(c1, c2).map((h): [number, number] => [h.t1, h.t2]);
    assert.equal(plenty.length, 3, JSON.stringify(plenty));
    assert.equal(oneContact(plenty).length, 1, JSON.stringify(plenty));

    SCAN_LIMITS.maxStalledPairs = 4;
    const few = intersectCubics(c1, c2).map((h): [number, number] => [h.t1, h.t2]);
    const at77 = few.filter((h) => Math.abs(h[0] - 0.77) < 1e-4);
    assert.equal(at77.length, 1, `the contact is gone or doubled: ${JSON.stringify(few)}`);
    for (const h of few) {
      assert.ok(onBoth(c1, c2, h) <= 1e-9 * 10, `a hit is not on both curves: ${JSON.stringify(few)}`);
    }
  } finally {
    SCAN_LIMITS.maxStalledPairs = saved;
  }
  const hits = intersectCubics(c1, c2).map((h): [number, number] => [h.t1, h.t2]);
  assert.equal(hits.length, 3, JSON.stringify(hits));
});

test('no false touch is reported beside a crossing', () => {
  // arc L = 10, p = 100·(t - 0.35)²·(t - 0.3), rel = 1e-8. Two samples in the rounding
  // noise next to the crossing had gaps 1e-15 apart, and the scan took the second for a
  // touch 1.8e-5 past the crossing. The boolean then cut there too and gave an intersection
  // of 2.025 where there is none.
  const cases: { phi: number; c1: Cubic; c2: Cubic; A: string; B: string }[] = [
    {
      phi: 0,
      c1: [0, 0, 3, 3, 7, 3, 10, 0],
      c2: [0, -3.6749999999999987e-7, 3, 3.0000007408333333, 7, 2.9999985158333335, 10, 0.000002957499999999999],
      A: 'M0 0 C3 3 7 3 10 0 L10 -3 L0 -3 Z',
      B: 'M0 -3.6749999999999987e-7 C3 3.0000007408333333 7 2.9999985158333335 10 0.000002957499999999999 L10 5 L0 5 Z',
    },
    {
      phi: 3,
      c1: [0, 0, -3.393337513980938, -2.546617465621735, -7.353307500382719, -1.982137433382266, -9.899924966004454, 1.4112000805986722],
      c2: [5.186160296200118e-8, 3.6382224250066356e-7, -3.393337618527344, -2.546618199041176, -7.353307290937108, -1.982135964068402, -9.899925383366877, 1.4111971526958635],
      A: 'M0 0 C-3.393337513980938 -2.546617465621735 -7.353307500382719 -1.982137433382266 -9.899924966004454 1.4112000805986722 L-9.476564941824853 4.381177570400009 L0.4233600241796016 2.9699774898013365 Z',
      B: 'M5.186160296200118e-8 3.6382224250066356e-7 C-3.393337618527344 -2.546618199041176 -7.353307290937108 -1.982135964068402 -9.899925383366877 1.4111971526958635 L-10.60552500630379 -3.5387624024035547 L-0.7056000402993361 -4.949962483002227 Z',
    },
  ];
  // The crossing at 0.3 and the touch at 0.35 are one contact at this tolerance, reported
  // at the crossing, with the stretch's two ends either side of it.
  for (const { phi, c1, c2, A, B } of cases) {
    for (const { name, hits } of bothOrders(c1, c2)) {
      const what = `phi = ${phi}, ${name}: ${JSON.stringify(hits)}`;
      assert.equal(hits.length, 3, what);
      assert.ok(Math.abs(hits[1]![0] - 0.3) < 1e-5 && Math.abs(hits[1]![1] - 0.3) < 1e-5, what);
      assert.ok(hits[0]![0] < 0.3 && hits[2]![0] > 0.38, `the ends are not outside the contact, ${what}`);
      // The false touch this test is named for sat 1.8e-5 past the crossing, well inside
      // the window the contact is the only answer in.
      assert.equal(hits.filter(([t1]) => t1 > 0.295 && t1 < 0.34).length, 1, what);
      for (const h of hits) assert.ok(onBoth(c1, c2, h) <= 1e-9 * 10, `a hit is not on both curves, ${what}`);
    }
    const got = areas(A, B);
    assert.ok(got.intersect! < 1e-6, `phi = ${phi}, intersect: area ${got.intersect}`);
    assert.ok(Math.abs(got.xor! - 80) <= 0.4, `phi = ${phi}, xor: area ${got.xor}`);
  }
});

test('a crossing closed on just past the end of the kept piece is kept', () => {
  // flat L = 1, p = 100·(t - 0.32)²·(t - 0.3), rel = 1e-4, phi = 0.7, moved by (37, -11).
  // Deep in the search one piece was cut down to a point 1e-9 past the end of the other
  // piece, and the pair was dropped: only the touch at 0.32 was reported.
  const c1: Cubic = [37, -11, 37.25494675154381, -10.785260006078582, 37.50989543574068, -10.570522306683728, 37.764842187284486, -10.355782312762308];
  const c2: Cubic = [37.00019790367352, -11.000234959519934, 37.25451246292692, -10.784744400465394, 37.51084750358673, -10.571652641457575, 37.76275698347443, -10.353306671570506];
  for (const { name, hits } of bothOrders(c1, c2)) {
    const what = `${name}: ${JSON.stringify(hits)}`;
    assert.ok(hits.some(([t1, t2]) => Math.abs(t1 - 0.3) < 1e-6 && Math.abs(t2 - 0.3) < 1e-6), `no crossing, ${what}`);
    assert.ok(hits.some(([t1, t2]) => Math.abs(t1 - 0.32) < 1e-4 && Math.abs(t2 - 0.32) < 1e-4), `no touch, ${what}`);
  }
});
