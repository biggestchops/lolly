// SPDX-License-Identifier: MPL-2.0
type Point = { x: number; y: number };

/** Project the surface plane through its CSS transform, including perspective.
 * Ancestors may pan/zoom; unsupported ancestor rotations suppress placement.
 * No measurement nodes are inserted into exported artwork. */
export function surfaceMapping(el: HTMLElement): { toClient(p: Point): Point; fromClient(p: Point): Point } | null {
  const win = el.ownerDocument.defaultView;
  const rect = el.getBoundingClientRect();
  if (!win || rect.width <= 0 || rect.height <= 0) return null;
  const css = win.getComputedStyle(el);
  const w = el.offsetWidth || parseFloat(css.width) || rect.width;
  const h = el.offsetHeight || parseFloat(css.height) || rect.height;
  const Matrix = (win as Window & { DOMMatrix?: typeof DOMMatrix }).DOMMatrix;
  if (!Matrix) return css.transform && css.transform !== 'none' ? null : {
    toClient: p => ({ x: rect.left + p.x * rect.width, y: rect.top + p.y * rect.height }),
    fromClient: p => ({ x: (p.x - rect.left) / rect.width, y: (p.y - rect.top) / rect.height }),
  };
  for (let parent = el.parentElement; parent; parent = parent.parentElement) {
    const style = win.getComputedStyle(parent);
    const m = new Matrix(style.transform === 'none' ? undefined : style.transform || undefined);
    if (!m.is2D || m.b !== 0 || m.c !== 0 || m.a <= 0 || m.d <= 0 || (style.perspective && style.perspective !== 'none')) return null;
  }
  const origin = css.transformOrigin.split(' ').map(Number.parseFloat);
  const m = new Matrix().translate(origin[0] || 0, origin[1] || 0)
    .multiply(new Matrix(css.transform === 'none' ? undefined : css.transform || undefined))
    .translate(-(origin[0] || 0), -(origin[1] || 0));
  const a = m.m11 * w, b = m.m21 * h, c = m.m41;
  const d = m.m12 * w, e = m.m22 * h, f = m.m42;
  const g = m.m14 * w, h0 = m.m24 * h, i = m.m44;
  const project = (p: Point): Point => ({ x: (a*p.x+b*p.y+c)/(g*p.x+h0*p.y+i), y: (d*p.x+e*p.y+f)/(g*p.x+h0*p.y+i) });
  const corners = [{x:0,y:0},{x:1,y:0},{x:0,y:1},{x:1,y:1}];
  if (corners.some(p => g*p.x+h0*p.y+i <= 1e-8)) return null;
  const points = corners.map(project);
  const left = Math.min(...points.map(p => p.x)), top = Math.min(...points.map(p => p.y));
  const width = Math.max(...points.map(p => p.x))-left, height = Math.max(...points.map(p => p.y))-top;
  const determinant = a*(e*i-f*h0)-b*(d*i-f*g)+c*(d*h0-e*g);
  if (Math.abs(determinant) < 1e-8 || width <= 0 || height <= 0) return null;
  return {
    toClient(p) { const q = project(p); return { x: rect.left+(q.x-left)*rect.width/width, y: rect.top+(q.y-top)*rect.height/height }; },
    fromClient(p) {
      const x = left+(p.x-rect.left)*width/rect.width, y = top+(p.y-rect.top)*height/rect.height;
      const z = (d*h0-e*g)*x+(b*g-a*h0)*y+a*e-b*d;
      return { x: ((e*i-f*h0)*x+(c*h0-b*i)*y+b*f-c*e)/z,
        y: ((f*g-d*i)*x+(a*i-c*g)*y+c*d-a*f)/z };
    },
  };
}
