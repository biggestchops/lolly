// SPDX-License-Identifier: MPL-2.0
import type { UserFontsHost } from '../user-fonts.ts';
import type { HostV1 } from '@lolly-tools/core/host-v1';
import type { DesignToolDraftV1, ArtboardVariantV1 } from '@lolly-tools/core/design-tool-v1';
import type { Runtime } from '../../../../engine/src/runtime.ts';
import type { DesignCanvasPorts } from './design-ports.ts';
import type { Box } from './free-canvas-math.ts';
import { mountModal } from '../components/modal.ts';
import { getDesignToolSource, rememberDesignToolSource, setRulesSourcePages } from '../lib/design-tool-source.ts';
import { designLinkedObjects, suggestDesignRebind, rebindDesignTool } from '../lib/design-tool-rebind.ts';
import { chooseRulesPages } from './design-rules-pages.ts';
import { openPdfFile } from './pdf-import.ts';
import { parseDesignArtboards } from './design-import.ts';
import { t } from '../i18n.ts';

function canInstallFonts(host:HostV1): host is HostV1 & UserFontsHost { return ['_uploadUserAsset','_deleteUserAsset','_exportUserAssets','_getBlob'].every(key=>typeof Reflect.get(host.assets,key)==='function'); }
function button(text: string, action:()=>void): HTMLButtonElement {const b=document.createElement('button');b.className='btn';b.textContent=t(text);b.onclick=action;return b;}
function select(label: string, options: Array<[string,string]>, change:(value:string)=>void): HTMLLabelElement {
  const wrapper=document.createElement('label');wrapper.className='dr-field';wrapper.append(document.createTextNode(label));const control=document.createElement('select');control.className='field-select';
  for(const [value,text] of options){const option=document.createElement('option');option.value=value;option.textContent=text;control.append(option);} control.onchange=()=>change(control.value);wrapper.append(control);return wrapper;
}
export function createRulesRecovery(opts:{runtime:Runtime;host:HostV1;canvas:HTMLElement;ports:DesignCanvasPorts;draft():DesignToolDraftV1;commit(boxes:Box[],draft:DesignToolDraftV1):void;status(message:string):void;sourceChanged():void}) {
  const currentThumb = (variant: ArtboardVariantV1, width=420): HTMLElement => {
    const frame=opts.ports.model.getBoxes().find(b=>b.id===variant.id) || {id:'',x:0,y:0,w:variant.width,h:variant.height};
    return opts.ports.thumb(frame,width,width*variant.height/variant.width);
  };
  const compare = async (): Promise<void> => {
    const source=getDesignToolSource(opts.runtime);if(!source)return;
    const resizeEvents=new AbortController();
    const modal=mountModal('',{className:'modal dr-source',ariaLabel:t('Compare source and Design'),onClose:()=>resizeEvents.abort()});
    const heading=document.createElement('h2');heading.textContent=t('Compare source and Design');
    const note=document.createElement('p');note.textContent=t('Both views use the same page size and zoom. The source preview is reconstructed from the PDF; open the original for a final fidelity check.');
    const grid=document.createElement('div');grid.className='dr-compare';
    const zoom=document.createElement('input');zoom.type='range';zoom.className='field-range';zoom.min='100';zoom.max='300';zoom.value='100';zoom.setAttribute('aria-label',t('Comparison zoom'));
    const original=button('Open original file',()=>{void fetch(source.data).then(r=>r.blob()).then(blob=>opts.host.export.download(blob,source.name)).catch(error=>{note.textContent=error.message;});});
    modal.el.append(heading,note);
    const notes=document.createElement('div');
    const fixed=source.findings?.filter(f=>f.kind==='fixed').length || 0;
    if(fixed){const info=document.createElement('p');info.textContent=t('{n} objects retain clipping or effects as images. Replace their complete artwork to change their shape.',{n:fixed});notes.append(info);}
    for(const finding of source.findings?.filter(f=>f.kind==='review') || []) {
      const row=document.createElement('div');row.className='dr-issue';const text=document.createElement('p');text.textContent=`${t('Page {n}',{n:finding.page+1})}${finding.object?' · '+finding.object:''}: ${finding.message}`;row.append(text);
      if(finding.object)row.append(button('Review object',()=>{const at=source.pages?.indexOf(finding.page)??finding.page;const variant=opts.draft().variants[at];const ids=variant?.boxes.filter(b=>b.name===finding.object||b.text===finding.object).map(b=>String(b.id))||[];opts.ports.selection.set(ids);modal.close();opts.status(finding.message);}));notes.append(row);
    }
    modal.el.append(notes);
    if(!source.data) {
      note.textContent=t('This source is too large to keep a preview in the master. Open the original in its authoring app and review these notes before sharing.');
      modal.el.append(button('Mark source reviewed',()=>{source.reviewed=true;opts.sourceChanged();modal.close();}));return;
    }
    const handle=await openPdfFile(await fetch(source.data).then(r=>r.blob()));
    if(!modal.el.isConnected)return;
    const draft=opts.draft();let index=Math.max(0,draft.variants.findIndex(v=>v.id===opts.ports.artboard.active()));
    const paint=async()=>{
      const at=index;const variant=draft.variants[at]!;grid.replaceChildren();
      const panes=['Source PDF','Design'].map(label=>{const figure=document.createElement('figure');const cap=document.createElement('figcaption');cap.textContent=t(label);const view=document.createElement('div');view.className='dr-compare-page';figure.append(cap,view);grid.append(figure);return view;});
      const width=Math.max(1,Math.min(...panes.map(pane=>Math.min(pane.clientWidth,pane.clientHeight*variant.width/variant.height))))*Number(zoom.value)/100;
      const thumb=currentThumb(variant,width);panes[1]!.append(thumb);
      let syncing=false;
      for(const [a,b] of [[panes[0]!,panes[1]!],[panes[1]!,panes[0]!]] as Array<[HTMLElement,HTMLElement]>) a.onscroll=()=>{if(syncing)return;syncing=true;b.scrollLeft=a.scrollLeft;b.scrollTop=a.scrollTop;requestAnimationFrame(()=>{syncing=false;});};
      const page=await handle.pageToSvg(source.pages?.[at] ?? Math.min(at,handle.pageCount-1));
      if(!modal.el.isConnected||index!==at)return;
      const image=document.createElement('img');image.alt=t('Original page');image.src=`data:image/svg+xml;charset=utf-8,${encodeURIComponent(page.svg)}`;image.style.width=`${width}px`;image.style.maxWidth='none';panes[0]!.append(image);
    };
    const picker=select(t('Artboard'),draft.variants.map((v,i)=>[String(i),v.label]),value=>{index=Number(value);void paint().catch(error=>{note.textContent=error.message;});});picker.querySelector('select')!.value=String(index);
    const failure=(error:Error)=>{note.textContent=error.message;};
    zoom.oninput=()=>{void paint().catch(failure);};
    const done=button(source.findings?.some(f=>f.kind==='review')&&!source.reviewed?'Mark source reviewed':'Done',()=>{source.reviewed=true;opts.sourceChanged();modal.close();});done.classList.add('btn--primary');
    modal.el.append(picker,zoom,grid,original,done);
    window.addEventListener('resize',()=>{void paint().catch(failure);},{signal:resizeEvents.signal});
    await paint().catch(failure);
  };
  const fonts = (layerId?:string, designSystem=false): void => {
    const draft=structuredClone(opts.draft());const selected=layerId ? [layerId] : opts.ports.selection.get();
    const boxes=opts.ports.model.getBoxes();const texts=boxes.filter(b=>(b.kind==='text'||b.text) && (designSystem||!selected.length||selected.includes(String(b.id))));
    const families=[...new Set(texts.map(b=>String(b.font||'sans')))];
    const title=designSystem?'Apply design system':'Review fonts';
    const resizeEvents=new AbortController();
    const modal=mountModal('',{className:'modal dr-source',ariaLabel:t(title),onClose:()=>resizeEvents.abort()});const h=document.createElement('h2');h.textContent=t(title);
    const body=document.createElement('div');body.className='dr-input-body';const message=document.createElement('p');message.setAttribute('role','status');
    const preview=document.createElement('div');preview.className='dr-compare-page';
    const choices=new Map(families.map(f=>[f,designSystem?'sans':f]));
    const colours=new Map<string,string>();
    const variant=draft.variants.find(v=>v.boxes.some(b=>b.id===texts[0]?.id)) || draft.variants[0]!;
    const paint=()=>{preview.replaceChildren(currentThumb(variant,Math.max(1,Math.min(preview.clientWidth,preview.clientHeight*variant.width/variant.height))));for(const el of preview.querySelectorAll<HTMLElement>('[data-box-id] .lolly-box-text')) {const box=texts.find(b=>b.id===el.closest<HTMLElement>('[data-box-id]')?.dataset.boxId);if(!box)continue;const font=choices.get(String(box.font||'sans'));el.style.fontFamily=font==='sans'?'var(--font-brand)':font==='mono'?'var(--font-mono)':font!;} for(const el of preview.querySelectorAll<HTMLElement>('[data-box-id]')) {const b=boxes.find(b=>b.id===el.dataset.boxId);if(!b)continue;const fg=colours.get(String(b.fg)),bg=colours.get(String(b.bg)),fill=colours.get(String(b.fill));if(fg){const text=el.querySelector<HTMLElement>('.lolly-box-text');if(text)text.style.color=fg;}if(bg)el.style.background=bg;if(fill)for(const path of el.querySelectorAll('path'))path.setAttribute('fill',fill);} };
    let uploadFamily=families[0] || '';
    const addedFonts=new Map<string,string>();
    const controls=()=>{body.replaceChildren();for(const family of families){const options=opts.ports.fonts.options();for(const name of addedFonts.keys())if(!options.some(([id])=>id===name))options.push([name,name]);if(!options.some(([id])=>id===family))options.unshift([family,`${family} (${t('source')})`]);const field=select(family,options,value=>{choices.set(family,value);paint();});field.querySelector('select')!.value=choices.get(family)!;body.append(field,button(t('Add font for {name}',{name:family}),()=>{uploadFamily=family;upload.click();}));}};
    const upload=document.createElement('input');upload.type='file';upload.accept='.ttf,.otf,.woff,.woff2';upload.hidden=true;
    upload.onchange=()=>{const file=upload.files?.[0];if(!file)return;void(async()=>{const {installFontFromBytes}=await import('../user-fonts.ts');if(!canInstallFonts(opts.host))throw new Error(t('Font upload is unavailable in this shell. Choose an installed font.'));const installed=await installFontFromBytes(opts.host,await file.arrayBuffer(),{filename:file.name,makePrimary:false});if(!installed)throw new Error(t('This font file could not be installed. Use a complete TTF, OTF or WOFF file.'));addedFonts.set(installed.family,installed.family);choices.set(uploadFamily,installed.family);controls();paint();message.textContent=t('Font installed. Review the artwork before applying.');})().catch(error=>{message.textContent=error.message;});};
    const apply=button(selected.length?'Apply to selected text':'Apply to all text',()=>{
      const mapped=(b:Box):Box=>{const next={...b};if(texts.some(text=>text.id===b.id))next.font=choices.get(String(b.font||'sans'));for(const key of ['fg','bg','fill'])if(colours.has(String(b[key])))next[key]=colours.get(String(b[key]));return next;};
      const next=boxes.map(mapped);
      for(const v of draft.variants)v.boxes=v.boxes.map(b=>mapped(b as Box));
      opts.commit(next,draft);modal.close();
    });apply.classList.add('btn--primary');if(designSystem)apply.textContent=t('Apply reviewed design system');
    const note=document.createElement('p');note.textContent=t('Choose a replacement for each source family or add its complete font file. Embedded PDF subsets cannot supply arbitrary new text. Review the artwork before applying.');
    modal.el.append(h,note,body,upload,preview,message,button('Cancel',()=>modal.close()),apply);controls();paint();
    window.addEventListener('resize',paint,{signal:resizeEvents.signal});
    if(designSystem) {
      const section=document.createElement('details');section.className='dr-advanced';const title=document.createElement('summary');title.textContent=t('Map colours to design system tokens');section.append(title);body.after(section);
      void opts.host.tokens?.colors().then(palette=>{
        if(!modal.el.isConnected)return;
        const source=[...new Set(boxes.flatMap(b=>['fg','bg','fill'].map(key=>String(b[key]||'')).filter(value=>/^#[a-f\d]{3,8}$/i.test(value))))];
        for(const value of source)section.append(select(value,[['',t('Keep source colour')],...palette.map((token):[string,string]=>[token.value,token.name||token.path])],next=>{if(next)colours.set(value,next);else colours.delete(value);paint();}));
      }).catch(error=>{message.textContent=error.message;});
    }
  };
  const replace = (): void => {
    const input=document.createElement('input');input.type='file';input.accept='.pdf,.ai';
    input.onchange=()=>{const file=input.files?.[0];if(file)void replacement(file).catch(error=>opts.status(error.message));};input.click();
  };
  const replacement = async(file:File):Promise<void> => {
    const pages=await chooseRulesPages(file);
    const result=await parseDesignArtboards(file,{host:opts.host,pages,map:{fonts:{preserveSource:true}}});
    const old=structuredClone(opts.draft());
    const sourceHandle=await openPdfFile(file);
    if(result.frames.length!==old.variants.length)throw new Error(t('Choose {n} replacement pages so each existing artboard can be reviewed.',{n:old.variants.length}));
    const modal=mountModal('',{className:'modal dr-source',ariaLabel:t('Review replacement artwork')});const h=document.createElement('h2');h.textContent=t('Review replacement artwork');
    const note=document.createElement('p');note.textContent=t('Confirm each artboard and linked object. Suggestions use unique names or matching text. The existing artwork stays in place until you apply.');
    const rows=document.createElement('div');rows.className='dr-input-body';const status=document.createElement('p');status.setAttribute('role','status');
    const order=old.variants.map((_,i)=>i);let variants:ArtboardVariantV1[]=[];let mapping:Record<string,string>={};
    const paint=()=>{
      rows.replaceChildren();mapping={};variants=old.variants.map((v,i)=>{const frame=result.frames[order[i]!]!;return {id:v.id,label:v.label,width:frame.width,height:frame.height,background:frame.background||result.background||'#fff',boxes:(frame.boxes as Box[]).map(b=>({...b,id:`new-${i}-${b.id}`}))};});
      old.variants.forEach((v,i)=>{const artboard=select(v.label,result.frames.map((f,n)=>[String(n),f.name]),value=>{order[i]=Number(value);paint();});artboard.querySelector('select')!.value=String(order[i]);rows.append(artboard);
        const comparison=document.createElement('details');comparison.className='dr-advanced';const summary=document.createElement('summary');summary.textContent=t('Compare artwork');comparison.append(summary);rows.append(comparison);
        comparison.addEventListener('toggle',()=>{if(!comparison.open||comparison.childElementCount>1)return;const pair=document.createElement('div');pair.className='dr-compare';pair.append(currentThumb(v,320));const image=document.createElement('img');image.alt=t('Replacement artwork');image.style.width='320px';image.style.maxWidth='100%';pair.append(image);comparison.append(pair);void sourceHandle.pageToSvg(pages?.[order[i]!]??order[i]!).then(page=>{image.src=`data:image/svg+xml;charset=utf-8,${encodeURIComponent(page.svg)}`;}).catch(error=>{status.textContent=error.message;});});
        for(const ref of designLinkedObjects(old).filter(r=>r.variantId===v.id)) {
          const box=v.boxes.find(b=>b.id===ref.layerId);const candidates=variants[i]!.boxes.filter(b=>!box||b.kind===box.kind);const key=`${v.id}/${ref.layerId}`;
          const proposed=box?suggestDesignRebind(box,candidates):undefined;if(proposed)mapping[key]=proposed;
          const field=select(String(box?.name||box?.text||t('Removed object')),[['',t('Choose replacement')],...candidates.map((b):[string,string]=>[String(b.id),String(b.name||b.text||b.kind)])],value=>{mapping[key]=value;});field.querySelector('select')!.value=proposed||'';rows.append(field);
        }
      });
    };
    const apply=button('Apply reviewed replacement',()=>{void(async()=>{
      if(new Set(order).size!==order.length)throw new Error(t('Choose a different source page for each artboard.'));
      const next=rebindDesignTool(old,variants,mapping);const boxes:Box[]=[];let x=0;
      for(const [i,v] of next.variants.entries()) {const before=opts.ports.model.getBoxes().find(b=>b.id===v.id);const frame={...before,id:v.id,kind:'frame',name:v.label,x,y:0,w:v.width,h:v.height,bg:v.background,order:i};boxes.push(frame);for(const b of v.boxes)boxes.push({...b,x:Number(b.x||0)+x,frame:v.id} as Box);x+=v.width+80;}
      if(pages)setRulesSourcePages(file,order.map(index=>pages[index]!));
      await rememberDesignToolSource(opts.runtime,file);opts.commit(boxes,next);modal.close();opts.status(t('Source replaced. Review text fitting and Preview before sharing.'));
    })().catch(error=>{status.textContent=error.message;});});apply.classList.add('btn--primary');
    modal.el.append(h,note,rows,status,button('Cancel',()=>modal.close()),apply);paint();
  };
  const image=(layerId:string):void=>{void opts.host.assets.pick({title:t('Replace source image'),allowUpload:true,types:['raster','vector']}).then(ref=>{if(!ref)return;const draft=structuredClone(opts.draft());for(const v of draft.variants)for(const b of v.boxes)if(b.id===layerId)b.image=ref;for(const f of draft.inputs)if(f.targets.some(target=>target.layerId===layerId&&target.property==='image'))f.input.default=ref;opts.commit(opts.ports.model.getBoxes().map(b=>b.id===layerId?{...b,image:ref}:b),draft);}).catch(error=>opts.status(error.message));};
  return {compare,fonts,replace,image};
}
