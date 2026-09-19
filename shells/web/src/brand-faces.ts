// SPDX-License-Identifier: MPL-2.0
import { swatchFace, tokenColorVar } from '../../../engine/src/color-face.ts';
import type { ColorSwatch } from '@lolly-tools/core/host-v1';
let nextScope=0;
const owned=new WeakMap<HTMLElement,string[]>();
const styles=new WeakMap<HTMLElement,HTMLStyleElement>();
/** Both faces stay available; document state selects the wide face without a display-dependent save. */
export function applyBrandFaces(el:HTMLElement,swatches:readonly ColorSwatch[]):void {
  const scope=el.dataset.brandFaceScope??String(++nextScope);el.dataset.brandFaceScope=scope;
  for (const name of owned.get(el) ?? []) el.style.removeProperty(name);
  const declarations:string[]=[], properties:string[]=[];
  for(const swatch of swatches){
    const names=[tokenColorVar(swatch.ref)];
    const semantic=/^color\.semantic\.([a-z-]+)$/.exec(swatch.path);if(semantic)names.push('--brand-'+semantic[1]);
    for(const name of names){properties.push(name);el.style.setProperty(name,swatch.value);declarations.push(`${name}:${swatchFace(swatch,'rec2020')}`);}
  }
  owned.set(el,properties);
  let style=styles.get(el);
  if(!style){style=el.ownerDocument.createElement('style');style.dataset.brandFaces=scope;styles.set(el,style);}
  style.textContent=`[data-brand-face-scope="${scope}"] [data-editing-range="hdr"], [data-brand-face-scope="${scope}"][data-editing-range="hdr"]{${declarations.join(';')}}`;
  if(!style.isConnected)el.parentElement?.append(style);
}
