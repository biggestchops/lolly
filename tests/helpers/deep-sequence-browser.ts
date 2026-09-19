// SPDX-License-Identifier: MPL-2.0
import { Input, BlobSource, ALL_FORMATS, VideoSampleSink } from 'mediabunny';
import { pickWebCodecsVideo, is10bitHdrCodec, HDR_VF_COLORSPACE } from '../../shells/web/src/bridge/video-shared.ts';
import { createStreamingMux } from '../../shells/web/src/bridge/video-encode-core.ts';
import { renderSequence } from '../../shells/web/src/bridge/sequence-render.ts';
import { readDeepVideoSample } from '../../shells/web/src/bridge/deep-video.ts';
import { pqToI420P10, pqEncodeFrame } from '../../engine/src/hdr.ts';

export async function sequenceHdrRoundtrip() {
  const width=64,height=32,fps=24,bitrate=2_000_000;
  const pick=await pickWebCodecsVideo('webm',width,height,fps,bitrate,undefined,true);
  if (!pick || !is10bitHdrCodec(pick.codec)) throw new Error('This browser has no 10-bit test encoder.');
  const mux=await createStreamingMux(pick,{width,height,fps,bitrate,colorSpace:HDR_VF_COLORSPACE,frameFormat:'I420P10'});
  for(let n=0;n<24;n++) {
    const data=Float32Array.from({length:width*height*4},(_,i)=>i%4===3?1:(n<12?100:1000)/203);
    const frame={width,height,data,space:'rec2020-linear' as const};
    await mux.addFrame({data:pqToI420P10(pqEncodeFrame(frame)).data.slice().buffer},Math.round(n/fps*1e6));
  }
  const source=await mux.finalize(),url=URL.createObjectURL(source);
  const stage=document.createElement('div');stage.className='artboard';stage.style.cssText=`width:${width}px;height:${height}px;position:relative;overflow:hidden;background:#000`;
  stage.dataset.sequence='';stage.dataset.seqMs='500';stage.dataset.seqFps=String(fps);
  const box=document.createElement('div');box.className='lolly-box';box.style.cssText='position:absolute;left:0;top:0;width:64px;height:32px;overflow:hidden';
  box.dataset.tStart='0';box.dataset.tDur='500';box.dataset.clipIn='500';
  const video=document.createElement('video');video.src=url;video.muted=true;video.style.cssText='width:100%;height:100%;object-fit:fill';box.append(video);stage.append(box);document.body.append(stage);
  try {
    const output=await renderSequence(stage,'webm',{fps,hdr:true,sourceDocument:{toolId:'design',values:{editingRange:'hdr'}}});
    const input=new Input({formats:ALL_FORMATS,source:new BlobSource(output)});
    try {
      const track=await input.getPrimaryVideoTrack();if(!track)throw new Error('Missing HDR video track.');
      const sink=new VideoSampleSink(track),sample=await sink.getSample(.25);if(!sample)throw new Error('Missing trimmed HDR frame.');
      try {const decoded=await readDeepVideoSample(sample);return {nits:decoded.data[(16*64+32)*4]!*203,bytes:output.size,codec:pick.codec,duration:await input.computeDuration()};}
      finally {sample.close();}
    } finally {input.dispose();}
  } finally {stage.remove();video.src='';URL.revokeObjectURL(url);}
}
