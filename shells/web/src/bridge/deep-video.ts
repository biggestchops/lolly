// SPDX-License-Identifier: MPL-2.0
import { decodeVideoPlanes } from '../../../../engine/src/deep-video.ts';
import { DEEP_MAX_BYTES, deepDimensions } from '../../../../engine/src/deep-image.ts';
import { resizeDeep } from '../../../../engine/src/deep-compose.ts';
import type { DeepFrame } from '../../../../engine/src/pixels.ts';
export interface DeepVideoSample { toVideoFrame(): VideoFrame; rotation?: number; displayWidth?: number; displayHeight?: number }
export async function readDeepVideoSample(sample: DeepVideoSample): Promise<DeepFrame> {
  const raw = sample.toVideoFrame();
  try {
    if (!raw.format || !raw.visibleRect) throw new Error('The video decoder did not expose original pixel planes.');
    const rect = raw.visibleRect; deepDimensions(rect.width,rect.height);
    const size = raw.allocationSize({rect});
    if(size>DEEP_MAX_BYTES)throw new Error('Decoded video exceeds the HDR frame budget.');
    const bytes=new Uint8Array(size),layout=await raw.copyTo(bytes,{rect});
    let frame=decodeVideoPlanes({width:rect.width,height:rect.height,format:raw.format,bytes,layout,colorSpace:raw.colorSpace});
    const rotation=sample.rotation??0;
    if(![0,90,180,270].includes(rotation))throw new Error('Unsupported video rotation.');
    if(rotation){
      const swap=rotation%180!==0,w=swap?frame.height:frame.width,h=swap?frame.width:frame.height,data=new Float32Array(frame.data.length);
      for(let y=0;y<frame.height;y++)for(let x=0;x<frame.width;x++){
        const dx=rotation===90?frame.height-1-y:rotation===180?frame.width-1-x:y;
        const dy=rotation===90?x:rotation===180?frame.height-1-y:frame.width-1-x;
        data.set(frame.data.subarray((y*frame.width+x)*4,(y*frame.width+x)*4+4),(dy*w+dx)*4);
      }
      frame={...frame,width:w,height:h,data};
    }
    const width=sample.displayWidth??frame.width,height=sample.displayHeight??frame.height;
    return width!==frame.width||height!==frame.height?resizeDeep(frame,width,height):frame;
  } finally {raw.close();}
}
