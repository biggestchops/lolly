// SPDX-License-Identifier: MPL-2.0
import type { FastPatch } from './canvas-scene.ts';
import { cssEscape } from '../lib/util/escape.ts';

/**
 * Apply a geometry plan only when left/top explain the entire template change.
 * Comparing inert templates also catches non-box inputs and hook side effects.
 * Every target is checked before touching the mounted DOM.
 */
export function patchCanvasTranslations(
  container: HTMLElement, previous: string | null, next: string, plan: readonly FastPatch[],
): boolean {
  if (!previous || !plan.length) return false;
  const before = container.ownerDocument.createElement('template');
  const after = container.ownerDocument.createElement('template');
  before.innerHTML = previous;
  after.innerHTML = next;
  const updates: Array<{ node: HTMLElement; left: string; top: string }> = [];
  const metadata: Array<{ node: Element; text: string | null }> = [];
  const seen = new Set<string>();
  for (const patch of plan) {
    const selector = patch.frame
      ? `.lolly-frame-page[data-frame-id="${cssEscape(patch.id)}"]`
      : `.lolly-box[data-box-id="${cssEscape(patch.id)}"]`;
    if (seen.has(selector)) return false;
    seen.add(selector);
    const oldNodes = before.content.querySelectorAll<HTMLElement>(selector);
    const newNodes = after.content.querySelectorAll<HTMLElement>(selector);
    const liveNodes = container.querySelectorAll<HTMLElement>(selector);
    if (oldNodes.length !== 1 || newNodes.length !== 1 || liveNodes.length !== 1) return false;
    const oldNode = oldNodes[0]!, newNode = newNodes[0]!, liveNode = liveNodes[0]!;
    if ([oldNode, newNode, liveNode].some(node => node.namespaceURI !== 'http://www.w3.org/1999/xhtml' || node.localName !== oldNode.localName)) return false;
    const left = newNode.style.left, top = newNode.style.top;
    if (left !== `${patch.x}px` || top !== `${patch.y}px`) return false;
    if (newNode.style.getPropertyPriority('left') || newNode.style.getPropertyPriority('top')) return false;
    oldNode.style.left = left; oldNode.style.top = top;
    // Normalize both style attributes through the same CSS serializer.
    newNode.style.left = left; newNode.style.top = top;
    oldNode.setAttribute('style', oldNode.style.cssText);
    newNode.setAttribute('style', newNode.style.cssText);
    updates.push({ node: liveNode, left, top });
  }
  // These inert payloads describe the export document, including its positions.
  // Refresh them with the geometry; executable scripts still require a repaint.
  for (const attribute of ['data-penpot-doc', 'data-pptx-deck']) {
    const selector = `script[type="application/json"][${attribute}]`;
    const oldNodes = before.content.querySelectorAll(selector);
    const newNodes = after.content.querySelectorAll(selector);
    const liveNodes = container.querySelectorAll(selector);
    if (!oldNodes.length && !newNodes.length) continue;
    if (oldNodes.length !== 1 || newNodes.length !== 1 || liveNodes.length !== 1) return false;
    const text = newNodes[0]!.textContent;
    try { JSON.parse(text ?? ''); } catch { return false; }
    oldNodes[0]!.textContent = text;
    metadata.push({ node: liveNodes[0]!, text });
  }
  if (!before.content.isEqualNode(after.content)) return false;
  for (const { node, left, top } of updates) { node.style.left = left; node.style.top = top; }
  for (const { node, text } of metadata) node.textContent = text;
  return true;
}
