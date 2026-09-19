// SPDX-License-Identifier: MPL-2.0
import { isFlagOn, STRIP_UPLOAD_META_FLAG } from '../feature-flags.ts';
import { extractC2paStore } from '../../../../engine/src/c2pa-verify.ts';
import { extractFileMetadata } from '../../../../engine/src/file-metadata.ts';
import type { AssetRef, Profile } from '@lolly-tools/core/host-v1';
import { deepAssetRef } from '../bridge/deep-asset.ts';
interface DeepUploadHost { profile: {get():Promise<Profile>}; assets: { _uploadUserAsset(record:{id:string;type:'raster';format:string;blob:Blob;version:string;width?:number;height?:number;meta:Record<string,unknown>;credential?:Uint8Array;credentialFormat?:string;aiGenerated?:'full'|'partial'}):Promise<unknown>;get(id:string):Promise<AssetRef> } }
export async function tryStoreDeepUpload(host:DeepUploadHost,file:File,asImage=false):Promise<AssetRef|null> {
  const head=new Uint8Array(await file.slice(0,16).arrayBuffer());
  const tiff=(head[0]===73&&head[1]===73)||(head[0]===77&&head[1]===77);
  const exr=head[0]===0x76&&head[1]===0x2f&&head[2]===0x31&&head[3]===1;
  const hdr=head[0]===35&&head[1]===63;
  if(!tiff&&!(asImage&&(exr||hdr)))return null;
  if (isFlagOn(await host.profile.get(),STRIP_UPLOAD_META_FLAG)) throw new Error('Metadata removal is unavailable for HDR originals. Turn off metadata removal to keep the original, or import a converted copy.');
  if(file.size>128*1024*1024)throw new Error('HDR image uploads are limited to 128 MiB.');
  const format=tiff?'tiff':exr?'exr':'hdr',id=`user/upload/${crypto.randomUUID()}-${file.name.replace(/[^a-z0-9.-]/gi,'_')}`;
  const original=URL.createObjectURL(file);
  let display:AssetRef|undefined;
  try {
    display=await deepAssetRef({id,type:'raster',format,source:'user',url:original},file);
    const raw = new Uint8Array(await file.arrayBuffer());
    let source: ReturnType<typeof extractC2paStore> = null;
    let aiGenerated: 'full' | 'partial' | undefined;
    try { source = extractC2paStore(raw); } catch { /* Metadata is optional. */ }
    try { const ai = extractFileMetadata(raw).ai; if (ai) aiGenerated = ai.kind === 'composite' ? 'partial' : 'full'; } catch { /* Keep the validated original. */ }
    await host.assets._uploadUserAsset({...(source ? {credential:source.store,credentialFormat:source.format}:{}),aiGenerated,id,type:'raster',format,blob:file,version:'1.0.0',width:display.width,height:display.height,meta:{name:file.name,size:file.size,deepSource:true}});
    return await host.assets.get(id);
  } finally {URL.revokeObjectURL(original);if(display)URL.revokeObjectURL(display.url);}
}

export async function preparePrecisionUpload(host:DeepUploadHost,file:File,asImage=false):Promise<{file:File;ref:AssetRef|null}> {
  const jxlInput = (await import('../../../../engine/src/jxl.ts')).isJxl(new Uint8Array(await file.slice(0,12).arrayBuffer()));
  if (!jxlInput && (/\.jxl$/i.test(file.name) || file.type === 'image/jxl')) throw new Error('This file is not a valid JPEG XL image.');
  if (jxlInput && file.size > 128*1024*1024) throw new Error('JPEG XL files must be at most 128 MiB.');
  if (jxlInput) file = new File([file], /\.jxl$/i.test(file.name) ? file.name : `${file.name.replace(/\.[^.]+$/, '')}.jxl`, {type:'image/jxl'});
  return {file,ref:await tryStoreDeepUpload(host,file,asImage)};
}
