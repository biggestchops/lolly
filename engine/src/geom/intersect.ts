// SPDX-License-Identifier: MPL-2.0
/**
 * Curve intersection. Every boolean, offset, and stroke outline in this module depends
 * on this file. If this file is wrong, the whole geometry layer is wrong.
 *
 * ## Three cases, cheapest and most exact first
 *
 * | pair | method | exactness |
 * |---|---|---|
 * | line × line | one determinant | exact |
 * | line × cubic | cubic root solve in the line's frame | exact to root-solver precision |
 * | cubic × cubic | fat-line (Bézier) clipping | converges quadratically to `tol` |
 *
 * A line is not a special case in the data model. It is a cubic with collinear
 * controls. So the code picks a method by testing the geometry, not by checking a type
 * tag, and a curve that happens to be straight gets the exact line method automatically.
 *
 * ## Why fat-line clipping instead of subdivision
 *
 * The obvious method is recursive bisection: split both curves, keep the pairs whose
 * boxes overlap, and stop when the pieces are small. This converges LINEARLY, so
 * pinning an intersection to 1e-9 takes about 30 levels and up to 2^30 pairs in the
 * worst case. Fat-line clipping (Sederberg & Nishita 1990) instead computes, in one
 * step, the parameter interval of curve A that could possibly lie inside the "fat
 * line" bounding curve B, and discards the rest. This converges quadratically, usually
 * 5-8 iterations to full double precision, and it never approximates the curve, only
 * narrows down where it can be. Bisection is kept as a fallback for when clipping
 * cannot make progress: near-tangential contact, where the fat line barely clips
 * anything.
 *
 * ## The root solve is by isolation, and it carries a direction
 *
 * `cubicRoots01` finds its roots between the derivative's zeros rather than from Cardano's
 * formula, reports a repeated root once, and hands each root the sign the cubic changes by
 * there. That direction reaches a caller as `Intersection.dir` on the line paths, and the
 * boolean's ray cast counts a crossing from it instead of from the tangent at the root,
 * which at the apex of a cusp is a rounding-sized vector pointing anywhere. See
 * `cubicRoots01` for what the closed form got wrong and where.
 *
 * ## What "clean" means here
 *
 * Results are parameters on the ORIGINAL curves. The point is then computed FROM the
 * curve, so it lies on the curve to machine precision, not just near it. Nothing here
 * flattens the curve, samples it, or rasterises it.
 */
import {
  type Cubic, type Pt, evalCubic, splitCubic, subCubic, boundsCubic, hullBounds,
  boxesOverlap, isLineCubic, flatnessCubic,
} from './bezier.ts';

/** One intersection: where it is, and its position on each input. */
export interface Intersection {
  /** Parameter on the first curve, 0..1. */
  t1: number;
  /** Parameter on the second curve, 0..1. */
  t2: number;
  x: number;
  y: number;
  /** Set by `intersectLineCubic` only: which way the curve crosses the line, as the sign
   *  change of its signed distance to the line at the root. +1 where the curve passes from
   *  the line's right to its left (the side its normal points to), -1 the other way, 0 where
   *  it touches the line without crossing. A winding count reads the crossing from this
   *  rather than from the tangent at the root, which at a cusp is a rounding-sized vector
   *  pointing anywhere. */
  dir?: number;
}

/** Default positional tolerance, in the caller's units (CSS px throughout Lolly).
 *  A thousandth of a pixel is far below anything a renderer can show and still leaves
 *  headroom above double-precision noise on page-sized coordinates. */
export const EPS = 1e-9;
const T_EPS = 1e-9;

// ── exact: line × line ────────────────────────────────────────────────────────

/** Intersect two segments given by endpoints. Returns null for parallel or
 *  non-overlapping. Parameters are along each segment, 0..1. */
export function intersectSegments(
  ax0: number, ay0: number, ax1: number, ay1: number,
  bx0: number, by0: number, bx1: number, by1: number,
): Intersection | null {
  const rx = ax1 - ax0, ry = ay1 - ay0;
  const sx = bx1 - bx0, sy = by1 - by0;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-14) return null;   // parallel or degenerate
  const qpx = bx0 - ax0, qpy = by0 - ay0;
  const t = (qpx * sy - qpy * sx) / denom;
  const u = (qpx * ry - qpy * rx) / denom;
  if (t < -T_EPS || t > 1 + T_EPS || u < -T_EPS || u > 1 + T_EPS) return null;
  const tc = Math.min(1, Math.max(0, t)), uc = Math.min(1, Math.max(0, u));
  return { t1: tc, t2: uc, x: ax0 + rx * tc, y: ay0 + ry * tc };
}

