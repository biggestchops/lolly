// SPDX-License-Identifier: MPL-2.0
/** Replace a plate's display bitmap with original float pixels between its chrome layers. */
import type { HostV1, AssetRef } from '@lolly-tools/core/host-v1';
import { createDeepFrame, type DeepFrame } from '../../../../engine/src/pixels.ts';
import { drawDeep } from '../../../../engine/src/deep-compose.ts';
import { canvasDeep } from './deep-canvas.ts';
export async function imageDeepPlate(box:HTMLElement, image:HTMLImageElement, under:HTMLCanvasElement, over:HTMLCanvasElement|null, host:Pick<HostV1, 'codec'>|null, scale:number, pad=0):Promise<DeepFrame> {
  if(!host?.codec?.decode)throw new Error('Original HDR image decoding is unavailable.');
  const stored=image.getAttribute('data-deep-source');
  const source=await host.codec.decode(stored?JSON.parse(stored) as AssetRef:image.currentSrc||image.src);
  const frame=createDeepFrame(under.width,under.height,'rec2020-linear');drawDeep(frame,{frame:canvasDeep(under)});
  const style=getComputedStyle(image);
  if(style.filter&&style.filter!=='none')throw new Error('HDR image filters are not available yet.');
  const bw=parseFloat(box.style.width)||box.offsetWidth,bh=parseFloat(box.style.height)||box.offsetHeight;
  const iw=image.offsetWidth||bw,ih=image.offsetHeight||bh;
  const fit=style.objectFit,k=fit==='cover'?Math.max(iw/source.width,ih/source.height):fit==='fill'?1:Math.min(iw/source.width,ih/source.height);
  const dw=fit==='fill'?iw:source.width*k,dh=fit==='fill'?ih:source.height*k;
  const position=style.objectPosition.split(/\s+/),positionAt=(value:string|undefined,space:number)=>value?.endsWith('%')?parseFloat(value)/100*space:parseFloat(value||'0');
  const x=image.offsetLeft+positionAt(position[0],iw-dw),y=image.offsetTop+positionAt(position[1]??position[0],ih-dh);
  const origin=style.transformOrigin.split(/\s+/).map(Number.parseFloat),ox=image.offsetLeft+(origin[0]||0),oy=image.offsetTop+(origin[1]||0);
  const transform=new DOMMatrix(style.transform==='none'?undefined:style.transform);
  if(!transform.is2D)throw new Error('HDR image framing requires a two-dimensional transform.');
  const m=new DOMMatrix().scale(scale).translate(pad,pad).translate(ox,oy).multiply(transform).translate(x-ox,y-oy).scale(dw/source.width,dh/source.height);
  // Chrome padding must not reveal image pixels outside the authored frame.
  const mask=new Uint8ClampedArray(frame.width*frame.height);
  for(let py=Math.ceil(pad*scale);py<Math.min(frame.height,(pad+bh)*scale);py++)for(let px=Math.ceil(pad*scale);px<Math.min(frame.width,(pad+bw)*scale);px++)mask[py*frame.width+px]=255;
  drawDeep(frame,{frame:{...source,space:source.space??'srgb-linear'},matrix:[m.a,m.b,m.c,m.d,m.e,m.f],opacity:Number(style.opacity),mask});
  if(over)drawDeep(frame,{frame:canvasDeep(over)});return frame;
}
export function assertDeepLayer(element:HTMLElement):void {
  const style=getComputedStyle(element);
  if(style.filter&&style.filter!=='none')throw new Error('Remove blur and filter effects before HDR export. Their float implementation is not available yet.');
  if(element.querySelector('[data-lolly-scene]'))throw new Error('HDR export of 3D scene boxes is not available yet.');
}

export async function prepareDeepImage(box: HTMLElement, scale: number, options: {pad?:number}, host: Pick<HostV1,'codec'> | null, rasterBox:(box:HTMLElement,scale:number,hide:Element[],options:Record<string,unknown>)=>Promise<HTMLCanvasElement|null>) {
  const image = box.querySelector<HTMLImageElement>('img.lolly-box-img[data-deep-source]')!;
  const under = await rasterBox(box,scale,[image,...box.querySelectorAll('.lolly-box-text')],options);
  const over = await rasterBox(box,scale,[image],{...options,transparentBg:true});
  if (!under) throw new Error('Could not prepare the HDR image layer.');
  return {under,over:null,deep:await imageDeepPlate(box,image,under,over,host,scale,options.pad ?? 0)};
}
export function assertDeepSequence(layers: readonly import('./sequence-plan.ts').SeqLayer[], tilt: unknown): void {
  if (tilt) throw new Error('HDR Sequence export supports flat layers and affine camera moves. Remove perspective tilt before exporting.');
  for (const layer of layers) {
    assertDeepLayer(layer.el);
    if (layer.blur || layer.shadowFilter || layer.kf.some(key => key.v.b !== undefined)) throw new Error('Remove animated blur and depth shadows before HDR export.');
    if (layer.el.querySelector('img[data-deep-source]') && layer.kf.some(key => key.v.w !== undefined || key.v.h !== undefined)) throw new Error('HDR image layers cannot animate their box dimensions yet. Animate scale instead.');
    if (layer.frameScene) throw new Error('Use object clips for HDR Sequence export. Slide scene capture is an SDR path.');
  }
}
export async function sequenceFloatCanvas(width:number,height:number,plates:readonly import('./sequence-render.worker.ts').SeqJobPlate[]) {
  const float = (await import('./deep-canvas.ts')).createFloatCanvas(width,height);
  for (const plate of plates) if (plate.deep && plate.under) float.register(plate.under,plate.deep);
  return float;
}
