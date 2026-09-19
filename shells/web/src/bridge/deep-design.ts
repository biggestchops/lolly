// SPDX-License-Identifier: MPL-2.0
/** Flat Design stills share Sequence's plate preparation and float compositor. */
import type { HostV1, CodecFrame } from '@lolly-tools/core/host-v1';
import { exportDims, type ExportOpts } from './export-shared.ts';
import { toPixels } from '../../../../engine/src/units.ts';
import { createFloatCanvas } from './deep-canvas.ts';
import { assertDeepLayer, imageDeepPlate } from './deep-plate.ts';
export async function renderDeepDesign(node:Element,opts:ExportOpts,host:HostV1):Promise<CodecFrame> {
  const pages=node.querySelectorAll('[data-pdf-page]');
  if(pages.length>1)throw new Error('Export one artboard at a time in HDR.');
  const stage=(node.matches('.artboard,[data-pdf-page]')?node:node.querySelector('.artboard,[data-pdf-page]')) as HTMLElement|null;
  if(!stage)throw new Error('HDR Design needs an artboard.');
  if(stage.querySelector('video'))throw new Error('Use Sequence export for HDR video clips.');
  const {rasterBox, radiiOf}=await import('./sequence-render.ts');
  const dims=exportDims(stage,opts),width=Math.round(toPixels(dims.w,dims.dpi)),height=Math.round(toPixels(dims.h,dims.dpi));
  const nativeW=stage.offsetWidth||parseFloat(stage.style.width),nativeH=stage.offsetHeight||parseFloat(stage.style.height);
  const sx=width/nativeW,sy=height/nativeH;
  if(!Number.isFinite(sx)||!Number.isFinite(sy)||Math.abs(sx-sy)>.001)throw new Error('HDR Design export must retain the artboard aspect ratio.');
  const float=createFloatCanvas(width,height),ctx=float.context;
  const boxes=Array.from(stage.querySelectorAll<HTMLElement>('.lolly-box')).filter(box=>!box.closest('[data-export-hide]'));
  const background=await rasterBox(stage,sx,boxes,{wideColor:true});
  if(!background)throw new Error('Could not render the HDR artboard background.');
  ctx.drawImage(background,0,0,width,height);
  for(const box of boxes){
    assertDeepLayer(box);
    const style=getComputedStyle(box);if(style.display==='none'||style.visibility==='hidden')continue;
    const matrix=new DOMMatrix(style.transform==='none'?undefined:style.transform);
    if(!matrix.is2D)throw new Error('HDR Design export does not yet support perspective transforms.');
    const image=box.querySelector<HTMLImageElement>('img.lolly-box-img[data-deep-source]');
    const under=await rasterBox(box,sx,image?[image,...box.querySelectorAll('.lolly-box-text')]:[],{opaque:true,wideColor:true});
    if(!under)throw new Error('Could not render an HDR layer.');
    if(image){
      const over=await rasterBox(box,sx,[image],{opaque:true,transparentBg:true,wideColor:true});
      float.register(under,await imageDeepPlate(box,image,under,over,host,sx));
    }
    const origin=style.transformOrigin.split(/\s+/).map(Number.parseFloat),ox=origin[0]||0,oy=origin[1]||0;
    const m=new DOMMatrix().scale(sx).translate(box.offsetLeft+ox,box.offsetTop+oy).multiply(matrix).translate(-ox,-oy).scale(1/sx);
    ctx.save();ctx.setTransform(m);ctx.globalAlpha=Number(style.opacity);ctx.globalCompositeOperation=(style.mixBlendMode==='normal'?'source-over':style.mixBlendMode) as GlobalCompositeOperation;
    if(style.clipPath!=='none'||style.borderRadius!=='0px'){
      if(style.clipPath!=='none')throw new Error('Remove clip paths for HDR still export; Sequence supports them.');
      const p=new Path2D();p.roundRect(0,0,under.width,under.height,radiiOf(style.borderRadius,under.width/sx,under.height/sx).map(r=>r*sx));ctx.clip(p);
    }
    ctx.drawImage(under,0,0);ctx.restore();
  }
  return {...float.frame,space:'rec2020-linear'};
}
