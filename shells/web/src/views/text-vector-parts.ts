// SPDX-License-Identifier: MPL-2.0
/** Solid converted parts use the same geometry and paint controls as drawn paths. */
import { decodeAuthoredPathsResult, encodeAuthoredPaths } from '../../../../engine/src/geom/authored-url.ts';
import { toCubics } from '../../../../engine/src/geom/spline.ts';
import type { GeomPath } from '../../../../engine/src/geom/path.ts';
import type { Cubic } from '../../../../engine/src/geom/bezier.ts';
import { transformVectorPaintPaths, multiplyVectorMatrix, type VectorMatrix, type VectorPaintNode, type VectorPaintV1 } from '../../../../engine/src/vector-paint.ts';
import { pathToBox, type VectorFieldConfig, type Box } from './vector-ops.ts';

function solidPaint(root: VectorPaintNode): { fill: string; rule: string; opacity: number } | null {
  let result: { fill: string; rule: string; opacity: number } | null = null;
  let blocked = false;
  function visit(node: VectorPaintNode, inherited: Record<string, string>, opacity: number): void {
    if (node.tag === 'defs') return;
    if (node.attributes['clip-path']) { blocked = true; return; }
    const attributes = { ...inherited, ...node.attributes };
    const alpha = opacity * Number(node.attributes.opacity ?? 1);
    if (node.tag === 'path') {
      const fill = attributes.fill ?? '#000000';
      if (result || fill.startsWith('url(') || (attributes.stroke && attributes.stroke !== 'none')) { blocked = true; return; }
      result = { fill, rule: attributes['fill-rule'] ?? 'nonzero', opacity: alpha * Number(attributes['fill-opacity'] ?? 1) };
    }
    for (const child of node.children ?? []) visit(child, attributes, alpha);
  }
  visit(root, {}, 1);
  return blocked ? null : result;
}

export function editableVectorPart(box: Box, part: { path: string; paint: VectorPaintV1 }, cfg: VectorFieldConfig): Box {
  const fallback = { ...box, [cfg.pathField ?? 'path']: part.path, pathPaint: JSON.stringify(part.paint) };
  const paint = solidPaint(part.paint.root);
  // Keep perspective and reflected frames in their authored coordinate system.
  if ([box.flipH, box.flipV].some(value => [true, 'true', 1, '1'].includes(value as string | number | boolean)) || Number(box.rx) || Number(box.ry)) return fallback;
  const decoded = decodeAuthoredPathsResult(part.path);
  if (!Array.isArray(decoded)) return fallback;
  const x = Math.round(Number(box[cfg.xField ?? 'x']) || 0), y = Math.round(Number(box[cfg.yField ?? 'y']) || 0);
  const w = Math.max(1, Math.round(Number(box[cfg.wField ?? 'w']) || 1)), h = Math.max(1, Math.round(Number(box[cfg.hField ?? 'h']) || 1));
  const angle = Math.round((Number(box[cfg.rotationField ?? 'rot']) || 0) * 10) / 10 * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle), cx = x + w / 2, cy = y + h / 2;
  const paths = transformVectorPaintPaths(decoded, part.paint);
  const geometry: GeomPath = paths.map(path => ({ closed: path.closed, curves: toCubics(path).map(curve => curve.map((_value, index) => {
    const px = curve[index - index % 2]! * w - w / 2, py = curve[index - index % 2 + 1]! * h - h / 2;
    return index % 2 ? cy + sin * px + cos * py : cx + cos * px - sin * py;
  }) as Cubic) }));
  const frame = pathToBox(geometry, box, { cfg });
  if (!frame) return fallback;
  if (!paint) {
    // Retain complex paint in a tight, ordinary box. Geometry stays in its original
    // SVG coordinates; this outer matrix replaces the old box placement exactly.
    const nw = Number(frame[cfg.wField ?? 'w']), nh = Number(frame[cfg.hField ?? 'h']);
    const nx = Number(frame[cfg.xField ?? 'x']), ny = Number(frame[cfg.yField ?? 'y']);
    const world: VectorMatrix = [cos * w / part.paint.width, sin * w / part.paint.width, -sin * h / part.paint.height, cos * h / part.paint.height, cx - cos * w / 2 + sin * h / 2 - nx, cy - sin * w / 2 - cos * h / 2 - ny];
    const scale = multiplyVectorMatrix([part.paint.width / nw, 0, 0, part.paint.height / nh, 0, 0], world);
    const root: VectorPaintNode = { tag: 'g', attributes: { transform: `matrix(${scale.join(' ')})` }, children: [part.paint.root] };
    return { ...box, ...frame, [cfg.pathField ?? 'path']: encodeAuthoredPaths(decoded), pathPaint: JSON.stringify({ ...part.paint, root }) };
  }
  return {
    ...box, ...frame, pathPaint: '', [cfg.fillField ?? 'bg']: paint.fill, [cfg.fillRuleField ?? 'fillRule']: paint.rule,
    [cfg.strokeField ?? 'stroke']: '', [cfg.strokeWField ?? 'strokeW']: 0,
    [cfg.opacityField ?? 'opacity']: (box[cfg.opacityField ?? 'opacity'] === undefined ? 100 : Number(box[cfg.opacityField ?? 'opacity'])) * paint.opacity,
  };
}