// ── exact: cubic root solve ───────────────────────────────────────────────────

/**
 * Real roots of a·t³ + b·t² + c·t + d within [0,1].
 *
 * By isolation, not by the closed form. The derivative's roots cut [0, 1] into at most
 * three intervals on which the cubic is monotone, each interval whose end values differ in
 * sign holds exactly one root, and that root is found by Newton steps kept inside the
 * interval, with bisection where a step leaves it. A root the cubic touches without
 * crossing (a double root) sits at a critical point where the value is zero to rounding,
 * and is reported once; a triple root, where both critical points fall together, is one
 * root. So the count of reported roots matches the cubic's sign changes, which is what a
 * winding count needs, and a double root is still there for a caller after a tangency.
 *
 * Cardano's formula was used before this, with a Newton polish, and it was wrong in the
 * two places the geometry visits most: a leading coefficient small against the others (a
 * copy of a symmetric curve nudged by a billionth, against a horizontal line) cancelled
 * catastrophically and returned NO root where the line crossed the curve twice; and a
 * repeated root (any line through the apex of a cusp) put the discriminant within rounding
 * of zero, the branch taken depended on the sign of that rounding, and the polish, dividing
 * a rounding-sized value by a rounding-sized slope, walked one copy of the root a hundredth
 * of the curve away, to a point where the cubic was nowhere near zero. A ray cast then
 * counted that point as a crossing. Isolation has no branch to get wrong and no closed form
 * to cancel, and it is exact to rounding for any coefficients, a leading coefficient of
 * exactly zero included.
 *
 * `dirs`, when given, is filled with one direction per reported root: the sign the cubic
 * changes by there, or 0 where it touches zero without changing sign.
 */
export function cubicRoots01(a: number, b: number, c: number, d: number, dirs?: number[]): number[] {
  const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d));
  if (!(scale > 0) || !Number.isFinite(scale)) return [];
  // A value this close to zero is zero to rounding: the coefficients carry a few ulps of
  // their own size, and evaluating the cubic at a parameter in [0, 1] adds a few more.
  const tiny = ROOT_SNAP * Number.EPSILON * scale;
  // The cuts: the two ends, plus the derivative's zeros where they fall between them. Four
  // at most, in fixed slots rather than a growing array, because this runs once per curve
  // per ray cast and the allocation showed up in the boolean's profile.
  //
  // The ends carry the parameter slack every root is accepted at: a curve starting exactly
  // on a line has its root a rounding error outside [0, 1], at -1e-19, and isolating over
  // [0, 1] alone found no sign change there. Every end cap of a band against the curve it
  // caps lost its vertex that way.
  const cuts = [-T_EPS, 1 + T_EPS, 0, 0];
  let nc = 2;
  // Critical points, by the stable form of the quadratic formula so that a tiny leading
  // coefficient does not cancel the root that lies in [0, 1].
  const qa = 3 * a, qb = 2 * b, qc = c;
  if (Math.abs(qa) > 1e-300) {
    const disc = qb * qb - 4 * qa * qc;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const q = -0.5 * (qb + (qb < 0 ? -sq : sq));
      const r0 = q !== 0 ? q / qa : -qb / (2 * qa), r1 = q !== 0 ? qc / q : r0;
      if (r0 > -T_EPS && r0 < 1 + T_EPS) cuts[nc++] = r0;
      if (q !== 0 && r1 > -T_EPS && r1 < 1 + T_EPS) cuts[nc++] = r1;
    }
  } else if (Math.abs(qb) > 1e-300) {
    const r = -qc / qb;
    if (r > -T_EPS && r < 1 + T_EPS) cuts[nc++] = r;
  }
  // Insertion sort: four entries at most.
  for (let i = 1; i < nc; i++) {
    const v = cuts[i]!;
    let j = i - 1;
    while (j >= 0 && cuts[j]! > v) { cuts[j + 1] = cuts[j]!; j--; }
    cuts[j + 1] = v;
  }
  const vals = [0, 0, 0, 0];
  for (let i = 0; i < nc; i++) {
    const v = ((a * cuts[i]! + b) * cuts[i]! + c) * cuts[i]! + d;
    vals[i] = Math.abs(v) <= tiny ? 0 : v;
  }
  // Roots in the order they are found: repeated ones first, then the sign changes. Both
  // sequences run left to right, so the merge below sorts four entries at most.
  const out: number[] = [], sg: number[] = [];
  // A critical point where the cubic is zero to rounding is a repeated root. Two of them
  // are a triple root (a cubic has no other way to touch zero twice), reported once, in the
  // middle: a vertical line through the apex of a cusp nudged sideways by a billionth has
  // exactly that, and reporting both critical points counted one crossing as two. The
  // direction of a repeated root is read from the values either side of it: a double root
  // touches without crossing, a triple root crosses.
  for (let i = 0; i < nc; i++) {
    if (vals[i] !== 0) continue;
    let j = i;
    while (j + 1 < nc && vals[j + 1] === 0) j++;
    const before = i > 0 ? vals[i - 1]! : 0, after = j + 1 < nc ? vals[j + 1]! : 0;
    const t = (cuts[i]! + cuts[j]!) / 2;
    if (t >= -T_EPS && t <= 1 + T_EPS) {
      out.push(Math.min(1, Math.max(0, t)));
      sg.push(before < 0 && after > 0 ? 1 : before > 0 && after < 0 ? -1 : 0);
    }
    i = j;
  }
  for (let i = 1; i < nc; i++) {
    const lo = cuts[i - 1]!, hi = cuts[i]!, flo = vals[i - 1]!, fhi = vals[i]!;
    if (flo === 0 || fhi === 0 || (flo < 0) === (fhi < 0)) continue;
    let x0 = lo, x1 = hi, f0 = flo, t = (lo + hi) / 2;
    for (let k = 0; k < 80; k++) {
      const ft = ((a * t + b) * t + c) * t + d;
      if (ft === 0) break;
      if ((ft < 0) === (f0 < 0)) { x0 = t; f0 = ft; } else x1 = t;
      if (x1 - x0 <= 4e-16) break;
      const slope = (3 * a * t + 2 * b) * t + c;
      let next = slope !== 0 ? t - ft / slope : (x0 + x1) / 2;
      if (!(next > x0 && next < x1)) next = (x0 + x1) / 2;
      t = next;
    }
    if (t >= -T_EPS && t <= 1 + T_EPS) { out.push(Math.min(1, Math.max(0, t))); sg.push(fhi > 0 ? 1 : -1); }
  }
  return dedupeRoots(out, sg, dirs);
}

