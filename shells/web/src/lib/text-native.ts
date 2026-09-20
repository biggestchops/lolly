// SPDX-License-Identifier: MPL-2.0
/** A model-controlled native input surface over the shared composed geometry. */
import type { TextLayoutV1, TextRangeV1, TextShapedRunV1 } from '@lolly-tools/core';
import { deletionRange, snapTextRange, textBoundaries } from '@lolly/engine';
import { nativeFocusPoint, nativeTextStops, readNativeTextSelection, replaceNativeText, setNativeTextSelection } from './text-native-dom.ts';
import type { NativeTextSelection, NativeTextStop } from './text-native-dom.ts';
import { paintNativeText } from './text-native-paint.ts';
import { hitNativeTextStop, nativeClientPoint } from './text-native-hit.ts';
import type { NativeFrameProjection } from './text-native-projection.ts';
export interface NativeTextOptions {
  source(): string;
  revision(): number;
  edit(range: TextRangeV1, text: string, kind: string): void;
  history(redo: boolean): void;
  family(run: TextShapedRunV1): string;
  project?: NativeFrameProjection;
  clientPoint?(x:number,y:number): {x:number;y:number};
  selection?(range: NativeTextSelection): void;
  composition?(range: TextRangeV1, active: boolean): void;
  paste?(data: DataTransfer, range: TextRangeV1, plain: boolean): void;
  copy?(data: DataTransfer, range: TextRangeV1): void;
  error?(error: unknown): void;
}
/** Expand a DOM diff to boundaries valid in both old and new literal source. */
export function nativeTextChange(before: string, after: string): { range: TextRangeV1; text: string } | null {
  if (before===after) return null;
  const oldBounds=textBoundaries(before),newBounds=textBoundaries(after);
  let start=0,oldEnd=before.length,newEnd=after.length;
  while(start<oldEnd && start<newEnd && before[start]===after[start]) start++;
  while(start>0 && (!oldBounds.has(start)||!newBounds.has(start))) start--;
  while(oldEnd>start && newEnd>start && before[oldEnd-1]===after[newEnd-1]) {oldEnd--;newEnd--;}
  while(!oldBounds.has(oldEnd)||!newBounds.has(newEnd)) {oldEnd++;newEnd++;}
  return {range:{start,end:oldEnd},text:after.slice(start,newEnd)};
}
export function mountNativeText(element: HTMLElement, options: NativeTextOptions) {
  const abort=new AbortController(),signal=abort.signal;
  let composing=false,destroyed=false,layout:TextLayoutV1|null=null,pending:TextLayoutV1|null=null;
  let compositionRange:TextRangeV1|null=null,focusStop:NativeTextStop|null=null;
  let plainPaste=false,drag: {pointer:number;anchor:number}|null=null;
  element.contentEditable='true';element.setAttribute('role','textbox');element.setAttribute('aria-multiline','true');
  Object.assign(element.style,{position:'relative',whiteSpace:'pre',color:'transparent',caretColor:'CanvasText',outline:'none'});
  const selection=():NativeTextSelection|null=>readNativeTextSelection(element);
  function select(anchor:number,focus=anchor,stop?:NativeTextStop):void {
    const source=options.source(),a=snapTextRange(source,{start:anchor,end:anchor}),b=snapTextRange(source,{start:focus,end:focus});
    focusStop=stop??null;setNativeTextSelection(element,{anchor:a.start,focus:b.start},stop);
  }
  function update(next:TextLayoutV1):void {
    if(destroyed||next.revision!==options.revision())return;
    if(composing||drag){pending=next;return;}
    const bookmark=selection(),affinity=focusStop?.affinity;layout=next;pending=null;
    element.style.color='transparent';
    paintNativeText(element,options.source(),next,options.family,options.project);
    if(bookmark)select(bookmark.anchor,bookmark.focus,affinity?nativeTextStops(next,options.project).find(stop=>stop.offset===bookmark.focus&&stop.affinity===affinity):undefined);
    if(compositionRange){options.composition?.(compositionRange,false);compositionRange=null;}
  }
  function input(kind:string):void {
    if(composing)return;
    try {const change=nativeTextChange(options.source(),element.textContent??'');if(change)options.edit(change.range,change.text,kind);}
    catch(error){options.error?.(error);if(layout?.revision===options.revision())update(layout);}
    const range=selection();if(range)options.selection?.(range);
  }
  const hit=(event:MouseEvent)=>layout?hitNativeTextStop(nativeTextStops(layout,options.project),options.clientPoint?.(event.clientX,event.clientY)??nativeClientPoint(element,event.clientX,event.clientY)):undefined;
  element.addEventListener('pointerdown',event=>{
    focusStop=null;
    if(composing || event.pointerType!=='mouse' || event.button!==0 || event.detail>1)return;
    const stop=hit(event);if(!stop)return;event.preventDefault();event.stopPropagation();
    const previous=selection();element.focus({preventScroll:true});drag={pointer:event.pointerId,anchor:event.shiftKey&&previous?previous.anchor:stop.offset};
    element.setPointerCapture(event.pointerId);select(drag.anchor,stop.offset,stop);
  },{signal});
  element.addEventListener('dblclick',event=>{
    if(composing)return;const stop=hit(event);if(!stop)return;
    const source=options.source(),at=Math.min(stop.offset,Math.max(0,source.length-1));
    const word=[...new Intl.Segmenter(undefined,{granularity:'word'}).segment(source)].find(part=>part.index<=at&&part.index+part.segment.length>at);
    if(word){event.preventDefault();event.stopPropagation();drag=null;select(word.index,word.index+word.segment.length);}
  },{signal});
  element.addEventListener('pointermove',event=>{if(!drag || drag.pointer!==event.pointerId)return;const stop=hit(event);if(stop){event.preventDefault();select(drag.anchor,stop.offset,stop);}},{signal});
  const endDrag=(event:PointerEvent)=>{if(!drag || drag.pointer!==event.pointerId)return;drag=null;if(element.hasPointerCapture(event.pointerId))element.releasePointerCapture(event.pointerId);if(pending)update(pending);};
  element.addEventListener('pointerup',endDrag,{signal});element.addEventListener('pointercancel',endDrag,{signal});
  element.addEventListener('beforeinput',(event:InputEvent)=>{
    if(event.inputType==='historyUndo'||event.inputType==='historyRedo'){event.preventDefault();options.history(event.inputType==='historyRedo');return;}
    if(composing||event.isComposing)return;
    const value=selection();if(!value)return;
    const range=snapTextRange(options.source(),{start:Math.min(value.anchor,value.focus),end:Math.max(value.anchor,value.focus)});
    if(event.inputType==='deleteContentBackward'||event.inputType==='deleteContentForward'){
      event.preventDefault();const remove=deletionRange(options.source(),range,event.inputType==='deleteContentBackward');
      replaceNativeText(element,remove.start,remove.end,'');input(event.inputType);
    }else if(event.inputType==='insertText' && event.data!==null){
      event.preventDefault();replaceNativeText(element,range.start,range.end,event.data);input(event.inputType);
    }else if(event.inputType==='insertParagraph'||event.inputType==='insertLineBreak'){
      event.preventDefault();replaceNativeText(element,range.start,range.end,event.inputType==='insertParagraph'?'\n':'\u2028');input(event.inputType);
    }
  },{signal});
  element.addEventListener('input',event=>input(event instanceof InputEvent ? event.inputType : 'input'),{signal});
  element.addEventListener('compositionstart',()=>{
    composing=true;const value=selection();compositionRange=value?{start:Math.min(value.anchor,value.focus),end:Math.max(value.anchor,value.focus)}:{start:0,end:0};
    const node=element.ownerDocument.getSelection()?.focusNode,span=node?.parentElement?.closest<HTMLElement>('[data-text-start]');
    if(span){span.style.color='CanvasText';const ink=span.querySelector<HTMLElement>('[data-text-ink]');if(ink)ink.style.transform='none';}
    else element.style.color='CanvasText';
    options.composition?.(compositionRange,true);
  },{signal});
  element.addEventListener('compositionend',()=>{
    composing=false;queueMicrotask(()=>{if(destroyed)return;input('insertCompositionText');if(pending)update(pending);});
  },{signal});
  element.addEventListener('paste',(event:ClipboardEvent)=>{
    if(composing)return;const value=selection();if(!value)return;
    event.preventDefault();const range=snapTextRange(options.source(),{start:Math.min(value.anchor,value.focus),end:Math.max(value.anchor,value.focus)});
    if(options.paste&&event.clipboardData){try{options.paste(event.clipboardData,range,plainPaste);}catch(error){options.error?.(error);}plainPaste=false;return;}
    replaceNativeText(element,range.start,range.end,event.clipboardData?.getData('text/plain')??'');input('insertFromPaste');
  },{signal});
  element.addEventListener('copy',(event:ClipboardEvent)=>{
    const value=selection();if(!value)return;event.preventDefault();
    const range=snapTextRange(options.source(),{start:Math.min(value.anchor,value.focus),end:Math.max(value.anchor,value.focus)});
    if(options.copy&&event.clipboardData)options.copy(event.clipboardData,range);else event.clipboardData?.setData('text/plain',options.source().slice(range.start,range.end));
  },{signal});
  element.addEventListener('cut',(event:ClipboardEvent)=>{
    if(composing)return;const value=selection();if(!value)return;
    const source=options.source(),range=snapTextRange(source,{start:Math.min(value.anchor,value.focus),end:Math.max(value.anchor,value.focus)});
    event.preventDefault();if(options.copy&&event.clipboardData)options.copy(event.clipboardData,range);else event.clipboardData?.setData('text/plain',source.slice(range.start,range.end));
    replaceNativeText(element,range.start,range.end,'');input('deleteByCut');
  },{signal});
  element.addEventListener('keydown',(event:KeyboardEvent)=>{
    if(composing||event.isComposing)return;
    plainPaste=(event.metaKey||event.ctrlKey)&&event.shiftKey&&event.key.toLowerCase()==='v';
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='z'){event.preventDefault();options.history(event.shiftKey);return;}
    if(event.ctrlKey&&!event.metaKey&&event.key.toLowerCase()==='y'){event.preventDefault();options.history(true);return;}
    if(event.key==='Enter'&&!event.metaKey&&!event.ctrlKey&&!event.altKey){
      const value=selection();if(!value)return;event.preventDefault();
      const range=snapTextRange(options.source(),{start:Math.min(value.anchor,value.focus),end:Math.max(value.anchor,value.focus)});
      replaceNativeText(element,range.start,range.end,event.shiftKey?'\u2028':'\n');input(event.shiftKey?'insertLineBreak':'insertParagraph');return;
    }
    if(event.metaKey||event.ctrlKey||event.altKey||!layout||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
    const value=selection(),stops=nativeTextStops(layout,options.project);if(!value||!stops.length)return;
    if(!focusStop){const point=nativeFocusPoint(element);if(point)focusStop=stops.filter(stop=>stop.offset===value.focus).reduce<NativeTextStop|null>((best,stop)=>!best||Math.hypot(stop.x-point.x,stop.y-point.y)<Math.hypot(best.x-point.x,best.y-point.y)?stop:best,null);}
    let current=stops.findIndex(stop=>stop.offset===value.focus&&(!focusStop||stop.x===focusStop.x&&stop.y===focusStop.y));
    if(current<0)current=stops.findIndex(stop=>stop.offset===value.focus);if(current<0)return;
    let next=current;
    if(event.key==='ArrowLeft'||event.key==='ArrowRight')next=Math.min(stops.length-1,Math.max(0,current+(event.key==='ArrowRight'?1:-1)));
    else{
      const targetLine=stops[current]!.line+(event.key==='ArrowDown'?1:event.key==='ArrowUp'?-1:0);
      const candidates=stops.map((stop,index)=>({stop,index})).filter(item=>item.stop.line===targetLine);
      if(candidates.length)next=event.key==='Home'?candidates[0]!.index:event.key==='End'?candidates.at(-1)!.index:candidates.reduce((a,b)=>Math.abs(a.stop.x-stops[current]!.x)<=Math.abs(b.stop.x-stops[current]!.x)?a:b).index;
    }
    event.preventDefault();focusStop=stops[next]!;select(event.shiftKey?value.anchor:focusStop.offset,focusStop.offset,focusStop);
  },{signal});
  element.ownerDocument.addEventListener('selectionchange',()=>{const value=selection();if(value)options.selection?.(value);},{signal});
  return {update,select,selection,get composing(){return composing;},destroy(){destroyed=true;abort.abort();element.removeAttribute('contenteditable');}};
}
