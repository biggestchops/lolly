// SPDX-License-Identifier: MPL-2.0
/**
 * A path that repeats one C/S curve pair six times, found by the weekly fuzz soak
 * (target `geom` in tests/fuzz/targets.ts). The same bytes are kept as
 * tests/fuzz/regressions/geom-repeated-coincident-cs-pairs.bin, so the fuzz regression
 * replays them as well.
 *
 * ## What went wrong
 *
 * Every repeat draws the same C curve and the same S curve, and the last S differs from
 * the others only in its end point. Two S curves that share their first three control
 * points agree to third order at their shared start: at equal parameter they differ by
 * 36·t³ in y along a vertical tangent, so the gap between them grows like 72·t⁴ and stays
 * below 1e-9 for the first fifth of a percent of their parameter range. The stroke
 * outline built from the path has pieces of the same kind.
 *
 * Fat-line clipping cannot separate two pieces that close together. Each clip failed,
 * the search bisected, the halves failed the same way, and the number of pairs still in
 * play doubled with every second bisection until the depth cap stopped it. One such pair
 * cost 912,074 recursion steps, the path has five of them, and selfUnion took about a
 * second (stroke about half a second). The fix stops a stalled search once both pieces
 * are straight and lie along each other to within the tolerance (`atResolutionFloor` in
 * engine/src/geom/intersect.ts), then finds any crossing in those pieces from which side
 * of one curve the other is on (`scanStalled`), and answers curves that share a stretch
 * of boundary with the two ends of that stretch before any clipping (`sharedRun`).
 * Stopping alone, the first version of the fix, lost real shallow crossings; those cases
 * are in tests/geom-shallow-crossings.test.ts.
 *
 * ## Oracles
 *
 * None of them is the kernel's own opinion of its answer.
 *
 * 1. **Time.** Each operation has a budget far above what the fixed code needs and far
 *    below what the old code took, so a return of the old behaviour fails loudly.
 * 2. **Membership.** A grid of off-vertex points is classified on the RAW path and on
 *    each result. A result is right when it fills exactly the points the region algebra
 *    says it should. Points close to a boundary are skipped, because there the answer
 *    depends on rounding, not on the region.
 * 3. **Distance.** Offsets and strokes with round joins are dilations and erosions by a
 *    disc, so whether a point is filled is decided by its distance to the source, which
 *    is measured here by projecting onto each source curve.
 * 4. **Area identities.** Union, intersection, difference and xor of the same two
 *    operands must satisfy inclusion and exclusion.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeGeomApi } from '../engine/src/geom-api.ts';
import type { GeomPathResult, GeomResult } from '../packages/core/src/host-v1.ts';
import { type Cubic, evalCubic, nearestOnCubic, subCubic } from '../engine/src/geom/bezier.ts';
import { intersectCubics } from '../engine/src/geom/intersect.ts';
import type { GeomPath } from '../engine/src/geom/path.ts';

const geom = makeGeomApi();

/** The fuzz reproducer, byte for byte. */
const D = 'M0 0 C10 0 20 10 20 20 S30 40 40 4 C10 0 20 10 20 20 S30 40 40 4 '
  + 'C10 0 20 10 20 20 S30 40 40 4 C10 0 20 10 20 20 S30 40 40 4 '
  + 'C10 0 20 10 20 20 S30 40 40 4 C10 0 20 10 20 20 S30 40 40 40';

/** A square overlapping most of the path's lobes, so every boolean has work to do. */
const SQUARE = 'M5 5 L35 5 L35 35 L5 35 Z';
/** The fuzz target's own second operands. */
const FUZZ_UNION = 'M0 0 L10 0 L10 10 Z';
const FUZZ_DIFFERENCE = 'M2 2 L8 2 L8 8 Z';

/** Full precision on the way out, so area identities are not testing rounding. */
const EXACT = { decimals: 12 } as const;

// ── harness ───────────────────────────────────────────────────────────────────

function pathOf(r: GeomPathResult, what: string): string {
  assert.ok(r.ok, `${what}: expected ok, got ${r.ok ? '' : `${r.code} - ${r.message}`}`);
  assert.ok(!/NaN|Infinity|undefined/.test(r.d), `${what}: non-finite token in the result`);
  const parsed = geom.parse(r.d);
  assert.ok(parsed.ok, `${what}: the result does not parse back`);
  for (const c of parsed.value) {
    for (const k of c.curves) for (const n of k) assert.ok(Number.isFinite(n), `${what}: coordinate ${n}`);
  }
  return r.d;
}

