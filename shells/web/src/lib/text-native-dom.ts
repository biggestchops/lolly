// SPDX-License-Identifier: MPL-2.0
/** Native selection uses literal logical source; geometry comes from settled text. */
import type { TextCaretV1, TextLayoutV1 } from '@lolly-tools/core';
import { nativeFramePoint, type NativeFrameProjection } from './text-native-projection.ts';
export interface NativeTextSelection { anchor: number; focus: number }
/** Collapsed ranges in empty text nodes have no rectangle; their native BR does. */
export function nativeTextCaretRect(element: HTMLElement): DOMRect | null {
  const selection = element.ownerDocument.getSelection();
  if (!selection?.focusNode || !element.contains(selection.focusNode)) return null;
  const range = element.ownerDocument.createRange(); range.setStart(selection.focusNode, selection.focusOffset); range.collapse(true);
  const rect = range.getBoundingClientRect();
  if (rect.height) return rect;
  return selection.focusNode.parentElement?.closest('[data-text-start]')?.querySelector('br')?.getBoundingClientRect() ?? null;
}
export function readNativeTextSelection(element: HTMLElement): NativeTextSelection | null {
  const selection = element.ownerDocument.getSelection();
  if (!selection?.rangeCount || !selection.anchorNode || !selection.focusNode || !element.contains(selection.anchorNode) || !element.contains(selection.focusNode)) return null;
  const offset = (node: Node, position: number): number => { const range = element.ownerDocument.createRange(); range.selectNodeContents(element); range.setEnd(node, position); return range.toString().length; };
  return { anchor: offset(selection.anchorNode, selection.anchorOffset), focus: offset(selection.focusNode, selection.focusOffset) };
}
export function setNativeTextSelection(element: HTMLElement, value: NativeTextSelection, focusPoint?: { x: number; y: number }): void {
  const walker = element.ownerDocument.createTreeWalker(element, 4);
  let node = walker.nextNode(), offset = 0, anchor: [Node, number] | undefined, focus: [Node, number] | undefined;
  while (node) {
    const length = node.textContent?.length ?? 0;
    if (!anchor && value.anchor <= offset+length) anchor = [node, Math.max(0,value.anchor-offset)];
    if ((!focus || focusPoint) && value.focus >= offset && value.focus <= offset+length) {
      const candidate: [Node, number] = [node, Math.max(0,value.focus-offset)];
      const distance = ([text, at]: [Node, number]): number => {
        const span = text.parentElement?.closest<HTMLElement>('[data-text-start]'); if (!span) return Infinity;
        const rtl = span.querySelector('[data-text-ink]')?.getAttribute('dir') === 'rtl';
        const end = (at === 0) !== !rtl;
        const x = Number(span.dataset.textX)+(end?Number(span.dataset.textDx ?? span.dataset.textAdvance):0), y = Number(span.dataset.textY)+(end?Number(span.dataset.textDy ?? 0):0);
        return Math.hypot(x-focusPoint!.x,y-focusPoint!.y);
      };
      if (!focus || focusPoint && distance(candidate) < distance(focus)) focus = candidate;
    }
    offset += length; node = walker.nextNode();
  }
  if (!anchor || !focus) { if (!offset) element.ownerDocument.getSelection()?.setBaseAndExtent(element,0,element,0); return; }
  if (value.anchor === value.focus && focusPoint) anchor = focus;
  element.ownerDocument.getSelection()?.setBaseAndExtent(...anchor,...focus);
}
export function nativeFocusPoint(element: HTMLElement): { x: number; y: number } | undefined {
  const selection = element.ownerDocument.getSelection(), node = selection?.focusNode;
  if (!node || !element.contains(node)) return;
  const span = node.parentElement?.closest<HTMLElement>('[data-text-start]'); if (!span) return;
  const rtl = span.querySelector('[data-text-ink]')?.getAttribute('dir') === 'rtl';
  const end = (selection!.focusOffset === 0) !== !rtl;
  return { x:Number(span.dataset.textX)+(end?Number(span.dataset.textDx ?? span.dataset.textAdvance):0),y:Number(span.dataset.textY)+(end?Number(span.dataset.textDy ?? 0):0) };
}
export function replaceNativeText(element: HTMLElement, start: number, end: number, text: string): void {
  setNativeTextSelection(element,{anchor:start,focus:end});
  const selection = element.ownerDocument.getSelection(); if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0); range.deleteContents();
  const node = element.ownerDocument.createTextNode(text); range.insertNode(node);
  selection.setBaseAndExtent(node,text.length,node,text.length);
}
export interface NativeTextStop extends TextCaretV1 { line: number }
export function nativeTextStops(layout: TextLayoutV1, project?: NativeFrameProjection): NativeTextStop[] {
  return layout.lines.flatMap((line,index)=>project?.(line.frameId)===null?[]:line.carets.map(caret=>{
    const matrix = project?.(line.frameId);
    return {...caret,...(matrix?{...nativeFramePoint(matrix,caret.x,caret.y),angle:caret.angle+Math.atan2(matrix.b,matrix.a)*180/Math.PI,height:caret.height*Math.hypot(matrix.c,matrix.d)}:{}),line:index};
  })).filter((caret,index,all)=>!index || caret.offset!==all[index-1]!.offset || caret.x!==all[index-1]!.x || caret.y!==all[index-1]!.y);
}
