// SPDX-License-Identifier: MPL-2.0
/** Explicit frame and spacing guides preview one complete layout, then commit once. */
import { parseTextFrame, formatStoryParagraphs, textStyleResolver } from '@lolly/engine';
import { textControlNumber, styleTextControls } from '../../lib/text-control-ui.ts';
import { t } from '../../i18n.ts';
import { bindOp, type FcCtx } from './context.ts';
type Property='left'|'right'|'top'|'bottom'|'gutter'|'spaceBefore'|'spaceAfter';
export function open(fc: FcCtx, anchor: HTMLElement, id: string, spacing=false): void {
  if(fc.editing)fc.textEdit.commitTextEdit();fc.toolbox.closePopover();
  let snapshot=fc.storyText.read(),key=JSON.stringify(snapshot),frame=snapshot.frames.find(frame=>frame.id===id);
  if(!frame || frame.locked || frame.mode==='path')return;
  const storyId=frame.storyId,panel=document.createElement('div');panel.className='fc-text-popover';panel.setAttribute('role','dialog');panel.setAttribute('aria-label',spacing?t('Adjust spacing'):t('Adjust frame'));
  fc.popover=panel;fc.popoverAnchor=anchor;panel.setAttribute('data-export-hide','');
  const caption=document.createElement('p');caption.textContent=spacing?t('One paragraph'):t('Selected text frame');panel.append(caption);
  const properties=document.createElement('select');properties.setAttribute('aria-label',t('Guide'));
  for(const [value,label] of (spacing?[['spaceBefore',t('Space before')],['spaceAfter',t('Space after')]]:[['left',t('Left inset')],['right',t('Right inset')],['top',t('Top inset')],['bottom',t('Bottom inset')],['gutter',t('Column gutter')]]))properties.add(new Option(label,value));panel.append(properties);
  const paragraphs=document.createElement('select');paragraphs.setAttribute('aria-label',t('Paragraph'));
  const story=()=>snapshot.document.stories.find(story=>story.id===storyId)!;
  for(const paragraph of story().paragraphs)paragraphs.add(new Option(story().source.slice(paragraph.start,paragraph.end).slice(0,45)||t('Empty paragraph'),paragraph.id));if(spacing)panel.append(paragraphs);
  const numeric=textControlNumber(panel,t('Guide value'),{value:0,min:0,max:100000,step:1,precision:1,onCommit:value=>{draft=value;void commit();}}),field=numeric.input;
  const status=document.createElement('p');status.setAttribute('role','status');panel.append(status);
  const handle=document.createElement('button');handle.type='button';handle.className='fc-text-flow-port';handle.dataset.textAdjust='';handle.style.touchAction='none';fc.overlay.append(handle);
  const guide=document.createElementNS('http://www.w3.org/2000/svg','svg');guide.dataset.textAdjust='';guide.setAttribute('aria-hidden','true');Object.assign(guide.style,{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none',overflow:'visible'});fc.overlay.append(guide);
  let raf=0,draft=0,ticket=0,closed=false,moved=false,drag:{x:number;y:number;value:number}|undefined;
  const saved=new Map<string,string>();
  const textElement=(frameId:string)=>fc.stage.liveBoxEl(frameId)?.querySelector<HTMLElement>('.lolly-box-text');
  const property=()=>properties.value as Property;
  function value():number {
    const prop=property();if(prop==='gutter')return frame!.columns.gutter;
    if(prop==='spaceBefore'||prop==='spaceAfter')return textStyleResolver(snapshot.document).paragraph(story(),story().paragraphs.find(paragraph=>paragraph.id===paragraphs.value)!)[prop]??0;
    return frame!.inset[prop];
  }
  function updated(){
    const next=structuredClone(snapshot),prop=property();
    if(spacing){const current=next.document.stories.find(story=>story.id===storyId)!;next.document.stories=next.document.stories.map(story=>story.id===storyId?formatStoryParagraphs(current,[paragraphs.value],{[prop]:draft}):story);}
    else next.frames=next.frames.map(item=>item.id===id?parseTextFrame({...item,...(prop==='gutter'?{columns:{...item.columns,gutter:draft}}:{inset:{...item.inset,[prop]:draft}})}):item);
    return next;
  }
  function restore(){ticket++;if(JSON.stringify(fc.storyText.read())===key)for(const [frameId,html] of saved){const target=textElement(frameId);if(target)target.innerHTML=html;}saved.clear();}
  function position(){
    const svg=textElement(id)?.querySelector<SVGSVGElement>('svg'),matrix=svg?.getScreenCTM();if(!matrix || !frame)return;
    const prop=property(),w=frame.width,h=frame.height;let x=w/2,y=h/2,vertical=prop==='left'||prop==='right'||prop==='gutter';
    if(prop==='left')x=draft;else if(prop==='right')x=w-draft;else if(prop==='top')y=draft;else if(prop==='bottom')y=h-draft;
    else if(prop==='gutter')x=frame.inset.left+(w-frame.inset.left-frame.inset.right-(frame.columns.count-1)*draft)/frame.columns.count+draft;
    else {const request={document:snapshot.document,storyId,frames:snapshot.frames.filter(frame=>frame.storyId===storyId)},layout=fc.storyText.peek(request)?.layout;const lines=layout?.lines.filter(line=>line.frameId===id&&line.paragraphId===paragraphs.value);const line=prop==='spaceBefore'?lines?.[0]:lines?.at(-1);y=line?(prop==='spaceBefore'?line.y:line.y+line.height+draft):h/2;}
    const root=fc.overlay.getBoundingClientRect(),point=(x:number,y:number)=>{const p=new DOMPoint(x,y).matrixTransform(matrix);return {x:p.x-root.x,y:p.y-root.y};},p=point(x,y),a=point(vertical?x:0,vertical?0:y),b=point(vertical?x:w,vertical?h:y);
    handle.style.left=`${p.x-22}px`;handle.style.top=`${p.y-22}px`;handle.textContent=String(Math.round(draft*10)/10);handle.setAttribute('aria-label',`${properties.selectedOptions[0]?.text}: ${Math.round(draft*10)/10}`);
    guide.innerHTML=`<path d="M${a.x} ${a.y}L${b.x} ${b.y}" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 3"/>`;
    handle.hidden=prop==='gutter'&&frame.columns.count<2;field.disabled=handle.hidden;status.textContent=handle.hidden?t('Add at least two columns to adjust their gutter.'):t('Drag the guide, use arrow keys, or enter a value. Enter commits; Escape cancels.');
  }
  const follow=()=>{if(closed)return;position();raf=requestAnimationFrame(follow);};
  async function preview(){
    const generation=++ticket;try{const next=updated();const layout=await fc.storyText.layout({document:next.document,storyId,frames:next.frames.filter(frame=>frame.storyId===storyId),includeSvg:true});
      if(closed || generation!==ticket || JSON.stringify(fc.storyText.read())!==key)return;
      for(const item of layout.frames){const target=textElement(item.id);if(target && item.svg){if(!saved.has(item.id))saved.set(item.id,target.innerHTML);target.innerHTML=item.svg;}}
      position();
    }catch(error){if(generation===ticket)status.textContent=error instanceof Error?error.message:String(error);}
  }
  async function commit(){
    if(JSON.stringify(fc.storyText.read())!==key){restore();status.textContent=t('The story changed. Reopen its guides.');return;}
    try{const next=updated();ticket++;saved.clear();await fc.storyText.write(next,spacing?t('Paragraph spacing'):t('Text frame'));if(closed)return;snapshot=fc.storyText.read();key=JSON.stringify(snapshot);frame=snapshot.frames.find(frame=>frame.id===id);position();}
    catch(error){restore();status.textContent=error instanceof Error?error.message:String(error);}
  }
  const reset=()=>{restore();draft=value();numeric.set(draft);position();};properties.addEventListener('change',reset);paragraphs.addEventListener('change',reset);

  handle.addEventListener('pointerdown',event=>{event.preventDefault();event.stopPropagation();const matrix=textElement(id)?.querySelector('svg')?.getScreenCTM();if(!matrix)return;const at=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());drag={x:at.x,y:at.y,value:draft};moved=false;handle.setPointerCapture(event.pointerId);handle.focus();});
  handle.addEventListener('pointermove',event=>{if(!drag)return;const matrix=textElement(id)?.querySelector('svg')?.getScreenCTM();if(!matrix)return;const at=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse()),prop=property();const delta=prop==='left'?at.x-drag.x:prop==='right'?drag.x-at.x:prop==='gutter'?(at.x-drag.x)*frame!.columns.count:prop==='bottom'||prop==='spaceBefore'?drag.y-at.y:at.y-drag.y;if(Math.abs(delta)>1)moved=true;draft=Math.max(0,Math.round((drag.value+delta)*10)/10);numeric.set(draft);position();void preview();});
  handle.addEventListener('pointerup',()=>{if(!drag)return;drag=undefined;if(moved)void commit();else{field.focus();field.select();}});
  handle.addEventListener('pointercancel',()=>{drag=undefined;reset();});
  handle.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();drag=undefined;reset();}else if(event.key==='Enter'){event.preventDefault();void commit();}else if(event.key.startsWith('Arrow')){event.preventDefault();event.stopPropagation();draft=Math.max(0,draft+(['ArrowLeft','ArrowUp'].includes(event.key)?-1:1)*(event.shiftKey?10:1));numeric.set(draft);position();void preview();}});
  panel.addEventListener('pointerdown',event=>event.stopPropagation());panel.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();fc.toolbox.closePopover(true);}});
  panel.addEventListener('lolly:popover-close',()=>{closed=true;cancelAnimationFrame(raf);restore();handle.remove();guide.remove();});
  const done=document.createElement('button');done.type='button';done.textContent=t('Done');done.addEventListener('click',()=>fc.toolbox.closePopover(true));panel.append(done);
  styleTextControls(panel);document.body.append(panel);const rect=anchor.getBoundingClientRect();panel.style.left=`${Math.max(8,Math.min(rect.left,innerWidth-panel.offsetWidth-8))}px`;panel.style.top=`${Math.max(8,Math.min(rect.bottom+8,innerHeight-panel.offsetHeight-8))}px`;reset();follow();properties.focus();
}
export function storyGuidesOps(fc: FcCtx){return {open:bindOp(fc,open)};}