/** Ulps of the largest coefficient within which a value of the cubic counts as zero. */
const ROOT_SNAP = 32;

/** Roots sorted and merged where they fall within 1e-9 of each other. Two crossings that
 *  merge cancel their directions, as the curve comes back to the side it started on.
 *
 *  Sorted by insertion, and the common counts answered before that: a cubic has three roots
 *  at most, this is called once per curve per ray cast, and a comparator sort allocates. */
function dedupeRoots(ts: number[], sg: number[], dirs?: number[]): number[] {
  const n = ts.length;
  if (n === 0) { if (dirs) dirs.length = 0; return ts; }
  if (n === 1) { if (dirs) { dirs.length = 0; dirs.push(sg[0]!); } return ts; }
  for (let i = 1; i < n; i++) {
    const t = ts[i]!, g = sg[i]!;
    let j = i - 1;
    while (j >= 0 && ts[j]! > t) { ts[j + 1] = ts[j]!; sg[j + 1] = sg[j]!; j--; }
    ts[j + 1] = t; sg[j + 1] = g;
  }
  const out: number[] = [];
  const dd: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = ts[i]!;
    if (!out.length || t - out[out.length - 1]! > 1e-9) { out.push(t); dd.push(sg[i]!); }
    else dd[dd.length - 1] = Math.sign(dd[dd.length - 1]! + sg[i]!);
  }
  if (dirs) { dirs.length = 0; for (const v of dd) dirs.push(v); }
  return out;
}

/**
 * Line × cubic, exactly.
 *
 * Rewriting the cubic in the line's own frame turns "where do they meet" into "where
 * is the curve's signed distance to the line zero" - a scalar cubic in `t`, solved in
 * closed form. No iteration, no subdivision, and the roots are the true parameters.
 */
