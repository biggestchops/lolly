// SPDX-License-Identifier: MPL-2.0
/** Supported typography controls and previews use the document's pinned face. */
import type { TextCharacterV1, TextFontInfoV1 } from '@lolly-tools/core';
import { textControlNumber, destroyTextControls, styleTextControls, textControlRow } from './text-control-ui.ts';
import { t } from '../i18n.ts';
export interface TextTypographyPort {
  read():TextCharacterV1;
  write(value:TextCharacterV1,label:string):void;
  info():Promise<TextFontInfoV1>;
  preview(value:TextCharacterV1):Promise<string>;
  error(error:unknown):void;
}
function featureChoice(current:Record<string,number>|undefined,tag:string,enabled:boolean){const next={...current,[tag]:enabled?1:0};if(enabled)for(const group of [['sups','subs'],['lnum','onum'],['pnum','tnum']])if(group.includes(tag))for(const other of group)if(other!==tag)next[other]=0;return next;}
export function mountTextTypographyControls(root:HTMLElement,port:TextTypographyPort){
  const body=document.createElement('div');body.dataset.textTypography='';root.append(body);
  const updates:Array<()=>void>=[],fontUpdates:Array<()=>void>=[];let font:string|undefined,ticket=0;
  function row(label:string,input:HTMLElement){textControlRow(body,label,input);}
  function number(label:string,key:'tracking'|'baselineShift',min:number,max:number){const field=textControlNumber(body,label,{value:port.read()[key]??0,min,max,step:.1,onCommit:value=>port.write({[key]:value},label)});updates.push(()=>field.set(port.read()[key]??0));}
  number(t('Tracking'),'tracking',-1000,1000);number(t('Baseline shift'),'baselineShift',-1000,1000);
  const strike=document.createElement('input');strike.type='checkbox';strike.addEventListener('change',()=>port.write({strike:strike.checked},t('Strike through')));row(t('Strike through'),strike);updates.push(()=>{strike.checked=!!port.read().strike;});
  const display=document.createElement('select');for(const [value,label] of [['none',t('Original case')],['upper',t('Uppercase')],['lower',t('Lowercase')],['small-caps',t('Small capitals')]])display.add(new Option(label!,value));display.addEventListener('change',()=>port.write({case:display.value as TextCharacterV1['case']},t('Display case')));row(t('Display case'),display);updates.push(()=>{if(document.activeElement!==display)display.value=port.read().case??'none';});
  const fontControls=document.createElement('div');body.append(fontControls);
  async function load(){const started=++ticket;const info=await port.info();if(started!==ticket||!body.isConnected)return; destroyTextControls(fontControls);fontControls.replaceChildren();fontUpdates.length=0;
    display.querySelector<HTMLOptionElement>('[value="small-caps"]')!.disabled=!info.features.includes('smcp');
    const axes=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent=t('Variable font axes');axes.append(legend);
    if(Object.keys(info.axes).length){
      const named=document.createElement('select');named.setAttribute('aria-label',t('Named font instance'));named.add(new Option(t('Custom instance'),''));for(const [index,instance] of (info.instances??[]).entries())named.add(new Option(instance.name,String(index)));
      named.addEventListener('change',()=>{const instance=info.instances?.[Number(named.value)];if(named.value&&instance)port.write({axes:instance.axes},t('Named font instance'));});axes.append(named);fontUpdates.push(()=>{if(document.activeElement===named)return;const current=port.read();const index=info.instances?.findIndex(instance=>Object.entries(info.axes).every(([tag,axis])=>(current.axes?.[tag]??(tag==='wght'?current.weight:undefined)??axis.default)===(instance.axes[tag]??axis.default)))??-1;named.value=index<0?'':String(index);});
      for(const [tag,axis] of Object.entries(info.axes)){
        const label=document.createElement('div');axes.append(label);const slider=document.createElement('input');slider.type='range';slider.min=String(axis.min);slider.max=String(axis.max);slider.step='any';slider.setAttribute('aria-label',`${axis.name} (${tag})`);
        const change=(value:number)=>port.write({axes:{...port.read().axes,[tag]:value}},axis.name);
        const field=textControlNumber(label,`${axis.name} (${tag})`,{value:axis.default,min:axis.min,max:axis.max,step:1,precision:2,onCommit:change,onPreview:value=>{slider.value=String(value);}});
        slider.addEventListener('input',()=>field.set(Number(slider.value)));slider.addEventListener('change',()=>change(Number(slider.value)));label.append(slider);
        const update=()=>{const value=port.read().axes?.[tag]??(tag==='wght'?port.read().weight:undefined)??axis.default;field.set(value);if(document.activeElement!==slider)slider.value=String(value);};fontUpdates.push(update);update();
      }
      const reset=document.createElement('button');reset.type='button';reset.textContent=t('Reset font axes');reset.addEventListener('click',()=>port.write({axes:Object.fromEntries(Object.entries(info.axes).map(([tag,axis])=>[tag,axis.default]))},t('Reset font axes')));axes.append(reset);fontControls.append(axes);
    }
    const features=document.createElement('fieldset'),featuresLabel=document.createElement('legend');featuresLabel.textContent=t('OpenType alternatives');features.append(featuresLabel);fontControls.append(features);
    const names:Record<string,string>={kern:t('Font kerning'),liga:t('Standard ligatures'),dlig:t('Discretionary ligatures'),calt:t('Contextual alternatives'),smcp:t('Small capitals'),c2sc:t('Capitals to small capitals'),lnum:t('Lining numerals'),onum:t('Old-style numerals'),pnum:t('Proportional numerals'),tnum:t('Tabular numerals'),frac:t('Fractions'),sups:t('Superscript'),subs:t('Subscript'),zero:t('Slashed zero')};
    for(const tag of info.features.filter(tag=>names[tag]||/^ss\d\d$|^cv\d\d$/.test(tag))){
      const label=document.createElement('label'),input=document.createElement('input'),preview=document.createElement('div');input.type='checkbox';input.setAttribute('aria-label',names[tag]??tag);label.append(input,document.createTextNode(names[tag]??tag));const feature=document.createElement('div');feature.className='text-control-feature';feature.append(label);features.append(feature,preview);
      input.checked=(port.read().features?.[tag]??(['kern','liga','calt'].includes(tag)?1:0))!==0;
      input.addEventListener('change',()=>port.write({features:featureChoice(port.read().features,tag,input.checked)},names[tag]??tag));
      const button=document.createElement('button');button.type='button';button.textContent=t('Preview');feature.append(button);let previewTicket=0;
      button.addEventListener('click',()=>{const n=++previewTicket;void port.preview({features:featureChoice(port.read().features,tag,!input.checked)}).then(svg=>{if(n===previewTicket&&body.isConnected){preview.innerHTML=svg;const image=preview.querySelector('svg');if(image){image.style.maxWidth='100%';image.style.height='auto';image.setAttribute('aria-label',t('Alternative preview'));}}}).catch(port.error);});
      fontUpdates.push(()=>{if(document.activeElement!==input)input.checked=(port.read().features?.[tag]??(['kern','liga','calt'].includes(tag)?1:0))!==0;});
    }
    styleTextControls(body);
    if(!features.querySelector('input'))features.append(document.createTextNode(t('This font has no optional alternatives.')));
  }
  function refresh(){for(const update of [...updates,...fontUpdates])update();const next=port.read().font??'';if(next!==font){font=next;void load().catch(port.error);}}
  styleTextControls(body);refresh();return {refresh,destroy(){ticket++;destroyTextControls(body);body.remove();}};
}
