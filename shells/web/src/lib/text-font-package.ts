// SPDX-License-Identifier: MPL-2.0
/** Generated tools carry verified editable fonts instead of relying on an author's font store. */
import type { TextDocumentV1 } from '@lolly-tools/core';
import type { HostV1 } from '@lolly-tools/core/host-v1';
import { base64ToBytes,bytesToBin,sha256Hex } from '../../../../engine/src/bytes.ts';
import { parseTextDocument } from '../../../../engine/src/text-story-document.ts';
import { readFontEmbedding } from './font-utils.ts';
export async function packageTextFonts(document:TextDocumentV1,host:HostV1,add:(bytes:Uint8Array,extension:string,credit?:string)=>Promise<string>,signal?:AbortSignal):Promise<TextDocumentV1>{
  const copy=parseTextDocument(document);
  for(const font of copy.fonts){
    signal?.throwIfAborted();
    const bytes=font.source.kind==='embedded'?base64ToBytes(font.source.base64):font.source.kind==='asset'?await host.assets.bytes!(await host.assets.get(font.source.id)):await fetch(font.source.path,{signal}).then(async response=>{if(!response.ok)throw new Error(`The text font could not be read: ${font.family}`);return new Uint8Array(await response.arrayBuffer());});
    if(await sha256Hex(bytes)!==font.sha256)throw new Error(`The text font content changed: ${font.family}`);
    const permission=readFontEmbedding(bytes.slice().buffer as ArrayBuffer);
    if(!['installable','editable'].includes(permission.permission)||permission.bitmapOnly)throw new Error(`This font cannot be embedded for editing: ${font.family}`);
    await add(bytes,'ttf',`${font.family}: embedded font for editable composed text.`);font.source={kind:'embedded',base64:btoa(bytesToBin(bytes))};
  }
  signal?.throwIfAborted();return parseTextDocument(copy);
}
