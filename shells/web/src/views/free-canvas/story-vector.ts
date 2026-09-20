// SPDX-License-Identifier: MPL-2.0
/** A conversion is prepared against one revision and committed with its source copy. */
import { readDesignText,upgradeDesignText,removeTextFrames,detachTextFrame,deleteTextStory,duplicateTextFrames,parseTextDocument,renderVectorPaint } from '@lolly/engine';
import { textFrameVectors,textInlineVectors,type TextVectorScope } from '../../../../../engine/src/text-vector.ts';
import type { TextRangeV1,TextLayoutV1 } from '@lolly-tools/core';
import { captureLegacyText } from '../../lib/text-editor-migration.ts';
import type { Box } from '../free-canvas-math.ts';
import { styleTextControls } from '../../lib/text-control-ui.ts';
import { t } from '../../i18n.ts';
import { bindOp,type FcCtx } from './context.ts';
const fresh=()=>`vector-${crypto.randomUUID()}`;
const parser=(source:string)=>new DOMParser().parseFromString(source,'image/svg+xml');
type Options={scope:TextVectorScope;keep:boolean;appearance:boolean;range?:{id:string;range:TextRangeV1}};
function key(fc:FcCtx){return JSON.stringify({snapshot:fc.storyText.read(),boxes:fc.select.getBoxes()});}
export async function prepare(fc:FcCtx,ids:string[],options:Options){
  const before=key(fc);let snapshot=structuredClone(fc.storyText.read()),boxes=structuredClone(fc.select.getBoxes());
  const layouts=new Map<string,TextLayoutV1>(),selection=new Set<string>(),previews:string[]=[];
  for(const id of ids){
    const box=boxes.find(box=>box[fc.cfg.idField]===id);if(!box)throw new Error(t('The text object no longer exists.'));
    if([true,'true',1,'1'].includes(box[fc.frameCfg?.lockedField??'locked'] as string|number|boolean))throw new Error(t('Unlock this text frame before converting it.'));
    if(box.split&&box.split!=='none')throw new Error(t('Turn off split-text animation before converting this text.'));
    if(box.linkOf||boxes.some(item=>item.clip===id))throw new Error(t('Remove this text object’s media link or clipping references before converting it.'));
    if(!box[fc.cv.textStoryField!]){
      const element=fc.stage.liveBoxEl(id)?.querySelector<HTMLElement>('.lolly-box-text');if(!element)throw new Error(t('The text object is not visible.'));
      const captured=await captureLegacyText(element),patch=upgradeDesignText(snapshot.document,boxes,id,{storyId:fresh(),...captured});boxes=patch.boxes as Box[];snapshot=readDesignText(patch.textDocument,boxes);
    }
  }
  for(const story of snapshot.document.stories)if(story.frameIds.some(id=>ids.includes(id))){const layout=await fc.storyText.layout({document:snapshot.document,storyId:story.id,frames:snapshot.frames.filter(frame=>frame.storyId===story.id),includeSvg:true});if(layout.diagnostics.some(notice=>notice.severity==='error'))throw new Error(t('Resolve text overflow and layout errors before converting it.'));layouts.set(story.id,layout);}
  const original=structuredClone(snapshot);
  if(options.scope!=='all'||options.range){
    const wanted=new Map<string,TextRangeV1[]>();
    for(const id of ids){const frame=snapshot.frames.find(frame=>frame.id===id)!,layout=layouts.get(frame.storyId)!,settled=layout.frames.find(frame=>frame.id===id)!;
      const ranges=wanted.get(frame.storyId)??[];ranges.push(options.range?.id===id?options.range.range:{start:settled.start,end:settled.end});wanted.set(frame.storyId,ranges);
    }
    if(options.keep){
      const copies=new Map<string,string>();for(const story of snapshot.document.stories)if(wanted.has(story.id))for(const id of story.frameIds)copies.set(id,fresh());
      snapshot=await duplicateTextFrames(snapshot,copies,new Map(),fresh);
      const copyBoxes=boxes.filter(box=>copies.has(String(box[fc.cfg.idField]))).map(box=>({...box,[fc.cfg.idField]:copies.get(String(box[fc.cfg.idField]))!,hidden:true,locked:false,[fc.nameField]:t('Editable text source'),vectorSource:JSON.stringify({version:1,sourceCopy:true})}));boxes.push(...copyBoxes);
    }
    for(const [storyId,ranges]of wanted){let story=snapshot.document.stories.find(story=>story.id===storyId)!;const layout=layouts.get(storyId)!;
      for(const range of ranges.sort((a,b)=>b.start-a.start)){const converted=await textInlineVectors({...layout,revision:story.revision},story,range,parser,options.scope,fresh);story=converted.story;}
      for(const inline of story.inlines)if(inline.emojiSources?.length)inline.credits=inline.emojiSources.map(source=>({name:source.source.creator.slice(0,1024),url:source.source.sourceUrl.slice(0,2048),license:source.source.license.slice(0,2048)}));
      snapshot.document.stories=snapshot.document.stories.map(item=>item.id===storyId?story:item);
      const composed=await fc.storyText.layout({document:snapshot.document,storyId,frames:snapshot.frames.filter(frame=>frame.storyId===storyId),includeSvg:true});
      previews.push(...composed.frames.filter(frame=>ids.includes(frame.id)).map(frame=>frame.svg!));
    }
    for(const id of ids)selection.add(id);
  }else{
    for(const id of ids){
      const box=boxes.find(box=>box[fc.cfg.idField]===id)!,frame=original.frames.find(frame=>frame.id===id)!,story=original.document.stories.find(story=>story.id===frame.storyId)!,layout=layouts.get(story.id)!;
      if(story.frameIds.length>1&&!options.appearance){if(ids.length!==1)throw new Error(t('Select one linked frame to detach and freeze its visible text.'));snapshot=await detachTextFrame(snapshot,id,layout,fresh);}
      const vector=await textFrameVectors(layout,story,id,parser),newId=fresh();
      previews.push(renderVectorPaint(vector.path,vector.paint,vector.paint.width,vector.paint.height,newId));
      const made:Box={...box,[fc.cfg.idField]:newId,[fc.cfg.kindField]:'path',[fc.cfg.pathField]:vector.path,pathPaint:JSON.stringify(vector.paint),[fc.cfg.textField]:'',[fc.cv.textStoryField!]:'',[fc.cv.textFrameField!]:'',[fc.cfg.fillField]:'none',[fc.cfg.strokeField]:'',[fc.cfg.strokeWField]:0,[fc.cfg.imageField]:'',[fc.cfg.gradField]:'',shape:'rect',[fc.nameField]:t('Paths: {text}',{text:vector.label.slice(0,60)}),vectorSource:JSON.stringify({version:1,text:vector.label,resources:vector.resources,sources:vector.emojiSources}),hidden:false,locked:false};
      const index=boxes.indexOf(box),keep=options.keep||options.appearance&&story.frameIds.length>1;
      const background=fc.objects.paintsBesidesText(box)?{...box,[fc.cfg.idField]:fresh(),[fc.cfg.textField]:'',[fc.cv.textStoryField!]:'',[fc.cv.textFrameField!]:'',[fc.nameField]:t('Text background')}:undefined;
      boxes.splice(index,1,...(keep?[{...box,hidden:true,[fc.nameField]:t('Editable text source'),vectorSource:JSON.stringify({version:1,sourceCopy:true})}]:[]),...(background?[background]:[]),made);selection.add(newId);
      if(!keep){const owner=snapshot.frames.find(frame=>frame.id===id)!.storyId;snapshot=removeTextFrames(snapshot,[id]);if(!snapshot.document.stories.find(item=>item.id===owner)!.frameIds.length)snapshot=deleteTextStory(snapshot,owner);}
    }
  }
  snapshot.document=parseTextDocument(snapshot.document);
  if(key(fc)!==before)throw new Error(t('The text changed while its paths were prepared. Open conversion again.'));
  return {snapshot,boxes,selection,before,previews};
}
export async function open(fc:FcCtx,anchor:HTMLElement,range?:{id:string;range:TextRangeV1}):Promise<void>{
  if(!fc.storyText.available())return;const ids=range?[range.id]:[...fc.selection].filter(id=>fc.select.getBoxes().some(box=>box[fc.cfg.idField]===id&&(box[fc.cv.textStoryField!]||String(box[fc.cfg.textField]??'').trim())));if(!ids.length)return;
  if(fc.editing?.composed){await fc.storyText.finish();if(fc.editing)return;}else if(fc.editing)fc.textEdit.commitTextEdit();fc.toolbox.closePopover();
  const panel=document.createElement('div');panel.className='fc-text-popover';panel.setAttribute('role','dialog');panel.setAttribute('aria-label',range?t('Convert selection to paths'):t('Convert to paths'));panel.setAttribute('data-export-hide','');fc.popover=panel;fc.popoverAnchor=anchor;
  const note=document.createElement('p');note.textContent=range?t('Selected text becomes fixed-advance inline vectors.'):t('Selected text objects become editable vectors. Path geometry replaces ordinary text editing and search.');panel.append(note);
  const scope=document.createElement('select');scope.setAttribute('aria-label',t('Convert'));for(const [value,label]of [['all',t('Text and emoji')],['text',t('Text only')],['emoji',t('Emoji only')]])scope.add(new Option(label,value));panel.append(scope);
  const label=document.createElement('label'),keep=document.createElement('input');keep.type='checkbox';keep.checked=true;label.append(keep,document.createTextNode(t('Keep editable copy')));panel.append(label);
  const linked=ids.some(id=>fc.storyText.read().document.stories.some(story=>story.frameIds.includes(id)&&story.frameIds.length>1));
  const thread=document.createElement('select');thread.setAttribute('aria-label',t('Linked frame conversion'));thread.add(new Option(t('Duplicate appearance'),'appearance'));thread.add(new Option(t('Detach and freeze visible text'),'detach'));
  if(linked&&!range){panel.append(thread);const info=document.createElement('p');info.textContent=t('Duplicate appearance preserves the original thread. Detach removes this visible range from the thread; remaining text recomposes.');panel.append(info);}
  const preview=document.createElement('div');preview.setAttribute('aria-label',t('Conversion preview'));preview.style.cssText='max-height:180px;overflow:auto';panel.append(preview);
  const status=document.createElement('p');status.setAttribute('role','status');panel.append(status);
  const apply=document.createElement('button');apply.type='button';apply.textContent=t('Apply');apply.disabled=true;panel.append(apply);
  let ticket=0,closed=false,prepared:Awaited<ReturnType<typeof prepare>>|undefined;
  async function refresh(){const generation=++ticket;prepared=undefined;apply.disabled=true;status.textContent=t('Preparing paths…');try{const next=await prepare(fc,ids,{scope:scope.value as TextVectorScope,keep:keep.checked,appearance:thread.value==='appearance',range});if(closed||generation!==ticket)return;prepared=next;status.textContent=t('{n} text objects are ready. Apply creates one undo step.',{n:ids.length});preview.replaceChildren(...next.previews.map(svg=>{const image=document.createElement('img');image.alt=t('Prepared vector appearance');image.src=`data:image/svg+xml,${encodeURIComponent(svg)}`;image.style.cssText='display:block;width:100%;max-height:160px;object-fit:contain';return image;}));apply.disabled=false;}catch(error){if(!closed&&generation===ticket)status.textContent=error instanceof Error?error.message:String(error);}}
  thread.addEventListener('change',()=>void refresh());scope.addEventListener('change',()=>void refresh());keep.addEventListener('change',()=>void refresh());
  apply.addEventListener('click',()=>{if(!prepared)return;const next=prepared;if(key(fc)!==next.before){status.textContent=t('The text changed. Prepare the conversion again.');void refresh();return;}apply.disabled=true;void fc.storyFlow.commit(next.snapshot,next.boxes,t('Convert to paths')).then(()=>{fc.selection=next.selection;fc.chromeSync.renderChrome();fc.toolbox.closePopover();}).catch(error=>{status.textContent=error instanceof Error?error.message:String(error);apply.disabled=false;});});
  const cancel=document.createElement('button');cancel.type='button';cancel.textContent=t('Cancel');cancel.addEventListener('click',()=>fc.toolbox.closePopover(true));panel.append(cancel);
  panel.addEventListener('pointerdown',event=>event.stopPropagation());panel.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();fc.toolbox.closePopover(true);}});panel.addEventListener('lolly:popover-close',()=>{closed=true;ticket++;});
  styleTextControls(panel);document.body.append(panel);const rect=anchor.getBoundingClientRect();panel.style.left=`${Math.max(8,Math.min(rect.left,innerWidth-panel.offsetWidth-8))}px`;panel.style.top=`${Math.max(8,Math.min(rect.bottom+8,innerHeight-panel.offsetHeight-8))}px`;void refresh();scope.focus();
}
export async function ungroup(fc:FcCtx,ids:string[]):Promise<void>{
  try{const before=JSON.stringify(fc.select.getBoxes()),[{splitVectorPaint},{editableVectorPart}]=await Promise.all([import('../../../../../engine/src/vector-paint-parts.ts'),import('../text-vector-parts.ts')]);const boxes=structuredClone(fc.select.getBoxes());const selected=new Set<string>();
    for(const id of ids){const index=boxes.findIndex(box=>box[fc.cfg.idField]===id),box=boxes[index];if(!box?.pathPaint)continue;
      if(box.locked||boxes.some(item=>item.clip===id)||box.linkOf)throw new Error(t('Unlock this vector and remove its clipping or media references before separating it.'));
      const parts=splitVectorPaint(String(box[fc.cfg.pathField]),box.pathPaint);
      const rows=parts.map((part,index)=>{const id=fresh();selected.add(id);return {...editableVectorPart(box,part,fc.cfg),[fc.cfg.idField]:id,...(fc.cfg.groupField?{[fc.cfg.groupField]:''}:{}),[fc.nameField]:t('Vector part {n}',{n:index+1})};});boxes.splice(index,1,...rows);
    }
    if(JSON.stringify(fc.select.getBoxes())!==before)throw new Error(t('The vector changed while its parts were prepared. Try again.'));
    fc.selection=selected;fc.select.commit(boxes);
  }catch(error){fc.stage.flash(error instanceof Error?error.message:String(error));}
}
export function storyVectorOps(fc:FcCtx){return {open:bindOp(fc,open),prepare:bindOp(fc,prepare),ungroup:bindOp(fc,ungroup)};}
