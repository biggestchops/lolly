// SPDX-License-Identifier: MPL-2.0
/** Canvas geometry and coverage with linear float colour storage. */
import { createDeepFrame, fromU8Srgb, type DeepFrame } from '../../../../engine/src/pixels.ts';
import { drawDeep, type DeepMatrix } from '../../../../engine/src/deep-compose.ts';
import { deepDimensions } from '../../../../engine/src/deep-image.ts';
import { readDeepVideoSample, type DeepVideoSample } from './deep-video.ts';
export interface FloatCanvas {
  frame: DeepFrame;
  context: OffscreenCanvasRenderingContext2D;
  register(source: CanvasImageSource, frame: DeepFrame): void;
}
export function canvasDeep(source: CanvasImageSource): DeepFrame {
  const value=source as {width?:number;height?:number;naturalWidth?:number;naturalHeight?:number};
  const width=value.naturalWidth||value.width||0,height=value.naturalHeight||value.height||0;deepDimensions(width,height);
  const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d',{colorSpace:'display-p3',willReadFrequently:true});
  if(!ctx)throw new Error('Float image compositing is unavailable.');
  ctx.drawImage(source,0,0);
  const image=ctx.getImageData(0,0,width,height,{colorSpace:'display-p3'});
  return {...fromU8Srgb(image.data,width,height),space:image.colorSpace==='display-p3'?'display-p3-linear':'srgb-linear'};
}
export function createFloatCanvas(width:number,height:number):FloatCanvas {
  deepDimensions(width,height);
  const frame=createDeepFrame(width,height,'rec2020-linear'),canvas=new OffscreenCanvas(width,height),native=canvas.getContext('2d',{willReadFrequently:true})!;
  if(!native)throw new Error('Float coverage rendering is unavailable.');
  const sources=new WeakMap<object,DeepFrame>();
  const cache=new Map<object,DeepFrame>();
  let held = 0, cached = 0;
  function register(source: CanvasImageSource, pixels: DeepFrame): void {
    held -= sources.get(source)?.data.byteLength ?? 0;
    held += pixels.data.byteLength;
    if (held > 256*1024*1024) throw new Error('HDR layers exceed the 256 MiB float plate budget. Reduce their resolution.');
    sources.set(source,pixels);
    trimCache();
  }
  function trimCache(): void {
    while (held+cached > 256*1024*1024 && cache.size) {
      const key=cache.keys().next().value!; cached-=cache.get(key)!.data.byteLength;cache.delete(key);
    }
  }
  function pixelsFor(source:CanvasImageSource):DeepFrame {
    let pixels=sources.get(source)??cache.get(source);
    if (!pixels) {
      pixels=canvasDeep(source);
      if (held+pixels.data.byteLength > 256*1024*1024) throw new Error('HDR frame and fixed layers exceed the float plate budget.');
      cached+=pixels.data.byteLength;trimCache();cache.set(source,pixels);
    }
    return pixels;
  }
  let clipped=false;const states:boolean[]=[];
  const empty=new ImageData(width,height);
  function draw(source:DeepFrame,args:number[]):void {
    let sx=0,sy=0,sw=source.width,sh=source.height,dx=0,dy=0,dw=sw,dh=sh;
    if(args.length===2){[dx,dy]=args as [number,number];}
    else if(args.length===4){[dx,dy,dw,dh]=args as [number,number,number,number];}
    else if(args.length===8){[sx,sy,sw,sh,dx,dy,dw,dh]=args as [number,number,number,number,number,number,number,number];}
    else throw new Error('Invalid float image rectangle.');
    if(sw<=0||sh<=0||dw<=0||dh<=0)return;
    const m=native.getTransform().translate(dx,dy).scale(dw/sw,dh/sh).translate(-sx,-sy);
    let mask:Uint8ClampedArray|undefined;
    if(clipped||args.length===8){
      native.save();native.globalAlpha=1;native.globalCompositeOperation='source-over';native.fillStyle='#fff';
      native.putImageData(empty,0,0);native.fillRect(dx,dy,dw,dh);native.restore();
      const coverage=native.getImageData(0,0,width,height).data;mask=new Uint8ClampedArray(width*height);
      for(let p=0;p<mask.length;p++)mask[p]=coverage[p*4+3]!;
    }
    drawDeep(frame,{frame:source,matrix:[m.a,m.b,m.c,m.d,m.e,m.f] as DeepMatrix,opacity:native.globalAlpha,blend:native.globalCompositeOperation,mask});
  }
  const methods:Record<string,unknown>={
    save(){states.push(clipped);native.save();},restore(){native.restore();clipped=states.pop()??false;},
    clip(...args:unknown[]){(native.clip as (...a:unknown[])=>void)(...args);clipped=true;},
    clearRect(x:number,y:number,w:number,h:number){
      if(x!==0||y!==0||w!==width||h!==height)throw new Error('Float rendering only clears whole frames.');
      frame.data.fill(0);native.clearRect(x,y,w,h);
    },
    drawImage(source:CanvasImageSource,...args:number[]){
      draw(pixelsFor(source),args);
    },
    async drawDeepSample(sample:DeepVideoSample,dx:number,dy:number,dw:number,dh:number){draw(await readDeepVideoSample(sample),[dx,dy,dw,dh]);},
  };
  const context=new Proxy(native,{has(target,key){return typeof key==='string'&&key in methods||Reflect.has(target,key);},get(target,key){if(typeof key==='string'&&key in methods)return methods[key];const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;},set(target,key,value){return Reflect.set(target,key,value,target);}});
  return {frame,context,register};
}

export async function displayFloatFrame(frame:DeepFrame,canvas:HTMLCanvasElement|OffscreenCanvas):Promise<void> {
  const { deepPreview } = await import('../../../../engine/src/deep-image.ts');
  const display=canvas.getContext('2d') as CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D;
  display.putImageData(new ImageData(new Uint8ClampedArray(deepPreview(frame)),frame.width,frame.height),0,0);
}
