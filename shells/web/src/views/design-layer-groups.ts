// SPDX-License-Identifier: MPL-2.0
/** Artboard parents and their layer lists share one navigator with the page previews. */
import type { Box } from './free-canvas-math.ts';
import { tRaw as t } from '../i18n.ts';

export function mountLayerGroups(opts: {
  host: HTMLElement; pages: HTMLElement; section: HTMLElement; list: HTMLElement; heading: HTMLElement;
  id(box:Box):string; name(box:Box,index:number):string; children(box:Box):Box[];
  row(box:Box,index:number,loose:boolean,list:HTMLElement):HTMLElement;
  jump(id:string):void;
}) {
  const expanded = new Map<string,boolean>();
  let mode: 'layers' | 'pages' = 'layers';
  let active = '';
  let chosen:string[]=[];
  let hasFrames = false;
  let hasLayers = false;
  const switcher=document.createElement('div');switcher.className='fc-nav-modes';
  switcher.setAttribute('role','group');switcher.setAttribute('aria-label',t('Navigator view'));
  const buttons=new Map<string,HTMLButtonElement>();
  const applyMode=():void=>{
    opts.pages.hidden=mode!=='pages'||!hasFrames;
    opts.section.hidden=mode!=='layers'||!hasLayers;
    switcher.hidden=!hasFrames;
    for(const [key,button] of buttons)button.setAttribute('aria-pressed',String(mode===key));
  };
  for(const [key,label] of [['layers','Layers'],['pages','Pages']] as const){
    const button=document.createElement('button');button.type='button';button.className='btn btn--ghost btn--sm';
    button.textContent=t(label);button.onclick=()=>{mode=key;applyMode();};buttons.set(key,button);switcher.append(button);
  }
  opts.host.prepend(switcher);opts.heading.hidden=true;
  opts.list.setAttribute('role','region');opts.list.setAttribute('aria-label',t('Document layers'));opts.list.removeAttribute('aria-multiselectable');
  function render(frames:Box[],loose:Box[],nextActive:string):void {
    if(nextActive!==active&&nextActive)expanded.set(nextActive,true);
    active=nextActive;hasFrames=frames.length>0;hasLayers=hasFrames||loose.length>0;
    opts.heading.textContent=t(hasFrames?'Layers':'Loose layers');opts.heading.hidden=hasFrames;
    const known=new Set(frames.map(opts.id));for(const id of expanded.keys())if(!known.has(id))expanded.delete(id);
    opts.list.replaceChildren();
    for(const [index,frame] of frames.entries()) {
      const id=opts.id(frame),children=opts.children(frame).slice().reverse(),name=opts.name(frame,index);
      const group=document.createElement('details');group.className='fc-nav-group';group.dataset.artboard=id;
      group.open=expanded.get(id)??id===active;
      const summary=document.createElement('summary');
      const jump=document.createElement('button');jump.type='button';jump.className='btn btn--ghost fc-nav-group-jump';jump.dataset.jumpArtboard=id;
      jump.textContent=name;jump.title=t('Go to {name}',{name});
      jump.onclick=event=>{event.preventDefault();event.stopPropagation();expanded.set(id,true);group.open=true;paint();opts.jump(id);};
      const count=document.createElement('span');count.className='chip chip--count';count.textContent=String(children.length);count.setAttribute('aria-label',t('{n} layers',{n:children.length}));
      summary.append(jump,count);group.append(summary);
      const list=document.createElement('div');list.className='fc-nav-group-children';list.dataset.layerGroup=id;
      list.setAttribute('role','listbox');list.setAttribute('aria-multiselectable','true');list.setAttribute('aria-label',t('{name} layers',{name}));
      let paintedOpen=group.open;
      const paint=():void=>{paintedOpen=group.open;list.replaceChildren(...(group.open?children.map((box,i)=>opts.row(box,i,false,list)):[]));paintActive(active,chosen);};
      group.addEventListener('toggle',()=>{if(!group.isConnected)return;expanded.set(id,group.open);if(paintedOpen!==group.open)paint();});
      group.append(list);paint();opts.list.append(group);
      summary.addEventListener('keydown',event=>{
        if(event.key==='ArrowRight'){event.preventDefault();event.stopPropagation();group.open=true;paint();list.querySelector<HTMLElement>('[data-nav-row]')?.focus();}
        if(event.key==='ArrowLeft'){event.preventDefault();event.stopPropagation();group.open=false;summary.focus();}
      });
      list.addEventListener('keydown',event=>{if(event.key==='ArrowLeft'&&!event.altKey&&!event.ctrlKey&&!event.metaKey){event.preventDefault();event.stopPropagation();summary.focus();}},true);
    }
    if(loose.length){
      const list=document.createElement('div');list.className='fc-nav-group-children';list.dataset.layerGroup='';list.setAttribute('role','listbox');list.setAttribute('aria-multiselectable','true');list.setAttribute('aria-label',t('Loose layers'));
      if(hasFrames){const label=document.createElement('h3');label.className='fc-nav-subhead';label.textContent=t('Loose layers');opts.list.append(label);}
      list.append(...loose.slice().reverse().map((box,i)=>opts.row(box,i,true,list)));opts.list.append(list);
    }
    applyMode();paintActive(nextActive,[]);
  }
  function paintActive(id:string,selected:string[]):void {
    chosen=selected;
    for(const group of opts.list.querySelectorAll<HTMLElement>('[data-artboard]')){
      const current=group.dataset.artboard===id;group.classList.toggle('is-active-board',current);
      const button=group.querySelector('button')!;if(current)button.setAttribute('aria-current','true');else button.removeAttribute('aria-current');
    }
    for(const list of opts.list.querySelectorAll('[data-layer-group]')){
      const rows=[...list.querySelectorAll<HTMLElement>('[data-nav-row]')];const rover=rows.find(row=>selected.includes(row.dataset.id||''))||rows[0];
      for(const row of rows){row.tabIndex=row===rover?0:-1;const on=selected.includes(row.dataset.id||'');row.classList.toggle('is-active',on);row.setAttribute('aria-selected',String(on));}
    }
  }
  return {render,paintActive};
}
