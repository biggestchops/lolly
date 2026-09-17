// SPDX-License-Identifier: MPL-2.0
import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { studioInsetModel, studioInsetSafe } from './inset.ts';

/** Bevel layers on each side of the extrusion. */
const BEVEL_SEGMENTS = 5;
const MAX_TRIANGLES = 1_000_000;

/** Segment counts curve detail chooses between when it follows the output size. */
export const STUDIO_DETAIL_RANGE = { min: 8, max: 64 };

/** The chord error a chosen count stays at or under, in output pixels (plan 265, Q12). */
export const STUDIO_CHORD_TOLERANCE_PX = 0.25;

/** The largest share of the output the Fit framing gives the artwork's longest side. */
const FITTED_FILL = 0.8;

/** Points taken on the true curve between two flattened points when the error is measured. */
const CHORD_SAMPLES = 16;

/**
 * The largest chord error, in the artwork's own units, that keeps a flattened curve within
 * STUDIO_CHORD_TOLERANCE_PX of the true curve in an output `pixels` across.
 *
 * The studio scales artwork so its longest side spans 3.25 studio units (source.ts) and Fit
 * gives that span at most FITTED_FILL of the frame, so one artwork unit covers at most
 * pixels * FITTED_FILL / span output pixels. The 3.25 and the object's own scale cancel, so
 * only the artwork's own span and the output size are left. This is the framing bound, not a
 * measurement of one scene: a tilted, panned or unfitted camera draws the same curve smaller,
 * never larger. The recorded fixtures project at about two thirds of the bound
 * (tests/fixtures/studio3d/geometry/tessellation-baseline.json), so a count chosen this way
 * has room to spare.
 */
export function studioChordTolerance(pixels: number, span: number): number {
  return (STUDIO_CHORD_TOLERANCE_PX * span) / (FITTED_FILL * Math.max(1, pixels));
}

/** Chords three draws for one curve of a contour, as CurvePath.getPoints resolves it. */
function chordCount(curve: THREE.Curve<THREE.Vector2>, segments: number): number {
  // A straight line is drawn as one chord and has no error, so it is not measured.
  if (curve instanceof THREE.LineCurve) return 0;
  if (curve instanceof THREE.EllipseCurve) return segments * 2;
  if (curve instanceof THREE.SplineCurve) return segments * curve.points.length;
  return segments;
}

/**
 * The largest distance from a flattened contour to the curve it came from, in the shape's own
 * units, at `segments` per curve. Each chord is compared with CHORD_SAMPLES points on the true
 * curve, the same method the tessellation baseline uses.
 */
export function studioChordError(shape: THREE.Shape, segments: number): number {
  const a = new THREE.Vector2(),
    b = new THREE.Vector2(),
    p = new THREE.Vector2();
  let worst = 0;
  for (const path of [shape, ...shape.holes])
    for (const curve of path.curves) {
      const chords = chordCount(curve, segments);
      for (let i = 0; i < chords; i++) {
        curve.getPoint(i / chords, a);
        curve.getPoint((i + 1) / chords, b);
        const ex = b.x - a.x,
          ey = b.y - a.y,
          lengthSq = ex * ex + ey * ey;
        for (let k = 1; k < CHORD_SAMPLES; k++) {
          curve.getPoint((i + k / CHORD_SAMPLES) / chords, p);
          const along =
            lengthSq > 0
              ? Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / lengthSq))
              : 0;
          worst = Math.max(worst, Math.hypot(p.x - a.x - ex * along, p.y - a.y - ey * along));
        }
      }
    }
  return worst;
}

/**
 * About how many triangles the plain extrusion of this shape takes at `segments`: both caps
 * triangulate to roughly one triangle per point and the sidewall adds two per edge. An
 * estimate, used only to keep the chosen count inside the triangle budget.
 */
function estimateTriangles(shape: THREE.Shape, segments: number): number {
  let points = 0;
  for (const path of [shape, ...shape.holes])
    for (const curve of path.curves) points += Math.max(1, chordCount(curve, segments));
  return 4 * points + 4 * shape.holes.length;
}

/**
 * The segment count for one shape when curve detail follows the output size: the smallest
 * count from 8 to 64 whose chord error is at or under `tolerance` in the shape's own units,
 * stepped back while the plain extrusion would pass the triangle budget.
 *
 * The search halves the range, so it takes the error to fall as the count rises. It does for
 * the curves three draws here: a chord over a shorter piece of the same curve stays closer to
 * it. A shape too curved even for 64 keeps 64, the most the studio offers.
 */
export function studioCurveDetail(shape: THREE.Shape, tolerance: number): number {
  const { min, max } = STUDIO_DETAIL_RANGE;
  let chosen = max;
  if (tolerance > 0 && studioChordError(shape, min) <= tolerance) chosen = min;
  else if (tolerance > 0) {
    let low = min + 1,
      high = max;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (studioChordError(shape, mid) <= tolerance) high = mid;
      else low = mid + 1;
    }
    chosen = low;
  }
  while (chosen > min && estimateTriangles(shape, chosen) > MAX_TRIANGLES) chosen--;
  return chosen;
}

