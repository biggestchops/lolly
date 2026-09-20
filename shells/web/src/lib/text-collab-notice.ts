// SPDX-License-Identifier: MPL-2.0
/** Recovery stays on this device until the person copies or downloads it. */
import type { HostV1 } from '@lolly-tools/core/host-v1';
import type { Runtime } from '../../../../engine/src/runtime.ts';
import { parseTextDocument } from '../../../../engine/src/text-story-document.ts';
import { mountModal,type ModalHandle } from '../components/modal.ts';
import { assertTextSyncReady,subscribeTextSync,textSyncState } from './text-collab.ts';
import { t } from '../i18n.ts';
import { styleTextControls } from './text-control-ui.ts';
export function mountTextSyncNotice(runtime:Runtime,host:HostV1,root:HTMLElement):()=>void{
  const notice=document.createElement('aside'),message=document.createElement('span'),recover=document.createElement('button');
  notice.className='text-sync-status';notice.setAttribute('role','status');notice.setAttribute('data-export-hide','');recover.type='button';recover.className='btn';recover.textContent=t('Previous text');notice.append(message,recover);root.append(notice);
  let dialog:ModalHandle<void>|undefined;
  function refresh(){const state=textSyncState(runtime);notice.hidden=!state.pending&&!state.recoveries.length;message.textContent=state.pending?t('Text changes are incomplete or conflict. Editing and export wait for a consistent update. Save a recovery copy if syncing cannot finish.'):t('Text changed on another device. Previous versions are available until you close this document.');recover.hidden=!state.recoveries.length;}
  recover.addEventListener('click',()=>{
    dialog?.close();dialog=mountModal('',{className:'modal',ariaLabel:t('Previous text')});
    const select=document.createElement('select'),preview=document.createElement('textarea'),copy=document.createElement('button'),download=document.createElement('button'),close=document.createElement('button'),status=document.createElement('p');
    const saved=textSyncState(runtime).recoveries.slice().reverse();select.setAttribute('aria-label',t('Text version'));saved.forEach((item,index)=>{select.add(new Option(`${index+1}. ${item.label}`,String(index)));});
    preview.readOnly=true;preview.rows=10;preview.setAttribute('aria-label',t('Recovered story text'));preview.style.cssText='width:100%;white-space:pre-wrap';status.setAttribute('role','status');
    function selected(){return saved[Number(select.value)]!;}
    function show(){try{const documentValue=Object.entries(selected().values).find(([,value])=>typeof value==='string')?.[1];preview.value=parseTextDocument(documentValue).stories.map(story=>{let source=story.source;for(const inline of story.inlines.slice().sort((a,b)=>b.offset-a.offset))source=source.slice(0,inline.offset)+inline.originalText+source.slice(inline.offset+1);return source;}).join('\n\n');}catch{preview.value=t('This update is incomplete. Download its recovery file to retain the received source.');}}
    select.addEventListener('change',show);show();
    copy.textContent=t('Copy text');copy.type='button';copy.addEventListener('click',()=>{void host.clipboard.writeText(preview.value).then(()=>{status.textContent=t('Text copied.');}).catch(error=>{status.textContent=String(error);});});
    download.textContent=t('Download recovery');download.type='button';download.addEventListener('click',()=>{void host.export.download(new Blob([JSON.stringify({toolId:'design',values:selected().values},null,2)],{type:'application/json'}),'lolly-text-recovery.json').catch(error=>{status.textContent=String(error);});});
    close.textContent=t('Close');close.type='button';close.addEventListener('click',()=>dialog?.close());dialog.el.append(select,preview,copy,download,close,status);styleTextControls(dialog.el);select.focus();
  });
  const before=runtime.export;
  const guarded:Runtime['export']=(...args)=>{assertTextSyncReady(runtime);return before.apply(runtime,args);};runtime.export=guarded;
  const unsubscribe=subscribeTextSync(runtime,refresh);refresh();
  return()=>{unsubscribe();dialog?.close();notice.remove();if(runtime.export===guarded)runtime.export=before;};
}