export function intersectLineCubic(
  x0: number, y0: number, x1: number, y1: number, c: Cubic, tol = EPS, clamp = true,
): Intersection[] {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 1e-12) return [];
  // Unit normal: dot with (P - lineStart) gives signed distance.
  const nx = -dy / len, ny = dx / len;
  const dist = (px: number, py: number) => nx * (px - x0) + ny * (py - y0);
  const d0 = dist(c[0], c[1]), d1 = dist(c[2], c[3]), d2 = dist(c[4], c[5]), d3 = dist(c[6], c[7]);
  // Bernstein → power basis for the distance polynomial.
  const A = -d0 + 3 * d1 - 3 * d2 + d3;
  const B = 3 * d0 - 6 * d1 + 3 * d2;
  const C = -3 * d0 + 3 * d1;
  const D = d0;

  const out: Intersection[] = [];
  const dirs: number[] = [];
  const roots = cubicRoots01(A, B, C, D, dirs);
  for (let i = 0; i < roots.length; i++) {
    const t = roots[i]!;
    const p = evalCubic(c, t);
    // Where along the line does it land? Outside the segment is not an intersection.
    const u = ((p.x - x0) * dx + (p.y - y0) * dy) / (len * len);
    if (u < -tol / len || u > 1 + tol / len) continue;
    // A caller that looks a little way past the segment's ends (the boolean's ray cast, which
    // looks behind its origin) needs the fraction as it is, sign and all; a clamped fraction
    // put every hit just behind the origin AT the origin, where it read as a curve through
    // the point.
    out.push({ t1: clamp ? Math.min(1, Math.max(0, u)) : u, t2: t, x: p.x, y: p.y, dir: dirs[i] });
  }
  return out;
}

// ── fat-line clipping: cubic × cubic ──────────────────────────────────────────

/** The fat line of a curve: the line through its endpoints, plus the signed
 *  distances of the two interior controls, widened to bound the whole curve.
 *  A cubic lies entirely within the convex hull of its controls, so the extreme
 *  control distances (scaled by the standard 3/4 factor) bound it. */
function fatLine(c: Cubic): { nx: number; ny: number; c0: number; dMin: number; dMax: number } | null {
  let dx = c[6] - c[0], dy = c[7] - c[1];
  if (Math.hypot(dx, dy) < 1e-12) {
    // Closed or near-closed curve: use the longest control leg for a direction.
    dx = c[4] - c[0]; dy = c[5] - c[1];
    if (Math.hypot(dx, dy) < 1e-12) return null;
  }
  const len = Math.hypot(dx, dy);
  const nx = -dy / len, ny = dx / len;
  const c0 = nx * c[0] + ny * c[1];
  const d1 = nx * c[2] + ny * c[3] - c0;
  const d2 = nx * c[4] + ny * c[5] - c0;
  // Sederberg's bound: the hull of the distance-Bernstein polygon, tightened by 3/4
  // when both interior distances share a sign, 4/9 otherwise.
  const k = d1 * d2 > 0 ? 3 / 4 : 4 / 9;
  const dMin = k * Math.min(0, d1, d2);
  const dMax = k * Math.max(0, d1, d2);
  return { nx, ny, c0, dMin, dMax };
}

/**
 * Clip `c`'s parameter range to the part that could lie inside `fat`.
 *
 * The distance of `c` from the fat line's axis is itself a cubic in `t`, in Bernstein
 * form. Its convex hull in (t, distance) space bounds it, so intersecting that hull
 * with the horizontal band [dMin, dMax] gives a parameter interval that provably
 * contains every intersection - and usually discards most of the domain in one step.
 */
function clipToFatLine(c: Cubic, fat: NonNullable<ReturnType<typeof fatLine>>): [number, number] | null {
  const d = [
    fat.nx * c[0] + fat.ny * c[1] - fat.c0,
    fat.nx * c[2] + fat.ny * c[3] - fat.c0,
    fat.nx * c[4] + fat.ny * c[5] - fat.c0,
    fat.nx * c[6] + fat.ny * c[7] - fat.c0,
  ];
  const pts: Pt[] = d.map((v, i) => ({ x: i / 3, y: v }));

  // Convex hull of four points with monotonically increasing x - the upper and lower
  // chains are enough, and cheaper than a general hull.
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const chain = (sign: number): Pt[] => {
    const h: Pt[] = [];
    for (const p of pts) {
      while (h.length >= 2 && sign * cross(h[h.length - 2]!, h[h.length - 1]!, p) <= 0) h.pop();
      h.push(p);
    }
    return h;
  };
  const upper = chain(-1), lower = chain(1);

  // Where does a hull chain cross a horizontal level? Those crossings bracket the
  // surviving parameter range.
  const crossings = (h: Pt[], level: number): number[] => {
    const ts: number[] = [];
    for (let i = 1; i < h.length; i++) {
      const a = h[i - 1]!, b = h[i]!;
      if ((a.y - level) * (b.y - level) <= 0 && Math.abs(b.y - a.y) > 1e-18) {
        ts.push(a.x + ((level - a.y) * (b.x - a.x)) / (b.y - a.y));
      }
    }
    return ts;
  };

  const inBand = (v: number) => v >= fat.dMin - 1e-12 && v <= fat.dMax + 1e-12;
  const ts: number[] = [];
  for (const h of [upper, lower]) { ts.push(...crossings(h, fat.dMin), ...crossings(h, fat.dMax)); }
  if (inBand(d[0]!)) ts.push(0);
  if (inBand(d[3]!)) ts.push(1);
  if (!ts.length) return null;                    // entirely outside the band
  const lo = Math.max(0, Math.min(...ts)), hi = Math.min(1, Math.max(...ts));
  return hi < lo ? null : [lo, hi];
}

