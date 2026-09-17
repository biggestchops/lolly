// SPDX-License-Identifier: MPL-2.0
/**
 * The bevel inset that three's ExtrudeGeometry draws, and a check that it stays valid.
 *
 * Before it triangulates, ExtrudeGeometry (three 0.186) flattens the shape with
 * `extractPoints`, turns the outer contour clockwise (and, only when it had to turn
 * it, turns any clockwise hole the other way), merges neighbouring points that are
 * closer than a scaled 1e-10, and gives every point a movement vector from
 * `getBevelVec`. Each bevel layer is every point moved by `movement * s` for one
 * offset `s`, and both caps are triangulated from the most inset layer.
 * `studioInsetModel` repeats those steps with the same arithmetic, so the check tests
 * the contours three will draw rather than an approximation of them.
 *
 * The studio extrudes with bevelSize = bevel and bevelOffset = -bevel, so layer b of
 * `segments` has s = bevel * sin(b / segments * pi / 2) - bevel: -bevel at the cap
 * (b = 0), and 0 at the sidewall, which keeps the authored outline.
 *
 * `studioInsetSafe` accepts a bevel only when, for the outer contour and every hole:
 *   1. no edge reverses: each inset edge still points the way the original edge does
 *      (an edge is linear in s, so the full inset decides it);
 *   2. no contour collapses: its signed area keeps its sign and stays above 1% of the
 *      original over the whole range (the area is quadratic in s, so the ends and the
 *      vertex of the parabola decide it);
 *   3. nothing meets at any bevel layer: no two edges that are not neighbours touch or
 *      cross, within a contour or between contours, and no hole moves out of the outer
 *      contour or into another hole. Containment matters on its own: a hole can grow
 *      past a thin wall between two layers and end up wholly outside the shrunken outer
 *      contour without any edge crossing at a layer.
 * Contacts are found with a sweep over edge bounding boxes sorted by their left edge,
 * and containment with an even-odd ray from each hole's first point, read during the
 * same sweep and compared with the flattened source.
 */
import * as THREE from 'three';

/** The flattened contours of one shape with their movement vectors, as flat arrays. */
export interface StudioInsetModel {
  /** Points of every contour, outer first and then the holes, in ExtrudeGeometry's order. */
  x: Float64Array;
  y: Float64Array;
  /** Movement of each point for a unit offset. */
  mx: Float64Array;
  my: Float64Array;
  /** Where each contour starts in the arrays; the last entry is the point count. */
  starts: number[];
  /** Index of the point after each point on its own contour. */
  next: Uint32Array;
  /** Contour of each point (0 is the outer contour). */
  owner: Uint32Array;
}

/** Smallest fraction of a contour's original area an inset may keep. */
const MIN_AREA = 0.01;

/** ExtrudeGeometry's mergeOverlappingPoints, step for step. */
function mergeOverlapping(points: THREE.Vector2[]): void {
  if (!points.length) return;
  const threshold = 1e-10;
  const thresholdSq = threshold * threshold;
  let previous = points[0]!;
  for (let i = 1; i <= points.length; i++) {
    const index = i % points.length;
    const current = points[index]!;
    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    const distSq = dx * dx + dy * dy;
    const scale = Math.max(
      Math.abs(current.x),
      Math.abs(current.y),
      Math.abs(previous.x),
      Math.abs(previous.y)
    );
    if (distSq <= thresholdSq * scale * scale) {
      points.splice(index, 1);
      i--;
      continue;
    }
    previous = current;
  }
}

/** ExtrudeGeometry's getBevelVec, including both straight-line cases and the length cap. */
function bevelVec(
  x: number,
  y: number,
  prevX: number,
  prevY: number,
  nextX: number,
  nextY: number
): [number, number] {
  let tx: number, ty: number, shrink: number;
  const vpx = x - prevX,
    vpy = y - prevY;
  const vnx = nextX - x,
    vny = nextY - y;
  const prevLenSq = vpx * vpx + vpy * vpy;
  const turn = vpx * vny - vpy * vnx;
  if (Math.abs(turn) > Number.EPSILON) {
    const prevLen = Math.sqrt(prevLenSq);
    const nextLen = Math.sqrt(vnx * vnx + vny * vny);
    const prevShiftX = prevX - vpy / prevLen;
    const prevShiftY = prevY + vpx / prevLen;
    const nextShiftX = nextX - vny / nextLen;
    const nextShiftY = nextY + vnx / nextLen;
    const along =
      ((nextShiftX - prevShiftX) * vny - (nextShiftY - prevShiftY) * vnx) / (vpx * vny - vpy * vnx);
    tx = prevShiftX + vpx * along - x;
    ty = prevShiftY + vpy * along - y;
    const lenSq = tx * tx + ty * ty;
    if (lenSq <= 2) return [tx, ty];
    shrink = Math.sqrt(lenSq / 2);
  } else {
    // The two edges lie on one line: either they continue it or they fold back on it.
    let continues = false;
    if (vpx > Number.EPSILON) {
      if (vnx > Number.EPSILON) continues = true;
    } else if (vpx < -Number.EPSILON) {
      if (vnx < -Number.EPSILON) continues = true;
    } else if (Math.sign(vpy) === Math.sign(vny)) continues = true;
    if (continues) {
      tx = -vpy;
      ty = vpx;
      shrink = Math.sqrt(prevLenSq);
    } else {
      tx = vpx;
      ty = vpy;
      shrink = Math.sqrt(prevLenSq / 2);
    }
  }
  return [tx / shrink, ty / shrink];
}

