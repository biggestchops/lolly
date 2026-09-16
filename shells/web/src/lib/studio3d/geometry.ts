// SPDX-License-Identifier: MPL-2.0
import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

/** Cap triangles must retain their orientation and area as the contour contracts. */
function validCaps(candidate: THREE.BufferGeometry, plain: THREE.BufferGeometry): boolean {
  const cap = candidate.groups[0]!,
    reference = plain.groups[0]!;
  if (cap.count !== reference.count) return false;
  const p = candidate.getAttribute('position'),
    q = plain.getAttribute('position');
  const area = (v: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, i: number) =>
    (v.getX(i + 1) - v.getX(i)) * (v.getY(i + 2) - v.getY(i)) -
    (v.getY(i + 1) - v.getY(i)) * (v.getX(i + 2) - v.getX(i));
  for (let i = 0; i < cap.count; i += 3) {
    const a = area(p, cap.start + i),
      b = area(q, reference.start + i);
    if (!Number.isFinite(a) || a * b <= 0 || Math.abs(a) < Math.abs(b) * 0.01) return false;
    // Area is quadratic during the inset. Check its minimum too: a tiny square
    // can fold twice and end with the same orientation after passing through zero.
    const xy = (n: number, axis: 'getX' | 'getY') =>
      (p[axis](cap.start + i + n) + q[axis](reference.start + i + n)) / 2;
    const midpoint =
      (xy(1, 'getX') - xy(0, 'getX')) * (xy(2, 'getY') - xy(0, 'getY')) -
      (xy(1, 'getY') - xy(0, 'getY')) * (xy(2, 'getX') - xy(0, 'getX'));
    const end = a / b,
      middle = midpoint / b;
    const quadratic = 2 * (end + 1 - 2 * middle),
      linear = end - 1 - quadratic;
    const t = -linear / (2 * quadratic);
    if (t > 0 && t < 1 && 1 + linear * t + quadratic * t * t < 0.01) return false;
  }
  return true;
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

/** Keep the authored outline at the sidewall; reduce unsafe inward bevels with a visible report. */
export function extrudeStudioShape(
  shape: THREE.Shape,
  depth: number,
  requested: number,
  smoothness: number
): { geometry: THREE.BufferGeometry; bevel: number } {
  const options = { depth, curveSegments: smoothness, steps: 1, bevelSegments: 5 };
  const plain = new THREE.ExtrudeGeometry(shape, { ...options, bevelEnabled: false });
  if (plain.getAttribute('position').count > 1_000_000 * 3) {
    plain.dispose();
    throw new Error('Simplify the artwork before extrusion.');
  }
  let raw = plain,
    bevel = Math.min(requested, depth / 2);
  try {
    for (let attempt = 0; bevel > 0 && attempt < 12; attempt++) {
      const candidate = new THREE.ExtrudeGeometry(shape, {
        ...options,
        bevelEnabled: true,
        bevelSize: bevel,
        bevelOffset: -bevel,
        bevelThickness: bevel,
      });
      if (validCaps(candidate, plain)) {
        raw = candidate;
        break;
      }
      candidate.dispose();
      bevel /= 2;
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
