// SPDX-License-Identifier: MPL-2.0
import { mountModal } from '../components/modal.ts';
import { openPdfFile } from './pdf-import.ts';
import { t } from '../i18n.ts';
import { setRulesSourcePages } from '../lib/design-tool-source.ts';
/** The Rules import starts with a bounded set of authored variants. */
export async function chooseRulesPages(file: File | Blob): Promise<number[] | undefined> {
  if (!/\.(pdf|ai)$/i.test((file as File).name || '')) return undefined;
  const handle = await openPdfFile(file);
  if (handle.pageCount === 1) {setRulesSourcePages(file,[0]);return [0];}
  return new Promise((resolve,reject)=>{
    const selected = new Set(Array.from({length:Math.min(24,handle.pageCount)},(_,i)=>i));
    let confirmed = false;
    const modal = mountModal('',{className:'modal dr-source',ariaLabel:t('Choose tool artboards'),onClose(){if(!confirmed)reject(new Error(t('Import cancelled.')));}});
    const heading = document.createElement('h2');heading.textContent=t('Choose tool artboards');
    const note=document.createElement('p');note.textContent=t('Choose up to 24 pages. Each becomes an artboard you can offer as a layout choice.');
    const grid=document.createElement('div');grid.className='dr-page-grid';
    const footer=document.createElement('footer');const status=document.createElement('p');status.setAttribute('role','status');
    const cancel=document.createElement('button');cancel.className='btn';cancel.textContent=t('Cancel');cancel.onclick=()=>modal.close();
    const done=document.createElement('button');done.className='btn btn--primary';done.textContent=t('Import selected artboards');
    const sync=()=>{status.textContent=t('{n} selected',{n:selected.size});done.disabled=!selected.size||selected.size>24;};
    done.onclick=()=>{const pages=[...selected].sort((a,b)=>a-b);setRulesSourcePages(file,pages);confirmed=true;modal.close();resolve(pages);};
    const count=Math.min(handle.pageCount,120);
    if(count<handle.pageCount) note.textContent += ' '+t('Showing the first 120 pages. Split a larger source PDF before importing.');
    for(let i=0;i<count;i++) {
      const label=document.createElement('label');label.className='dr-page-card';const image=document.createElement('img');image.alt='';
      const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=selected.has(i);checkbox.setAttribute('aria-label',t('Page {n}',{n:i+1}));
      checkbox.onchange=()=>{if(checkbox.checked)selected.add(i);else selected.delete(i);sync();};
      const title=document.createElement('span');title.textContent=t('Page {n}',{n:i+1});label.append(image,checkbox,title);grid.append(label);
    }
    footer.append(status,cancel,done);modal.el.append(heading,note,grid,footer);sync();
    void(async()=>{for(let i=0;i<count;i++){if(!modal.el.isConnected)return;try {const page=await handle.pageToSvg(i);const image=grid.children[i]!.querySelector('img')!;image.src=`data:image/svg+xml;charset=utf-8,${encodeURIComponent(page.svg)}`;} catch {grid.children[i]!.querySelector('span')!.textContent+=` · ${t('Preview unavailable')}`;}}})();
  });
}
