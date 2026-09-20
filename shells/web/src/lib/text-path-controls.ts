// SPDX-License-Identifier: MPL-2.0
/** Path controls share the authored guide with direct handles and the Inspector. */
import type { TextFrameV1 } from '@lolly-tools/core';
import { textGuideGeometry, parseSvgPath } from '@lolly/engine';
import { textControlNumber, styleTextControls, textControlRow } from './text-control-ui.ts';
import { t } from '../i18n.ts';
export function mountTextPathControls(root:HTMLElement,read:()=>TextFrameV1,write:(value:Partial<TextFrameV1>)=>void){
  const updates:Array<()=>void>=[];
  const row=(label:string,input:HTMLElement)=>textControlRow(root,label,input);
  for(const [key,label] of [['start',t('Path start')],['end',t('Path end')],['baseline',t('Baseline offset')]] as const){
    const field=textControlNumber(root,label,{value:read().path![key],min:key==='baseline'?-100000:0,max:100000,step:1,precision:3,onCommit:value=>write({path:{...read().path!,[key]:value}})});
    updates.push(()=>{const path=read().path!,length=textGuideGeometry(path.d).length;field.bounds(key==='baseline'?-100000:0,key==='start'?length-.001:key==='end'?length+(parseSvgPath(path.d)[0]?.closed?path.start:0):100000);field.set(path[key]);});
  }
  for(const [key,label] of [['reverse',t('Reverse guide direction')],['flip',t('Flip side')],['fit',t('Fit to path')],['guide',t('Show guide stroke')]] as const){
    const input=document.createElement('input');input.type='checkbox';input.addEventListener('change',()=>write({path:{...read().path!,[key]:input.checked}}));row(label,input);updates.push(()=>{input.checked=read().path![key];});
  }
  const note=document.createElement('p');note.className='fc-text-scope';note.textContent=t('Natural spacing keeps the authored text size. Fit to path scales it to the selected interval. A closed guide uses one traversal.');root.append(note);
  const refresh=()=>updates.forEach(update=>{update();});styleTextControls(root);refresh();return {refresh};
}