/** Flatten, orient, merge and measure a shape exactly as ExtrudeGeometry does. */
export function studioInsetModel(shape: THREE.Shape, curveSegments: number): StudioInsetModel {
  const extracted = shape.extractPoints(curveSegments);
  let outer = extracted.shape;
  const holes = extracted.holes;
  if (!THREE.ShapeUtils.isClockWise(outer)) {
    outer = outer.reverse();
    // Holes turn only in this branch, as in three.
    for (let h = 0; h < holes.length; h++)
      if (THREE.ShapeUtils.isClockWise(holes[h]!)) holes[h] = holes[h]!.reverse();
  }
  mergeOverlapping(outer);
  for (const hole of holes) mergeOverlapping(hole);
  const contours = [outer, ...holes];
  const starts = [0];
  for (const contour of contours) starts.push(starts[starts.length - 1]! + contour.length);
  const count = starts[starts.length - 1]!;
  const model: StudioInsetModel = {
    x: new Float64Array(count),
    y: new Float64Array(count),
    mx: new Float64Array(count),
    my: new Float64Array(count),
    starts,
    next: new Uint32Array(count),
    owner: new Uint32Array(count),
  };
  contours.forEach((points, c) => {
    const base = starts[c]!,
      n = points.length;
    for (let i = 0; i < n; i++) {
      const point = points[i]!,
        prev = points[i === 0 ? n - 1 : i - 1]!,
        next = points[i === n - 1 ? 0 : i + 1]!;
      const [mx, my] = bevelVec(point.x, point.y, prev.x, prev.y, next.x, next.y);
      model.x[base + i] = point.x;
      model.y[base + i] = point.y;
      model.mx[base + i] = mx;
      model.my[base + i] = my;
      model.next[base + i] = base + (i === n - 1 ? 0 : i + 1);
      model.owner[base + i] = c;
    }
  });
  return model;
}

/** The offset of each bevel layer, cap first (b = 0), computed as three computes it. */
export function studioBevelOffsets(bevel: number, segments: number): number[] {
  const offsets: number[] = [];
  for (let b = 0; b < segments; b++) {
    const t = b / segments;
    // three adds bevelOffset (-bevel); adding a negated number and subtracting give the same double.
    offsets.push(bevel * Math.sin((t * Math.PI) / 2) - bevel);
  }
  return offsets;
}

/** Every point moved by `offset`, as three places the layer's vertices. */
export function studioInsetLayer(
  model: StudioInsetModel,
  offset: number
): { x: Float64Array; y: Float64Array } {
  const x = new Float64Array(model.x.length),
    y = new Float64Array(model.y.length);
  for (let i = 0; i < x.length; i++) {
    x[i] = model.x[i]! + model.mx[i]! * offset;
    y[i] = model.y[i]! + model.my[i]! * offset;
  }
  return { x, y };
}

/** Rule 1: each inset edge still points the way its original edge does. */
function edgesKeepDirection(model: StudioInsetModel, offset: number): boolean {
  const { x, y, mx, my, next } = model;
  for (let a = 0; a < x.length; a++) {
    const b = next[a]!;
    const ex = x[b]! - x[a]!,
      ey = y[b]! - y[a]!;
    const ix = x[b]! + mx[b]! * offset - (x[a]! + mx[a]! * offset);
    const iy = y[b]! + my[b]! * offset - (y[a]! + my[a]! * offset);
    if (!(ex * ix + ey * iy > 0)) return false;
  }
  return true;
}

/** Rule 2: over offsets from 0 to `offset`, each contour keeps its sign and 1% of its area. */
function areasHold(model: StudioInsetModel, offset: number): boolean {
  const { x, y, mx, my, starts } = model;
  for (let c = 0; c + 1 < starts.length; c++) {
    const first = starts[c]!,
      end = starts[c + 1]!;
    // Area is the same after a translation; measuring from the first point keeps the sums small.
    const ox = x[first]!,
      oy = y[first]!;
    let a0 = 0,
      a1 = 0,
      a2 = 0;
    for (let p = end - 1, q = first; q < end; p = q++) {
      const px = x[p]! - ox,
        py = y[p]! - oy,
        qx = x[q]! - ox,
        qy = y[q]! - oy;
      a0 += px * qy - qx * py;
      a1 += px * my[q]! + mx[p]! * qy - qx * my[p]! - mx[q]! * py;
      a2 += mx[p]! * my[q]! - mx[q]! * my[p]!;
    }
    const linear = a1 / a0,
      quadratic = a2 / a0;
    const ratio = (s: number) => 1 + linear * s + quadratic * s * s;
    if (!(ratio(offset) > MIN_AREA)) return false;
    const vertex = -linear / (2 * quadratic);
    if (vertex > offset && vertex < 0 && !(ratio(vertex) > MIN_AREA)) return false;
  }
  return true;
}

