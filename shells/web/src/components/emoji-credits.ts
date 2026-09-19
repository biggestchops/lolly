// SPDX-License-Identifier: MPL-2.0
import type { HostV1 } from '@lolly-tools/core/host-v1';
import { t } from '../i18n.ts';
/** Readable credits for the glyphs actually incorporated in the current document. */
export function mountEmojiCredits(container:HTMLElement,host:HostV1,read:()=>string):void {
  const button=document.createElement('button');button.type='button';button.className='btn btn-secondary btn-sm';button.textContent=t('Download emoji credits');
  const status=document.createElement('p');status.className='emoji-style-note';status.setAttribute('role','status');
  button.addEventListener('click',()=>{
    const text=read();if(!text){status.textContent=t('No emoji artwork is used in this document yet.');return;}
    void host.export.download(new Blob([text+'\n'],{type:'text/plain;charset=utf-8'}),'emoji-credits.txt').catch(error=>{status.textContent=String(error instanceof Error?error.message:error);});
  });container.append(button,status);
}