function val<T>(r: GeomResult<T>, what: string): T {
  assert.ok(r.ok, `${what}: expected ok, got ${r.ok ? '' : `${r.code} - ${r.message}`}`);
  return r.value;
}

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const u = len2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + u * dx), py - (ay + u * dy));
}

/**
 * Nonzero membership from a path flattened to 400 chords a curve, closed, and a crossing
 * count. Independent of the boolean module's own winding test, which is what it checks.
 */
function nonzero(path: GeomPath): (x: number, y: number) => boolean {
  const polys = path.map((c) => {
    const pts: number[] = [];
    for (const k of c.curves) {
      for (let i = 0; i < 400; i++) {
        const p = evalCubic(k, i / 400);
        pts.push(p.x, p.y);
      }
    }
    const last = c.curves[c.curves.length - 1]!;
    pts.push(last[6], last[7]);
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
    return w !== 0;
  };
}

interface Shape {
  /** Filled under the nonzero rule, which is what `host.geom.contains` answers. */
  inside(x: number, y: number): boolean;
  /** Distance to the curves, plus the implicit closing edge of each contour when the
   *  shape is read as a region. A centreline is read without it. */
  distance(x: number, y: number): number;
}

/** Parse once through the bridge, then answer many points without re-parsing. */
function shape(d: string, asRegion = true): Shape {
  const contours = d === '' ? [] : val(geom.parse(d), 'parse');
  const path: GeomPath = contours.map((c) => ({ closed: c.closed, curves: c.curves.map((k) => [...k] as Cubic) }));
  const closing = asRegion
    ? path.map((c) => { const f = c.curves[0]!, l = c.curves[c.curves.length - 1]!; return [l[6], l[7], f[0], f[1]] as const; })
    : [];
  const filled = nonzero(path);
  return {
    inside: (x, y) => path.length > 0 && filled(x, y),
    distance: (x, y) => {
      let best = Infinity;
      for (const c of path) for (const k of c.curves) best = Math.min(best, nearestOnCubic(k, x, y).distance);
      for (const [ax, ay, bx, by] of closing) best = Math.min(best, segmentDistance(x, y, ax, ay, bx, by));
      return best;
    },
  };
}

/** Off-vertex grid over the path's box grown by six, one sample per unit. */
function forGrid(visit: (x: number, y: number) => void): void {
  for (let gx = -6; gx <= 46; gx++) {
    for (let gy = -6; gy <= 46; gy++) visit(gx + 0.137, gy + 0.219);
  }
}

const RAW = shape(D);
const SQ = shape(SQUARE);
/** The path's filled region as canonical contours. Its correctness is established by
 *  the selfUnion membership test below, and the offset oracles measure against it. */
const REGION_D = pathOf(geom.selfUnion(D, EXACT), 'selfUnion');
const REGION = shape(REGION_D);
/** Samples closer than this to a boundary are not classified: exact booleans. */
const EDGE = 0.01;
/** The same for fitted offsets, whose default tolerance is a hundredth of a unit. */
const FIT_EDGE = 0.05;

// ── 1. every operation answers promptly ───────────────────────────────────────

/**
 * What one call costs, in milliseconds: the smaller of wall time and this process's CPU
 * time. Other work on the machine stretches wall time but not CPU time, and garbage
 * collection on helper threads adds CPU time but not wall time, so the smaller of the
 * two tracks the work this call did. A test that timed wall clock alone failed under a
 * busy test run with the fixed code, at twenty times its quiet-machine cost.
 */
function timed<T>(run: () => T): { value: T; ms: number } {
  const wall0 = performance.now();
  const cpu0 = process.cpuUsage();
  const value = run();
  const cpu = process.cpuUsage(cpu0);
  return { value, ms: Math.min(performance.now() - wall0, (cpu.user + cpu.system) / 1000) };
}

/**
 * Per-operation budget. Measured on an Apple-silicon laptop with the cost above: before
 * the fix, each boolean on this path took 900 to 2,400 ms and each stroke 420 to 750 ms.
 * After it, each operation here takes between 3 and 70 ms. The budget leaves a factor of
 * five for a slower machine, and every boolean of the old code exceeds it at least twice
 * over.
 */
const OP_BUDGET_MS = 400;
/** The whole set together: about 400 ms after the fix, 7,500 ms or more before it. */
const TOTAL_BUDGET_MS = 2000;

test('every boolean, offset and stroke operation on the path answers promptly', () => {
  // Compile the kernel's paths first, so the budget measures this input rather than
  // the first use of the module.
  geom.union([SQUARE, 'M20 20 L50 20 L50 50 Z']);
  geom.offset(SQUARE, 2, { join: 'round' });
  geom.stroke('M0 0 C10 0 20 10 20 20', 2);

  const ops: [string, () => GeomPathResult][] = [
    ['selfUnion', () => geom.selfUnion(D)],
    ['union (fuzz operand)', () => geom.union([D, FUZZ_UNION])],
    ['difference (fuzz operand)', () => geom.difference([D, FUZZ_DIFFERENCE])],
    ['union', () => geom.union([D, SQUARE], EXACT)],
    ['intersect', () => geom.intersect([D, SQUARE], EXACT)],
    ['difference', () => geom.difference([D, SQUARE], EXACT)],
    ['xor', () => geom.xor([D, SQUARE], EXACT)],
    ['offset, open path', () => geom.offset(D, 3)],
    ['offset, closed, outward', () => geom.offset(`${D} Z`, 3)],
    ['offset, closed, inward', () => geom.offset(`${D} Z`, -2)],
    ['offset, closed, round joins', () => geom.offset(`${D} Z`, 3, { join: 'round' })],
    ['stroke', () => geom.stroke(D, 2)],
    ['stroke, round joins and caps', () => geom.stroke(D, 2, { join: 'round', cap: 'round' })],
  ];
  let total = 0;
  const report: string[] = [];
  for (const [what, run] of ops) {
    const { value: r, ms } = timed(run);
    total += ms;
    report.push(`${what} ${ms.toFixed(0)}ms`);
    const d = pathOf(r, what);
    assert.ok(d.length > 0, `${what}: an empty result for a path that fills a region`);
    assert.ok(ms < OP_BUDGET_MS, `${what} took ${ms.toFixed(0)}ms (budget ${OP_BUDGET_MS}ms): ${report.join(', ')}`);
  }
  assert.ok(total < TOTAL_BUDGET_MS, `all operations took ${total.toFixed(0)}ms: ${report.join(', ')}`);
});

// ── 2. the answers are the right regions ──────────────────────────────────────

test('selfUnion fills exactly what the raw path fills, as closed contours', () => {
  const contours = val(geom.parse(REGION_D), 'parse');
  assert.ok(contours.length > 0, 'the path fills a region');
  for (const c of contours) {
    assert.ok(c.closed, 'every contour of a region is closed');
    const first = c.curves[0]!, last = c.curves[c.curves.length - 1]!;
    assert.ok(Math.hypot(last[6]! - first[0]!, last[7]! - first[1]!) < 1e-9, 'a contour ends where it starts');
  }
  let checked = 0, inside = 0;
  forGrid((x, y) => {
    if (RAW.distance(x, y) < EDGE) return;
    const want = RAW.inside(x, y);
    assert.equal(REGION.inside(x, y), want, `selfUnion differs from the raw path at (${x}, ${y})`);
    checked++;
    if (want) inside++;
  });
  assert.ok(checked > 2500 && inside > 400, `grid too thin: ${checked} checked, ${inside} inside`);
  // The API answers the same question the same way.
  assert.equal(val(geom.contains(REGION_D, 12.137, 6.219), 'contains'), RAW.inside(12.137, 6.219));
});

test('booleans against an overlapping square follow the region algebra', () => {
  const ds = {
    union: pathOf(geom.union([D, SQUARE], EXACT), 'union'),
    intersect: pathOf(geom.intersect([D, SQUARE], EXACT), 'intersect'),
    difference: pathOf(geom.difference([D, SQUARE], EXACT), 'difference'),
    xor: pathOf(geom.xor([D, SQUARE], EXACT), 'xor'),
  };
  const rule = {
    union: (a: boolean, b: boolean) => a || b,
    intersect: (a: boolean, b: boolean) => a && b,
    difference: (a: boolean, b: boolean) => a && !b,
    xor: (a: boolean, b: boolean) => a !== b,
  };
  const ops = Object.keys(ds) as (keyof typeof ds)[];
  const shapes = Object.fromEntries(ops.map((op) => [op, shape(ds[op])])) as Record<keyof typeof ds, Shape>;
  let checked = 0;
  forGrid((x, y) => {
    if (RAW.distance(x, y) < EDGE || SQ.distance(x, y) < EDGE) return;
    const a = RAW.inside(x, y), b = SQ.inside(x, y);
    for (const op of ops) {
      assert.equal(shapes[op].inside(x, y), rule[op](a, b), `${op} is wrong at (${x}, ${y}): in A ${a}, in B ${b}`);
    }
    checked++;
  });
  assert.ok(checked > 2500, `grid too thin: ${checked}`);

  // Inclusion and exclusion, on exact areas of the returned outlines.
  const area = (d: string) => Math.abs(val(geom.area(d), 'area'));
  const A = area(REGION_D), B = 900;
  const U = area(ds.union), I = area(ds.intersect);
  const near = (got: number, want: number, what: string) =>
    assert.ok(Math.abs(got - want) <= 1e-6, `${what}: ${got} !== ${want}`);
  near(U + I, A + B, '|A ∪ B| + |A ∩ B| = |A| + |B|');
  near(area(ds.difference), A - I, '|A − B| = |A| − |A ∩ B|');
  near(area(ds.xor), U - I, '|A xor B| = |A ∪ B| − |A ∩ B|');
  assert.ok(I > 0 && I < Math.min(A, B), `the operands overlap partly: |A ∩ B| = ${I}`);
});

test('the fuzz target\'s own operands give the right regions too', () => {
  const union = shape(pathOf(geom.union([D, FUZZ_UNION]), 'union'));
  const difference = shape(pathOf(geom.difference([D, FUZZ_DIFFERENCE]), 'difference'));
  const tri = shape(FUZZ_UNION), notch = shape(FUZZ_DIFFERENCE);
  // Output is rounded to four places here, so the margin is wider than for EXACT results.
  const edge = 1e-3;
  let checked = 0;
  forGrid((x, y) => {
    if (RAW.distance(x, y) < edge) return;
    const a = RAW.inside(x, y);
    if (tri.distance(x, y) >= edge) {
      assert.equal(union.inside(x, y), a || tri.inside(x, y), `union at (${x}, ${y})`);
    }
    if (notch.distance(x, y) >= edge) {
      assert.equal(difference.inside(x, y), a && !notch.inside(x, y), `difference at (${x}, ${y})`);
    }
    checked++;
  });
  assert.ok(checked > 2500, `grid too thin: ${checked}`);
});

test('offsets of the path\'s region keep the distance they were asked for', () => {
  // Measured on the canonical region. The raw path is one contour whose first lobe winds
  // against its six loops, and `offsetPath` decides "outward" once per path from the
  // largest contour, so on the raw path that lobe is shrunk like a hole. That rule is
  // documented in offset.ts, is the same before and after this fix, and is not what a
  // distance oracle can check. The raw path's offsets are timed above.
  //
  // Round joins make the offset a dilation (or erosion) by a disc, so membership is
  // decided exactly by the distance to the region's outline.
  const grown = shape(pathOf(geom.offset(REGION_D, 3, { join: 'round' }), 'offset +3 round'));
  const shrunk = shape(pathOf(geom.offset(REGION_D, -2, { join: 'round' }), 'offset -2 round'));
  // Mitred joins reach further at convex corners, by at most the mitre limit.
  const mitred = shape(pathOf(geom.offset(REGION_D, 3), 'offset +3 miter'));
  let inGrown = 0, inShrunk = 0;
  forGrid((x, y) => {
    const dist = REGION.distance(x, y);
    if (dist < EDGE) return;
    const a = REGION.inside(x, y);
    if (Math.abs(dist - 3) >= FIT_EDGE) {
      const want = a || dist < 3;
      assert.equal(grown.inside(x, y), want, `outward offset at (${x}, ${y}), distance ${dist}, inside ${a}`);
      if (want) {
        assert.ok(mitred.inside(x, y), `mitred offset misses (${x}, ${y}), distance ${dist}`);
        inGrown++;
      }
    }
    if (mitred.inside(x, y)) assert.ok(a || dist < 3 * 4 + FIT_EDGE, `mitred offset reaches (${x}, ${y}), distance ${dist}`);
    if (Math.abs(dist - 2) >= FIT_EDGE) {
      const want = a && dist > 2;
      assert.equal(shrunk.inside(x, y), want, `inward offset at (${x}, ${y}), distance ${dist}, inside ${a}`);
      if (want) inShrunk++;
    }
  });
  assert.ok(inGrown > 1000 && inShrunk > 50, `grid too thin: ${inGrown} grown, ${inShrunk} shrunk`);

  // The open path is offset as a single trace on the left of travel, as the fuzz target
  // asks for it: no region is involved, so the result stays open.
  const trace = val(geom.parse(pathOf(geom.offset(D, 3), 'offset open')), 'parse');
  assert.ok(trace.length > 0 && trace.every((c) => !c.closed), 'an open path offsets to open traces');
});

test('the stroke covers exactly the points within half its width of the centreline', () => {
  const half = 1;
  const centreline = shape(D, false);
  const round = shape(pathOf(geom.stroke(D, 2 * half, { join: 'round', cap: 'round' }), 'round stroke'));
  const plain = shape(pathOf(geom.stroke(D, 2 * half), 'default stroke'));
  let painted = 0;
  forGrid((x, y) => {
    const dist = centreline.distance(x, y);
    if (Math.abs(dist - half) < FIT_EDGE) return;
    const want = dist < half;
    assert.equal(round.inside(x, y), want, `round stroke at (${x}, ${y}), distance ${dist}`);
    if (want) painted++;
    // SVG's defaults: butt caps stop at the two ends of the path, and mitred joins reach
    // at most the mitre limit (4) times the half width from the centreline. The only
    // corners are at (40, 4), about 82 degrees, well inside that limit.
    const nearEnd = Math.hypot(x, y) < half + FIT_EDGE || Math.hypot(x - 40, y - 40) < half + FIT_EDGE;
    if (want && !nearEnd) assert.ok(plain.inside(x, y), `default stroke misses (${x}, ${y}), distance ${dist}`);
    if (plain.inside(x, y)) assert.ok(dist < 4 * half + FIT_EDGE, `default stroke reaches (${x}, ${y}), distance ${dist}`);
  });
  assert.ok(painted > 50, `grid too thin: ${painted} painted`);
});

test('the reproducer is kept in the fuzz regression corpus, byte for byte', () => {
  const bytes = readFileSync(new URL('./fuzz/regressions/geom-repeated-coincident-cs-pairs.bin', import.meta.url));
  assert.equal(bytes.toString('utf8'), D);
});

// ── 3. the intersector pieces behind it ───────────────────────────────────────

function onBoth(c1: Cubic, c2: Cubic, hits: { t1: number; t2: number; x: number; y: number }[], eps = 1e-6): void {
  for (const h of hits) {
    const p = evalCubic(c1, h.t1), q = evalCubic(c2, h.t2);
    assert.ok(Math.hypot(p.x - q.x, p.y - q.y) <= eps, `t1=${h.t1} and t2=${h.t2} name different points`);
    assert.ok(Math.hypot(p.x - h.x, p.y - h.y) <= eps, `the reported point is not on the curve at t1=${h.t1}`);
  }
}

test('two S curves that agree to third order at a shared start answer at once', () => {
  // x(t) is the same for both and increases, and y differs by 36·t³, so the only point
  // the two curves share is the start. The old search spent 912,074 steps and about
  // 200 ms on this pair and returned a scatter of points along the touching stretch.
  const a: Cubic = [20, 20, 20, 30, 30, 40, 40, 4];
  const b: Cubic = [20, 20, 20, 30, 30, 40, 40, 40];
  const { value: hits, ms } = timed(() => intersectCubics(a, b));
  assert.ok(ms < 50, `took ${ms.toFixed(1)}ms`);
  onBoth(a, b, hits);
  for (const h of hits) assert.ok(h.t1 < 0.01 && h.t2 < 0.01, `a hit away from the touching stretch: ${h.t1}, ${h.t2}`);
});

test('a genuine crossing beside a touching stretch is still reported', () => {
  // `a` follows the first half of `b` exactly for its first three control points, so the
  // two touch to second order at their shared start and the search stalls there (on 24
  // pairs of pieces). Its last two control points are pushed a little to either side, so
  // it also crosses `b` once, properly, at its own midpoint, where the two curves are
  // about 1e-3 apart on either side. Stopping the search on the touching stretch must not
  // lose the crossing.
  const a: Cubic = [19, 20, 19, 25.27649095165806, 21.610847594963587, 30.526912234714537, 25.54535257387643, 34.456104364574124];
  const b: Cubic = [19, 20, 19, 30.552981903316123, 29.447018096681944, 40.99999999999999, 40, 41];
  const { value: hits, ms } = timed(() => intersectCubics(a, b));
  assert.ok(ms < 50, `took ${ms.toFixed(1)}ms`);
  onBoth(a, b, hits);
  assert.ok(hits.some((h) => Math.abs(h.t1 - 0.5) < 1e-7 && Math.abs(h.t2 - 0.25) < 1e-7),
    `the crossing at t1=0.5 is missing: ${JSON.stringify(hits)}`);
  assert.ok(hits.every((h) => Math.abs(h.t1 - 0.5) < 1e-7 || (h.t1 < 1e-6 && h.t2 < 1e-6)),
    `a hit that is neither the crossing nor the shared start: ${JSON.stringify(hits)}`);
});

test('a crossing close to a shared start, in a thin sliver, is reported where it is', () => {
  // Two pieces of the reproducer's stroke outline. They share their start, touch along a
  // short stretch and cross 0.53 units further on, never more than 1.3e-6 apart before the
  // crossing. That is wider than 1e-8 of their size, and the crossing is 0.41 of the way
  // along the shorter piece, so it is not moved onto the shared start (`foldSlivers` in
  // engine/src/geom/intersect.ts). The previous version of this fix did move it there.
  const a: Cubic = [19, 20, 19.000000000000004, 20.427933147093402, 19.017168140579642, 20.855636615117888, 19.050803317140662, 21.28007468142219];
  const b: Cubic = [19, 20, 19, 30.552981903316123, 29.447018096681944, 40.99999999999999, 40, 41];
  const { value: hits, ms } = timed(() => intersectCubics(a, b));
  assert.ok(ms < 50, `took ${ms.toFixed(1)}ms`);
  onBoth(a, b, hits);
  assert.equal(hits.length, 2, JSON.stringify(hits));
  assert.deepEqual([hits[0]!.t1, hits[0]!.t2], [0, 0]);
  assert.ok(Math.abs(hits[1]!.t1 - 0.4098923) < 1e-6 && Math.abs(hits[1]!.t2 - 0.0166155) < 1e-6, JSON.stringify(hits));
});

test('curves that share a stretch are reported as the two ends of it', () => {
  // The documented contract, which the search used to answer with a scatter of points
  // spread along the shared stretch, after up to several seconds.
  const P: Cubic = [0, 0, 30, 60, 70, 60, 100, 0];
  const reversed: Cubic = [P[6], P[7], P[4], P[5], P[2], P[3], P[0], P[1]];
  const cases: [string, Cubic, Cubic, [number, number][]][] = [
    ['identical', P, P, [[0, 0], [1, 1]]],
    ['reversed', P, reversed, [[0, 1], [1, 0]]],
    ['the first half of itself', P, subCubic(P, 0, 0.5), [[0, 0], [0.5, 1]]],
    ['two overlapping pieces', subCubic(P, 0, 0.7), subCubic(P, 0.3, 1), [[0.3 / 0.7, 0], [1, 0.4 / 0.7]]],
  ];
  for (const [what, a, b, want] of cases) {
    const { value: hits, ms } = timed(() => intersectCubics(a, b));
    assert.ok(ms < 50, `${what}: took ${ms.toFixed(1)}ms`);
    assert.equal(hits.length, 2, `${what}: expected the two ends, got ${hits.length}`);
    onBoth(a, b, hits, 1e-9);
    for (const [i, [t1, t2]] of want.entries()) {
      assert.ok(Math.abs(hits[i]!.t1 - t1) < 1e-9 && Math.abs(hits[i]!.t2 - t2) < 1e-9,
        `${what}: end ${i} is (${hits[i]!.t1}, ${hits[i]!.t2}), expected (${t1}, ${t2})`);
    }
  }
  // Two arches that share both end points but differ in between enclose a lens, so they
  // are not a shared stretch, and the only points they have in common are those ends.
  const lens = intersectCubics(P, [0, 0, 30, 80, 70, 80, 100, 0]);
  assert.ok(lens.every((h) => (h.t1 < 1e-9 && h.t2 < 1e-9) || (h.t1 > 1 - 1e-9 && h.t2 > 1 - 1e-9)),
    `arches that meet only at their ends: ${JSON.stringify(lens)}`);
});
