// SPDX-License-Identifier: MPL-2.0
import type { AssetRef } from '@lolly-tools/core/host-v1';
import { decodeDeepImage } from '../../../../engine/src/deep-decode.ts';
import { deepPreview } from '../../../../engine/src/deep-image.ts';
import { packPng } from '../../../../engine/src/png.ts';
import { runJxl } from './jxl.ts';
export async function deepAssetRef(ref:AssetRef,blob:Blob,cache?:Map<string,string>,key=''):Promise<AssetRef> {
  let url=cache?.get(key),width=ref.width,height=ref.height;
  if(!url){
    const frame=await decodeDeepImage(new Uint8Array(await blob.arrayBuffer()),{jxl:runJxl,sdr:async()=>{throw new Error('A deep image was expected.');}});
    width=frame.width;height=frame.height;
    const bytes=packPng(deepPreview(frame),{width,height,depth:8});
    url=URL.createObjectURL(new Blob([bytes as BlobPart],{type:'image/png'}));cache?.set(key,url);
  }
  return {...ref,width,height,url,original:{url:ref.url,format:ref.format!},meta:{...ref.meta,displayFormat:'png',displayDepth:8,displayColorSpace:'srgb',deepSource:true}};
}