/**
 * Earcut keeps inset points that are almost in line, and 32-bit positions can put them
 * exactly in line, so a cap can hold a triangle with no area. toCreasedNormals gives that
 * triangle no normal, yet projection can still give it a sliver of screen area, where a
 * zero normal shades as NaN. Such a vertex takes the normal of its own cap.
 */
function fillCapNormals(geometry: THREE.BufferGeometry, first: number, depth: number): void {
  const p = geometry.getAttribute('position'),
    n = geometry.getAttribute('normal');
  for (let j = first; j < first + 3; j++)
    if (!(n.getX(j) ** 2 + n.getY(j) ** 2 + n.getZ(j) ** 2 > 0))
      n.setXYZ(j, 0, 0, p.getZ(j) > depth / 2 ? 1 : -1);
}

/** Regroup complete triangles into three draw calls, preserving UVs and smooth normals. */
function surfaceGroups(geometry: THREE.BufferGeometry, depth: number): void {
  const p = geometry.getAttribute('position'),
    cap = geometry.groups[0]!;
  const triangles: number[][] = [[], [], []];
  const epsilon = Math.max(1, depth) * 1e-6;
  for (let i = 0; i < p.count; i += 3) {
    const low = Math.min(p.getZ(i), p.getZ(i + 1), p.getZ(i + 2));
    const high = Math.max(p.getZ(i), p.getZ(i + 1), p.getZ(i + 2));
    const role = i < cap.start + cap.count ? 0 : low < -epsilon || high > depth + epsilon ? 1 : 2;
    if (role === 0) fillCapNormals(geometry, i, depth);
    triangles[role]!.push(i, i + 1, i + 2);
  }
  const order = triangles.flat();
  for (const [name, attr] of Object.entries(geometry.attributes)) {
    const data = new Float32Array(attr.count * attr.itemSize);
    for (let i = 0; i < order.length; i++)
      for (let j = 0; j < attr.itemSize; j++)
        data[i * attr.itemSize + j] = attr.getComponent(order[i]!, j);
    geometry.setAttribute(name, new THREE.BufferAttribute(data, attr.itemSize, attr.normalized));
  }
  geometry.clearGroups();
  let start = 0;
  for (const [role, vertices] of triangles.entries()) {
    if (vertices.length) geometry.addGroup(start, vertices.length, role);
    start += vertices.length;
  }
}

/**
 * Keep the authored outline at the sidewall; reduce unsafe inward bevels with a visible report.
 * A bevel is tried at the requested size and halved up to twelve times until the inset three
 * will draw passes studioInsetSafe (see inset.ts); if none passes, the shape has no bevel.
 * A shape whose bevelled mesh would exceed the triangle budget keeps its plain extrusion and
 * reports a bevel of 0, so heavy artwork still draws, as it did in 3D Studio 0.4, instead of
 * failing. Only a plain extrusion over the budget is refused.
 *
 * With `tolerance` the curve count follows the output instead of `smoothness`: studioCurveDetail
 * picks it from the artwork itself, and the inset model is built with the same count, because
 * the check has to test the contours three will draw.
 */
export function extrudeStudioShape(
  shape: THREE.Shape,
  depth: number,
  requested: number,
  smoothness: number,
  tolerance?: number
): { geometry: THREE.BufferGeometry; bevel: number; segments: number } {
  const segments = tolerance === undefined ? smoothness : studioCurveDetail(shape, tolerance);
  const options = { depth, curveSegments: segments, steps: 1, bevelSegments: BEVEL_SEGMENTS };
  const plain = new THREE.ExtrudeGeometry(shape, { ...options, bevelEnabled: false });
  if (plain.getAttribute('position').count > MAX_TRIANGLES * 3) {
    plain.dispose();
    throw new Error('Simplify the artwork before extrusion.');
  }
  let raw = plain,
    bevel = Math.min(requested, depth / 2);
  try {
    if (bevel > 0) {
      const inset = studioInsetModel(shape, segments);
      // Caps keep about the plain count; the sidewall gains one ring of quads per bevel layer.
      const bevelled =
        plain.groups[0]!.count / 3 + 2 * inset.x.length * (options.steps + 2 * BEVEL_SEGMENTS);
      const affordable = bevelled <= MAX_TRIANGLES;
      for (let attempt = 0; affordable && bevel > 0 && attempt < 12; attempt++) {
        if (studioInsetSafe(inset, bevel, BEVEL_SEGMENTS)) {
          raw = new THREE.ExtrudeGeometry(shape, {
            ...options,
            bevelEnabled: true,
            bevelSize: bevel,
            bevelOffset: -bevel,
            bevelThickness: bevel,
          });
          break;
        }
        bevel /= 2;
      }
    }
    if (raw === plain) bevel = 0;
    const geometry = toCreasedNormals(raw, Math.PI / 3);
    surfaceGroups(geometry, depth);
    return { geometry, bevel, segments };
  } finally {
    if (raw !== plain) raw.dispose();
    plain.dispose();
  }
}