/** Cubic × cubic, by alternating fat-line clips with bisection when a clip stalls. */
function clipIntersect(
  c1: Cubic, c2: Cubic, t1lo: number, t1hi: number, t2lo: number, t2hi: number,
  tol: number, depth: number, out: Intersection[], swap = false,
): void {
  // `swap` tracks whether c1/c2 are currently the caller's second/first curve. The
  // recursion exchanges them every step (that alternation is what makes the clipping
  // converge quadratically), and this flag puts the parameters back the right way
  // round on the way out - rather than the results being silently transposed.
  const emit = (t1: number, t2: number, x: number, y: number) =>
    out.push(swap ? { t1: t2, t2: t1, x, y } : { t1, t2, x, y });
  if (out.length > 128 || depth > 60) return;
  if (!boxesOverlap(hullBounds(c1), hullBounds(c2), tol)) return;

  // Both pieces are down to a point: record one intersection.
  const s1 = Math.hypot(c1[6] - c1[0], c1[7] - c1[1]) + flatnessCubic(c1);
  const s2 = Math.hypot(c2[6] - c2[0], c2[7] - c2[1]) + flatnessCubic(c2);
  if (s1 <= tol && s2 <= tol) {
    const p = evalCubic(c1, 0.5);
    emit((t1lo + t1hi) / 2, (t2lo + t2hi) / 2, p.x, p.y);
    return;
  }

  const fat = fatLine(c2);
  const clipped = fat ? clipToFatLine(c1, fat) : [0, 1] as [number, number];
  if (!clipped) return;
  const [lo, hi] = clipped;
  const shrink = hi - lo;

  // A clip that removes less than a fifth of the domain is not making progress -
  // the classic near-tangential case. Bisect the LONGER curve and recurse on both
  // halves; this is what keeps the worst case finite rather than spinning.
  if (shrink > 0.8) {
    if (s1 >= s2) {
      const [a, b] = splitCubic(c1, 0.5);
      const mid = (t1lo + t1hi) / 2;
      clipIntersect(a, c2, t1lo, mid, t2lo, t2hi, tol, depth + 1, out, swap);
      clipIntersect(b, c2, mid, t1hi, t2lo, t2hi, tol, depth + 1, out, swap);
    } else {
      const [a, b] = splitCubic(c2, 0.5);
      const mid = (t2lo + t2hi) / 2;
      clipIntersect(c1, a, t1lo, t1hi, t2lo, mid, tol, depth + 1, out, swap);
      clipIntersect(c1, b, t1lo, t1hi, mid, t2hi, tol, depth + 1, out, swap);
    }
    return;
  }

  const nc1 = subCubic(c1, lo, hi);
  const nt1lo = t1lo + (t1hi - t1lo) * lo;
  const nt1hi = t1lo + (t1hi - t1lo) * hi;
  // Roles exchange so the next iteration clips the other curve.
  clipIntersect(c2, nc1, t2lo, t2hi, nt1lo, nt1hi, tol, depth + 1, out, !swap);
}

/** Merge results that are the same point reached by different subdivisions. */
function dedupe(list: Intersection[], tol: number): Intersection[] {
  const out: Intersection[] = [];
  for (const i of list) {
    if (!out.some((o) => Math.hypot(o.x - i.x, o.y - i.y) <= tol * 8
                      && Math.abs(o.t1 - i.t1) <= 1e-6 + tol
                      && Math.abs(o.t2 - i.t2) <= 1e-6 + tol)) out.push(i);
  }
  return out.sort((a, b) => a.t1 - b.t1);
}