function side(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/**
 * True when edges a and b (each from a point to its next) share any point. The caller has
 * already found that their bounding boxes overlap.
 */
function edgesMeet(
  next: Uint32Array,
  x: Float64Array,
  y: Float64Array,
  a: number,
  b: number
): boolean {
  const a2 = next[a]!,
    b2 = next[b]!;
  const ax = x[a]!,
    ay = y[a]!,
    bx = x[a2]!,
    by = y[a2]!;
  const cx = x[b]!,
    cy = y[b]!,
    dx = x[b2]!,
    dy = y[b2]!;
  const o1 = side(ax, ay, bx, by, cx, cy),
    o2 = side(ax, ay, bx, by, dx, dy);
  if ((o1 > 0 && o2 > 0) || (o1 < 0 && o2 < 0)) return false;
  const o3 = side(cx, cy, dx, dy, ax, ay),
    o4 = side(cx, cy, dx, dy, bx, by);
  if ((o3 > 0 && o4 > 0) || (o3 < 0 && o4 < 0)) return false;
  // Touching, crossing, overlapping on one line, or not finite: all count as meeting.
  return true;
}

/**
 * One sweep over a layer. Returns null when two edges that are not neighbours meet (only
 * checked when `contacts` is true), otherwise, for each hole in order, the contours whose
 * inside holds the hole's first point.
 */
function sweepLayer(model: StudioInsetModel, offset: number, contacts: boolean): string[] | null {
  const { x, y } = offset === 0 ? model : studioInsetLayer(model, offset);
  const { next, owner, starts } = model;
  const count = x.length;
  const minX = new Float64Array(count),
    maxX = new Float64Array(count),
    minY = new Float64Array(count),
    maxY = new Float64Array(count);
  for (let a = 0; a < count; a++) {
    const b = next[a]!;
    minX[a] = Math.min(x[a]!, x[b]!);
    maxX[a] = Math.max(x[a]!, x[b]!);
    minY[a] = Math.min(y[a]!, y[b]!);
    maxY[a] = Math.max(y[a]!, y[b]!);
  }
  const order = Uint32Array.from({ length: count }, (_, i) => i).sort(
    (a, b) => minX[a]! - minX[b]!
  );
  const holes = starts.length - 2;
  const queries = Array.from({ length: holes }, (_, h) => starts[h + 1]!)
    .filter((first, h) => first < starts[h + 2]!)
    .sort((a, b) => x[a]! - x[b]!);
  const inside = new Array<string>(holes).fill('');
  const active: number[] = [];
  const prune = (at: number) => {
    for (let i = active.length - 1; i >= 0; i--)
      if (maxX[active[i]!]! < at) {
        active[i] = active[active.length - 1]!;
        active.pop();
      }
  };
  const locate = (point: number) => {
    const px = x[point]!,
      py = y[point]!,
      own = owner[point]!;
    prune(px);
    const odd = new Set<number>();
    for (const edge of active) {
      const contour = owner[edge]!;
      if (contour === own) continue;
      const a = edge,
        b = next[edge]!;
      if (x[a]! > px === x[b]! > px) continue;
      const at = y[a]! + ((px - x[a]!) * (y[b]! - y[a]!)) / (x[b]! - x[a]!);
      if (at > py) {
        if (odd.has(contour)) odd.delete(contour);
        else odd.add(contour);
      }
    }
    inside[own - 1] = [...odd].sort((a, b) => a - b).join(',');
  };
  let q = 0;
  for (const edge of order) {
    const left = minX[edge]!;
    while (q < queries.length && x[queries[q]!]! < left) locate(queries[q++]!);
    prune(left);
    if (contacts)
      for (const other of active) {
        if (maxY[other]! < minY[edge]! || minY[other]! > maxY[edge]!) continue;
        if (next[edge] === other || next[other] === edge) continue;
        if (edgesMeet(next, x, y, edge, other)) return null;
      }
    active.push(edge);
  }
  while (q < queries.length) locate(queries[q++]!);
  return inside;
}

const sourceContainment = new WeakMap<StudioInsetModel, string[]>();

/** Rule 3 for one layer: no contact, and every hole stays where it was in the source. */
function layerClean(model: StudioInsetModel, offset: number): boolean {
  let before = sourceContainment.get(model);
  if (!before) {
    before = sweepLayer(model, 0, false) ?? [];
    sourceContainment.set(model, before);
  }
  const after = sweepLayer(model, offset, true);
  return !!after && after.every((value, hole) => value === before[hole]);
}

/** True when a bevel of this size gives valid contours on every bevel layer. */
export function studioInsetSafe(model: StudioInsetModel, bevel: number, segments: number): boolean {
  if (!(bevel > 0)) return bevel === 0;
  const offsets = studioBevelOffsets(bevel, segments);
  const full = offsets[0]!;
  if (!edgesKeepDirection(model, full) || !areasHold(model, full)) return false;
  return offsets.every((offset) => layerClean(model, offset));
}
