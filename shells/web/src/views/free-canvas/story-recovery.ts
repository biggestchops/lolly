// SPDX-License-Identifier: MPL-2.0
/** Full source editing and unplaced stories use the same authored document and undo history. */
import { deleteTextStory, placeTextStory, defaultTextFrameSettings, replaceStoryRange, snapTextRange } from '@lolly/engine';
import { nativeTextChange } from '../../lib/text-native.ts';
import type { Box } from '../free-canvas-math.ts';
import { styleTextControls } from '../../lib/text-control-ui.ts';
import { t } from '../../i18n.ts';
import { announce } from '../../a11y.ts';
import { bindOp, type FcCtx } from './context.ts';
const failure=(error:unknown)=>announce(error instanceof Error?error.message:String(error));
function panel(fc: FcCtx, anchor: HTMLElement, label: string): HTMLDivElement {
  if(fc.editing)fc.textEdit.commitTextEdit();fc.toolbox.closePopover();
  const element=document.createElement('div');element.className='fc-text-popover';element.setAttribute('role','dialog');element.setAttribute('aria-label',label);element.setAttribute('data-export-hide','');
  fc.popover=element;fc.popoverAnchor=anchor;
  element.addEventListener('pointerdown',event=>event.stopPropagation());
  element.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape' && !event.isComposing){event.preventDefault();fc.toolbox.closePopover(true);}});
  styleTextControls(element);document.body.append(element);const rect=anchor.getBoundingClientRect(),view=window.visualViewport,left=view?.offsetLeft??0,top=view?.offsetTop??0,width=view?.width??innerWidth,height=view?.height??innerHeight;
  element.style.width=`${Math.min(520,width-24)}px`;element.style.maxHeight=`${Math.max(120,height-32)}px`;
  element.style.left=`${Math.max(left+8,Math.min(rect.left,left+width-element.offsetWidth-8))}px`;element.style.top=`${top+24}px`;
  return element;
}
const button=(parent:HTMLElement,label:string,run:()=>void)=>{const el=document.createElement('button');el.type='button';el.className='btn btn--sm text-control-action';el.textContent=label;el.addEventListener('click',run);parent.append(el);return el;};
/** Textarea line normalization must not rewrite untouched CRLF or authored soft breaks. */
function projection(source: string): {text:string;offsets:number[]} {
  const offsets=[0];let text='';
  for(let at=0;at<source.length;at++){
    if(source[at]==='\r' && source[at+1]==='\n')at++;
    text+=/[\r\n\u2028\u2029]/u.test(source[at]!)?'\n':source[at];offsets.push(at+1);
  }
  return {text,offsets};
}
export function edit(fc: FcCtx, anchor: HTMLElement, storyId: string, start=0): void {
  const element=panel(fc,anchor,t('Edit story')),snapshot=fc.storyText.read();
  let story=snapshot.document.stories.find(story=>story.id===storyId);if(!story){fc.toolbox.closePopover(true);return;}
  const caption=document.createElement('p');caption.textContent=t('Entire story, including text beyond the frames');element.append(caption);
  const source=document.createElement('textarea');source.className='field-input';source.setAttribute('aria-label',t('Story text'));source.spellcheck=true;source.rows=12;source.style.width='100%';element.append(source);
  const status=document.createElement('p');status.setAttribute('role','status');element.append(status);
  let shown=projection(story.source),composing=false;source.value=shown.text;
  const save=()=>{
    if(composing || !story)return;
    const current=fc.storyText.read(),latest=current.document.stories.find(item=>item.id===storyId);
    if(!latest || JSON.stringify(latest)!==JSON.stringify(story)){status.textContent=t('This story changed elsewhere. Copy your text before reopening it.');return;}
    const change=nativeTextChange(shown.text,source.value);if(!change)return;
    try {
      const range=snapTextRange(story.source,{start:shown.offsets[change.range.start]!,end:shown.offsets[change.range.end]!});
      const next=replaceStoryRange(story,range,{source:change.text},{paragraphId:()=>`text-${crypto.randomUUID()}`}).story;
      current.document.stories=current.document.stories.map(item=>item.id===storyId?next:item);story=next;shown=projection(next.source);
      status.textContent=t('Laying out text…');
      void fc.storyText.write(current,t('Edit story'),`text:${storyId}`).then(()=>{if(element.isConnected)status.textContent=t('Story saved.');}).catch(error=>{status.textContent=error instanceof Error?error.message:String(error);});
    }catch(error){status.textContent=error instanceof Error?error.message:String(error);}
  };
  source.addEventListener('input',save);source.addEventListener('compositionstart',()=>{composing=true;});source.addEventListener('compositionend',()=>{composing=false;save();});
  source.addEventListener('keydown',event=>{
    if(event.isComposing)return;
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='z'){
      event.preventDefault();if(event.shiftKey)fc.history?.redo();else fc.history?.undo();
      const next=fc.storyText.read().document.stories.find(item=>item.id===storyId);if(next){const a=source.selectionStart,b=source.selectionEnd;story=next;shown=projection(next.source);source.value=shown.text;source.setSelectionRange(Math.min(a,source.value.length),Math.min(b,source.value.length));}
    }
  });
  if(!story.frameIds.length)button(element,t('Place text'),()=>{fc.toolbox.closePopover();place(fc,storyId);});
  button(element,t('Copy entire story'),()=>{void navigator.clipboard.writeText(story!.source).then(()=>{status.textContent=t('Story copied.');}).catch(failure);});
  button(element,t('Delete story and frames'),()=>{
    const current=fc.storyText.read().document.stories.find(item=>item.id===storyId);if(!current)return;
    element.replaceChildren();const preview=document.createElement('p');preview.textContent=t('Delete all {n} characters and {frames} text frames?',{n:current.source.length,frames:current.frameIds.length});element.append(preview);
    button(element,t('Delete story and frames'),()=>{void remove(fc,storyId);fc.toolbox.closePopover();});button(element,t('Cancel'),()=>edit(fc,anchor,storyId,start));
  });
  button(element,t('Done'),()=>{if(!composing){save();fc.toolbox.closePopover(true);}});
  source.focus();const at=shown.offsets.findIndex(offset=>offset>=start);source.setSelectionRange(Math.max(0,at),Math.max(0,at));
}
export function unplaced(fc: FcCtx, anchor: HTMLElement): void {
  const element=panel(fc,anchor,t('Unplaced text'));
  for(const story of fc.storyText.read().document.stories.filter(story=>!story.frameIds.length)){
    const section=document.createElement('section'),label=document.createElement('p');label.textContent=story.source.slice(0,100)||t('Empty story');section.append(label);element.append(section);
    button(section,t('Place text'),()=>{fc.toolbox.closePopover();place(fc,story.id);});button(section,t('Edit story'),()=>edit(fc,anchor,story.id));
  }
  button(element,t('Done'),()=>fc.toolbox.closePopover(true));element.querySelector<HTMLButtonElement>('button')?.focus();
}
export function place(fc: FcCtx, storyId: string): void {
  const kind=fc.addKinds.find(kind=>kind.id==='text');if(!kind)return;
  fc.modes.setMode('create',{kind:{...kind,id:'place-text',label:t('Place text'),seed:{...kind.seed,[fc.cv.textFrameField!]:'fixed',__textPlace:storyId}}});
}
export async function created(fc: FcCtx, boxes: Box[], id: string, storyId: string): Promise<void> {
  try{
    const box=boxes.find(box=>box[fc.cfg.idField]===id)!;delete box.__textPlace;box[fc.cfg.textField]='';
    const next=placeTextStory(fc.storyText.read(),storyId,{...defaultTextFrameSettings(),id,storyId,width:Number(box[fc.cfg.wField]),height:Number(box[fc.cfg.hField])});
    const pending=fc.storyFlow.commit(next,boxes,t('Place text'));fc.selection=new Set([id]);fc.chromeSync.renderChrome();await pending;
  }catch(error){failure(error);}
}
export async function remove(fc: FcCtx, storyId: string): Promise<void> {
  try {
    const snapshot=fc.storyText.read(),ids=new Set(snapshot.document.stories.find(story=>story.id===storyId)?.frameIds);
    await fc.storyFlow.commit(deleteTextStory(snapshot,storyId),fc.select.getBoxes().filter(box=>!ids.has(String(box[fc.cfg.idField]))),t('Delete story and frames'));
    fc.selection=new Set([...fc.selection].filter(id=>!ids.has(id)));fc.chromeSync.renderChrome();
  }catch(error){failure(error);}
}
export function storyRecoveryOps(fc: FcCtx){return {edit:bindOp(fc,edit),unplaced:bindOp(fc,unplaced),place:bindOp(fc,place),created:bindOp(fc,created),remove:bindOp(fc,remove)};}
