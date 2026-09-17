// SPDX-License-Identifier: MPL-2.0
import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { studioInsetModel, studioInsetSafe } from './inset.ts';

/** Bevel layers on each side of the extrusion. */
const BEVEL_SEGMENTS = 5;
const MAX_TRIANGLES = 1_000_000;

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
 */
export function extrudeStudioShape(
  shape: THREE.Shape,
  depth: number,
  requested: number,
  smoothness: number
): { geometry: THREE.BufferGeometry; bevel: number } {
  const options = { depth, curveSegments: smoothness, steps: 1, bevelSegments: BEVEL_SEGMENTS };
  const plain = new THREE.ExtrudeGeometry(shape, { ...options, bevelEnabled: false });
  if (plain.getAttribute('position').count > MAX_TRIANGLES * 3) {
    plain.dispose();
    throw new Error('Simplify the artwork before extrusion.');
  }
  let raw = plain,
    bevel = Math.min(requested, depth / 2);
  try {
    if (bevel > 0) {
      const inset = studioInsetModel(shape, smoothness);
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
    return { geometry, bevel };
  } finally {
    if (raw !== plain) raw.dispose();
    plain.dispose();
  }
}
