// SPDX-License-Identifier: MPL-2.0
/** Named styles and explicit override reset use the same commands on both surfaces. */
import type { TextNamedStyleV1 } from '@lolly-tools/core';
import type { TextStyleCommand } from '@lolly/engine';
import { mountStyleDefinition } from './text-style-definition.ts';
import { styleTextControls } from './text-control-ui.ts';
import { t } from '../i18n.ts';
export interface TextStyleControlState { styles: TextNamedStyleV1[]; paragraph?: string; character?: string; paragraphOverrides: boolean; characterOverrides: boolean; characterFormat?: import('@lolly-tools/core').TextCharacterV1; paragraphFormat?: import('@lolly-tools/core').TextParagraphStyleV1 }
export function mountTextStyleControls(root: HTMLElement, read: () => TextStyleControlState, write: (command: TextStyleCommand, label: string) => void, define?: (style:TextNamedStyleV1)=>void) {
  const details = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = t('Styles'); details.append(summary); root.append(details);
  const updates: Array<(state: TextStyleControlState) => void> = [];
  for (const kind of ['paragraph', 'character'] as const) {
    const row = document.createElement('label'), label = kind === 'paragraph' ? t('Paragraph style') : t('Character style'); row.className='text-control-row';row.textContent = label;
    const select = document.createElement('select'); select.setAttribute('aria-label', label);
    select.addEventListener('change', () => write({ kind, style: select.value || null }, label)); row.append(select); details.append(row);
    const reset = document.createElement('button'); reset.type = 'button'; reset.textContent = kind === 'paragraph' ? t('Reset paragraph overrides') : t('Reset character overrides');
    reset.addEventListener('click', () => write({ kind, reset: true }, reset.textContent!)); details.append(reset);
    if(define){const update=document.createElement('button');update.type='button';update.textContent=t('Update style from selection');update.title=t('Changes apply wherever this style is used.');update.addEventListener('click',()=>{const state=read(),style=state.styles.find(style=>style.id===state[kind]);if(style)define({...style,...(kind==='paragraph'?{paragraph:state.paragraphFormat}:{character:state.characterFormat})});});details.append(update);updates.push(state=>{update.disabled=!state[kind];});}
    if(define){
      const create=document.createElement('details'),title=document.createElement('summary');title.textContent=kind==='paragraph'?t('Create paragraph style'):t('Create character style');create.append(title);
      const name=document.createElement('input');name.maxLength=128;name.setAttribute('aria-label',t('New style name'));name.placeholder=t('New style name');create.append(name);
      const save=document.createElement('button');save.type='button';save.textContent=t('Create from selection');create.append(save);
      save.addEventListener('click',()=>{if(!name.value.trim()){name.focus();return;}const state=read(),id=`style-${crypto.randomUUID()}`;define({id,name:name.value.trim(),kind,...(kind==='paragraph'?{paragraph:state.paragraphFormat}:{character:state.characterFormat})});write({kind,style:id,reset:true},t('Apply text style'));name.value='';create.open=false;});details.append(create);
    }
    updates.push(state => {
      const styles = state.styles.filter(style => style.kind === kind);
      if (select.dataset.styles !== JSON.stringify(styles)) {
        select.replaceChildren(new Option(t('Inherited'), ''), ...styles.map(style => new Option(style.name, style.id))); select.dataset.styles = JSON.stringify(styles);
      }
      if (document.activeElement !== select) select.value = state[kind] ?? '';
      reset.disabled = !state[kind === 'paragraph' ? 'paragraphOverrides' : 'characterOverrides'];
    });
  }
  const definition=define?mountStyleDefinition(details,()=>read().styles,define):undefined;
  function refresh() { definition?.refresh(); const state = read(); for (const update of updates) update(state); }
  styleTextControls(root); refresh(); return { refresh };
}