/**
 * Where along a straight cubic's OWN parameterisation does a given chord fraction fall?
 *
 * The exact line paths above take a curve's endpoints and report a fraction along the
 * chord. For a cubic built by `lineToCubic` that fraction IS the parameter, because the
 * controls are evenly spaced. It is easy to assume this holds in general, but it does
 * not. `M0,0 C0,0 0,0 100,0` (handles resting on the start point, which is what a pen
 * tool with un-dragged handles, and much imported SVG, produce) is perfectly straight
 * but grossly non-uniform: its midpoint is at x=12.5, not 50. Returning the chord
 * fraction as `t` in that case gives a point that is on the LINE but nowhere near the
 * curve at that parameter. Every consumer splits with `subCubic(c, t)`, so the split
 * lands in the wrong place and the resulting geometry does not close.
 *
 * So convert it. The along-chord displacement is itself a cubic in `t` (the Bernstein
 * coefficients are just the controls projected onto the chord), so this uses the same
 * closed-form root solve as everything else in this file: exact, not a search.
 */
function chordFractionToParam(c: Cubic, u: number): number {
  const dx = c[6] - c[0], dy = c[7] - c[1];
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-24) return u;                       // degenerate chord: nothing to convert
  const g = [
    0,
    ((c[2] - c[0]) * dx + (c[3] - c[1]) * dy) / l2,
    ((c[4] - c[0]) * dx + (c[5] - c[1]) * dy) / l2,
    1,
  ];
  // Uniformly spaced controls are the overwhelmingly common case; skip the solve.
  if (Math.abs(g[1]! - 1 / 3) < 1e-12 && Math.abs(g[2]! - 2 / 3) < 1e-12) return u;
  const A = -g[0]! + 3 * g[1]! - 3 * g[2]! + g[3]!;
  const B = 3 * g[0]! - 6 * g[1]! + 3 * g[2]!;
  const C = -3 * g[0]! + 3 * g[1]!;
  const D = g[0]! - u;
  const roots = cubicRoots01(A, B, C, D);
  if (!roots.length) return u;
  // A non-monotone straight cubic (controls that double back) genuinely passes the same
  // point more than once; the caller asked about one crossing, so take the root whose
  // displacement is closest to what was asked for.
  let best = roots[0]!, bestErr = Infinity;
  for (const t of roots) {
    const mt = 1 - t;
    const val = mt * mt * mt * g[0]! + 3 * mt * mt * t * g[1]! + 3 * mt * t * t * g[2]! + t * t * t * g[3]!;
    const err = Math.abs(val - u);
    if (err < bestErr) { bestErr = err; best = t; }
  }
  return best;
}

/**
 * Every intersection of two cubics.
 *
 * Dispatches on geometry, not on how the caller labelled the curve: a cubic whose
 * controls are collinear IS a line and takes the exact algebraic path. That path
 * returns a fraction along the chord, which is NOT the curve's parameter unless the
 * controls happen to be evenly spaced, so it is converted back before it leaves here.
 * See `chordFractionToParam`. Getting this wrong reports points tens of units off the
 * curve they claim to lie on.
 *
 * Overlapping (coincident) curves are reported as their two overlap endpoints, not as
 * an infinity of points. That is enough for a boolean operation to split at, and it is
 * accurate: there is no single isolated crossing to report.
 */
export function intersectCubics(c1: Cubic, c2: Cubic, tol = EPS): Intersection[] {
  if (!boxesOverlap(boundsCubic(c1), boundsCubic(c2), tol)) return [];

  const l1 = isLineCubic(c1, tol), l2 = isLineCubic(c2, tol);
  if (l1 && l2) {
    const hit = intersectSegments(c1[0], c1[1], c1[6], c1[7], c2[0], c2[1], c2[6], c2[7]);
    if (!hit) return [];
    return [{
      ...hit,
      t1: chordFractionToParam(c1, hit.t1),
      t2: chordFractionToParam(c2, hit.t2),
    }];
  }
  if (l1) {
    return dedupe(intersectLineCubic(c1[0], c1[1], c1[6], c1[7], c2, tol)
      .map((i) => ({ ...i, t1: chordFractionToParam(c1, i.t1) })), tol);
  }
  if (l2) {
    // Same call with the roles reversed, then swap the parameters back.
    return dedupe(intersectLineCubic(c2[0], c2[1], c2[6], c2[7], c1, tol)
      .map((i) => ({ t1: i.t2, t2: chordFractionToParam(c2, i.t1), x: i.x, y: i.y })), tol);
  }

  const out: Intersection[] = [];
  clipIntersect(c1, c2, 0, 1, 0, 1, tol, 0, out);
  return dedupe(out, tol);
}
