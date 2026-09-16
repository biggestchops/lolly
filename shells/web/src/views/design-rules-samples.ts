// SPDX-License-Identifier: MPL-2.0
import type { DesignToolDraftV1 } from '@lolly-tools/core/design-tool-v1';
import type { HostV1 } from '@lolly-tools/core/host-v1';
import { mountModal } from '../components/modal.ts';
import { t } from '../i18n.ts';
/** Real sample values exercise the same limits as recipient inputs. */
export function showDesignSamples(draft: DesignToolDraftV1, host: HostV1, apply: (id:string,value:unknown)=>void): void {
  const modal=mountModal('',{className:'modal dr-share',ariaLabel:t('Test input limits')});
  const heading=document.createElement('h2');heading.textContent=t('Test input limits');const note=document.createElement('p');note.textContent=t('Try long content and boundary values in each layout. Reset samples returns to the authored defaults.');
  const body=document.createElement('div');body.className='dr-input-body';
  const add=(parent:HTMLElement,label:string,action:()=>void)=>{const button=document.createElement('button');button.className='btn btn--sm';button.textContent=t(label);button.onclick=action;parent.append(button);};
  for(const field of draft.inputs) {
    const input=field.input;if(!['text','longtext','number','asset'].includes(input.type))continue;
    const row=document.createElement('div');row.className='dr-row-actions';const label=document.createElement('strong');label.textContent=String(input.label||input.id);row.append(label);
    const use=(value:unknown)=>{apply(input.id,value);modal.close();};
    if(input.type==='text'||input.type==='longtext') {
      const max=Math.min(input.maxLength||200,2000);
      add(row,'Long text',()=>use('Alexandra Montgomery-Sutherland '.repeat(Math.ceil(max/32)).slice(0,max)));
      add(row,'Accents and symbols',()=>use('Zoë García · François Müller'.slice(0,max)));
    }
    if(input.type==='number'){add(row,'Minimum',()=>use(input.min));add(row,'Maximum',()=>use(input.max));}
    if(input.type==='asset')add(row,'Try another image',()=>{void host.assets.pick({title:t('Try a portrait or landscape image'),allowUpload:true,types:['raster','vector']}).then(ref=>{if(ref)use(ref);}).catch(error=>{note.textContent=error.message;});});
    body.append(row);
  }
  modal.el.append(heading,note,body);add(modal.el,'Done',()=>modal.close());
}
