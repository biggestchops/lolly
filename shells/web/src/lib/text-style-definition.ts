// SPDX-License-Identifier: MPL-2.0
/** Explicit definition edits name their document-wide scope before applying. */
import type { TextNamedStyleV1 } from '@lolly-tools/core';
import { styleTextControls } from './text-control-ui.ts';
import { t } from '../i18n.ts';
export function mountStyleDefinition(root:HTMLElement,read:()=>TextNamedStyleV1[],write:(style:TextNamedStyleV1)=>void){
  const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=t('Edit style definition');details.append(summary);root.append(details);
  const scope=document.createElement('p');scope.textContent=t('Changes apply wherever this style is used.');details.append(scope);
  const selected=document.createElement('select'),name=document.createElement('input'),base=document.createElement('select'),next=document.createElement('select');
  for(const [label,input] of [[t('Style'),selected],[t('Style name'),name],[t('Based on'),base],[t('Next paragraph style'),next]] as const){const row=document.createElement('label');row.className='text-control-row';input.setAttribute('aria-label',label);row.append(document.createTextNode(label),input);details.append(row);}
  name.maxLength=128;
  const apply=document.createElement('button');apply.type='button';apply.textContent=t('Update style');details.append(apply);
  function load(){const styles=read(),style=styles.find(style=>style.id===selected.value);name.value=style?.name??'';base.replaceChildren(new Option(t('None'),''),...styles.filter(item=>item.id!==style?.id&&item.kind===style?.kind).map(item=>new Option(item.name,item.id)));base.value=style?.basedOn??'';next.replaceChildren(new Option(t('Same style'),''),...styles.filter(item=>item.kind==='paragraph').map(item=>new Option(item.name,item.id)));next.value=style?.next??'';next.disabled=style?.kind!=='paragraph';apply.disabled=!style;}
  selected.addEventListener('change',load);apply.addEventListener('click',()=>{const style=read().find(style=>style.id===selected.value);if(!style||!name.value.trim())return;const value={...style,name:name.value.trim()};if(base.value)value.basedOn=base.value;else delete value.basedOn;if(next.value&&style.kind==='paragraph')value.next=next.value;else delete value.next;write(value);});
  let stamp='';function refresh(){const styles=read(),key=JSON.stringify(styles);if(stamp===key||details.contains(document.activeElement))return;stamp=key;const id=selected.value;selected.replaceChildren(...styles.map(style=>new Option(style.name,style.id)));if(styles.some(style=>style.id===id))selected.value=id;load();}styleTextControls(root);refresh();return {refresh};
}
