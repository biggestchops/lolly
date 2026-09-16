// SPDX-License-Identifier: MPL-2.0
import type { DesignToolDraftV1 } from '@lolly-tools/core/design-tool-v1';
import { suggestDesignRebind } from '../lib/design-tool-rebind.ts';
import { mountModal } from '../components/modal.ts';
import { t } from '../i18n.ts';
/** Cross-artboard suggestions are reviewed explicitly before creating links. */
export function reviewMatchingObjects(draft:DesignToolDraftV1, inputId:string, commit:(draft:DesignToolDraftV1)=>void):void {
  const field=draft.inputs.find(f=>f.input.id===inputId);const target=field?.targets[0];
  const box=draft.variants.find(v=>v.id===target?.variantId)?.boxes.find(b=>b.id===target?.layerId);if(!field||!target||!box)return;
  const next=structuredClone(draft);const result=next.inputs.find(f=>f.input.id===inputId)!;
  const modal=mountModal('',{className:'modal dr-share',ariaLabel:t('Review matching objects')});const h=document.createElement('h2');h.textContent=t('Review matching objects');
  const note=document.createElement('p');note.textContent=t('Only unique layer names or unchanged text are suggested. Choose the objects that should share this input.');
  modal.el.append(h,note);const picked=new Set<string>();
  for(const variant of draft.variants.filter(v=>v.id!==target.variantId)) {
    const id=suggestDesignRebind(box,variant.boxes);if(!id||field.targets.some(t=>t.layerId===id))continue;
    const label=document.createElement('label');label.className='dr-check';const checkbox=document.createElement('input');checkbox.type='checkbox';
    checkbox.onchange=()=>{if(checkbox.checked)picked.add(id);else picked.delete(id);};label.append(checkbox,document.createTextNode(`${variant.label} · ${String(variant.boxes.find(b=>b.id===id)?.name||t('Matching text'))}`));modal.el.append(label);
  }
  if(!modal.el.querySelector('input'))note.textContent=t('No unique matches found. Select the corresponding object and use Link selection.');
  const footer=document.createElement('footer');const cancel=document.createElement('button');cancel.className='btn';cancel.textContent=t('Cancel');cancel.onclick=()=>modal.close();
  const apply=document.createElement('button');apply.className='btn btn--primary';apply.textContent=t('Link selected matches');apply.onclick=()=>{for(const variant of next.variants)for(const b of variant.boxes)if(picked.has(String(b.id)))result.targets.push({...target,variantId:variant.id,layerId:String(b.id)});commit(next);modal.close();};footer.append(cancel,apply);modal.el.append(footer);
}
