// SPDX-License-Identifier: MPL-2.0
/** Reconcile a Design paint while keeping the native editing branch connected. */
const selector = '[data-native-text-editor],[data-native-text-anchor]';
function key(node: Node): string | null {
  if (node.nodeType !== 1) return null;
  const element = node as Element;
  for (const name of ['data-box-id', 'data-frame-id', 'id']) {
    const value = element.getAttribute(name);
    if (value) return `${element.tagName}:${name}:${value}`;
  }
  return null;
}
function compatible(a: Node, b: Node): boolean {
  return a.nodeType === b.nodeType && (a.nodeType !== 1 || (a as Element).tagName === (b as Element).tagName) && key(a) === key(b);
}
function reconcile(current: Node, next: Node, editor: Element | null): void {
  if (current === editor || current.isEqualNode(next)) return;
  if (current.nodeType === 1 && next.nodeType === 1) {
    const a = current as Element, b = next as Element, editingBox = editor && a.contains(editor) && a.hasAttribute('data-box-id');
    for (const attribute of [...a.attributes]) if (!b.hasAttribute(attribute.name)) a.removeAttribute(attribute.name);
    for (const attribute of [...b.attributes]) if (a.getAttribute(attribute.name) !== attribute.value) a.setAttribute(attribute.name, attribute.value);
    if (editingBox) a.classList.add('fc-box-editing');
  } else if (current.nodeType !== 11 && current.nodeType !== 1) { if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue; return; }
  const keyed = new Map([...current.childNodes].flatMap(node => { const id = key(node); return id ? [[id, node] as const] : []; }));
  const used = new Set<Node>();
  for (const [index, desired] of [...next.childNodes].entries()) {
    const at = current.childNodes[index], id = key(desired);
    let existing = id ? keyed.get(id) : at && compatible(at, desired) ? at : undefined;
    if (existing && (used.has(existing) || !compatible(existing, desired))) existing = undefined;
    if (!existing) { current.insertBefore(desired.cloneNode(true), at ?? null); continue; }
    if (existing !== at) {
      if (existing === editor || existing.contains(editor)) {
        // Move siblings around the focused branch instead of disconnecting it.
        const after = existing.nextSibling;
        while (current.childNodes[index] !== existing) current.insertBefore(current.childNodes[index]!, after);
      } else current.insertBefore(existing, at ?? null);
    }
    used.add(existing); reconcile(existing, desired, editor);
  }
  while (current.childNodes.length > next.childNodes.length) current.lastChild!.remove();
}
export function patchComposedText(container: HTMLElement, svg: string): void {
  const template = container.ownerDocument.createElement('template'); template.innerHTML = svg;
  reconcile(container, template.content, null);
}
export function patchTextEditingCanvas(container: HTMLElement, html: string): boolean {
  const editor = container.querySelector<HTMLElement>(selector);
  if (!editor) return false;
  const box = editor.closest('[data-box-id]'), id = box?.getAttribute('data-box-id');
  if (!id) return false;
  const template = container.ownerDocument.createElement('template'); template.innerHTML = html;
  const replacement = [...template.content.querySelectorAll('[data-box-id]')].find(node => node.getAttribute('data-box-id') === id);
  if (!replacement?.querySelector('.lolly-box-text')) {
    editor.dispatchEvent(new container.ownerDocument.defaultView!.CustomEvent('lolly:text-frame-removed', { bubbles: true })); return false;
  }
  // Mark the matching text branch only in the detached template. Its live native
  // content is retained; the editor controller paints the settled text separately.
  const liveText = editor.closest('.lolly-box-text');
  if (!liveText) return false;
  reconcile(container, template.content, liveText);
  return true;
}
