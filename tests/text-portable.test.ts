// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { TextDocumentV1 } from '@lolly-tools/core';
import { JSDOM } from 'jsdom';
import { createTextStory } from '../engine/src/text-story-document.ts';
import { defaultTextFrameSettings } from '../engine/src/text-design.ts';
import { encodeAssetVersion,decodeAssetVersion } from '../engine/src/asset-version.ts';
import { textFontAssetIds,mapTextFontAssets } from '../engine/src/text-assets.ts';
import { createTextCompositionAPI } from '../packages/node-shell/src/text-composition.ts';
import { collectSessionAssetRefs,rewriteSessionAssetRefs,type BeamAssetRecord,type BeamPackHost } from '../shells/web/src/lib/beam-pack.ts';
import { buildLollyFile,ingestLollyFile } from '../shells/web/src/lib/lolly-pack.ts';
import { collectAssetRefs } from '../shells/web/src/bridge/asset-ref-collector.ts';
import { createFsStateAPI } from '../shells/tauri-shared/bridge-overrides/state-fs.ts';
const bytes=await readFile('shells/web/public/fonts/SUSE[wght].ttf'),hash=createHash('sha256').update(bytes).digest('hex'),id='user/fonts/authored.ttf',pinned=encodeAssetVersion(id,{version:hash,format:'ttf'});
const story=createTextStory('story','Office élan\u00a0copy\r\nLiteral **source**',i=>`p${i}`);story.frameIds=['frame'];story.paragraphs.forEach(paragraph=>{paragraph.paragraph={character:{font:'font',size:24,weight:400}};});
const doc:TextDocumentV1={version:1,stories:[story],styles:[],fonts:[{id:'font',family:'SUSE',sha256:hash,faceIndex:0,source:{kind:'asset',id:pinned}}]};
const session={__toolId:'design',textDocument:JSON.stringify(doc),boxes:[{id:'frame',kind:'text',textStory:'story',text:'',textFrame:JSON.stringify(defaultTextFrameSettings()),w:500,h:200}]};
test('Tauri saved sessions retain the exact composed font version until the session is deleted',async()=>{
  const files=new Map<string,string>(),directories=new Set<string>();
  const state=createFsStateAPI({
    exists:async path=>files.has(path)||directories.has(path),mkdirRecursive:async path=>{directories.add(path);},
    readTextFile:async path=>{const value=files.get(path);if(value===undefined)throw new Error('Missing file');return value;},
    writeTextFile:async(path,value)=>{files.set(path,value);},remove:async path=>{files.delete(path);},
    readDirNames:async path=>[...files.keys()].filter(file=>file.startsWith(`${path}/`)).map(file=>file.slice(path.length+1)),
  });
  await state.save('article',session);
  assert.deepEqual([...await state._getAssetRefs()],[`${id}:ttf:${hash}`]);
  await state.delete('article');assert.deepEqual([...await state._getAssetRefs()],[]);
});
test('serialized font refs travel and rekey without rewriting text, font identity or version pins',()=>{
  assert.deepEqual(textFontAssetIds(session.textDocument),[pinned]);assert.deepEqual(collectSessionAssetRefs(session),{user:[pinned],library:[]});
  const refs=new Set<string>();collectAssetRefs(session,refs);assert.deepEqual([...refs],[`${id}:ttf:${hash}`]);
  const changed=rewriteSessionAssetRefs(session,new Map([[pinned,'user/received/font']]));assert.equal(changed.rewritten,1);assert.deepEqual(changed.unresolved,[]);
  const document=JSON.parse(changed.data.textDocument) as TextDocumentV1;assert.deepEqual(document.stories,doc.stories);assert.equal(document.fonts[0]!.sha256,hash);assert.deepEqual(decodeAssetVersion((document.fonts[0]!.source as {id:string}).id),{id:'user/received/font',pin:{version:hash,format:'ttf'}});
  assert.equal(rewriteSessionAssetRefs(session,new Map()).unresolved[0],pinned);assert.equal(session.textDocument,JSON.stringify(doc));
  for(const value of ['{broken',JSON.stringify({version:1,fonts:'bad'}),'x'.repeat(8*1024*1024+1)])assert.equal(mapTextFontAssets(value,()=>{throw new Error('unreachable');}),value);
});
test('a real .lolly file carries the exact font and recomposes after receiver ids and versions change',async()=>{
  const record:BeamAssetRecord={id,type:'font',format:'ttf',version:hash,blob:new Blob([bytes],{type:'font/ttf'}),meta:{name:'SUSE'}};
  const built=await buildLollyFile({toolId:'design',session,userAssets:[record]});assert.equal(built.manifest.counts.assets,1);
  const stored=new Map<string,BeamAssetRecord>(),slots=new Map<string,unknown>();
  const host:BeamPackHost={state:{list:async()=>[...slots.keys()].map(slot=>({slot})),load:async slot=>slots.get(slot)??null,save:async(slot,value)=>{slots.set(slot,value);},delete:async slot=>{slots.delete(slot);}},assets:{_exportUserAssets:async()=>[...stored.values()],_uploadUserAsset:async asset=>{stored.set(asset.id,asset);},_getUserRecord:async id=>stored.get(id)??null,_deleteUserAsset:async asset=>{stored.delete(asset);}}};
  const imported=await ingestLollyFile(await built.blob.arrayBuffer(),host),received=JSON.parse((imported.session as typeof session).textDocument) as TextDocumentV1,font=received.fonts[0]!;
  assert.equal(font.source.kind,'asset');const dependency=decodeAssetVersion(font.source.kind==='asset'?font.source.id:'');assert.notEqual(dependency.id,id);
  const landed=stored.get(dependency.id)!;assert.ok(landed);assert.equal(dependency.pin!.version,landed.version);assert.deepEqual(new Uint8Array(await landed.blob!.arrayBuffer()),new Uint8Array(bytes));
  const parser=new (new JSDOM('').window.DOMParser)(),frames=[{...defaultTextFrameSettings(),id:'frame',storyId:'story',width:500,height:200}];
  const before=await createTextCompositionAPI(async()=>bytes,s=>parser.parseFromString(s,'image/svg+xml')).layoutRuns({document:doc,storyId:'story',frames,includeSvg:true});
  const after=await createTextCompositionAPI(async font=>{assert.equal(font.source.kind,'asset');const asset=stored.get(decodeAssetVersion(font.source.kind==='asset'?font.source.id:'').id)!;return new Uint8Array(await asset.blob!.arrayBuffer());},s=>parser.parseFromString(s,'image/svg+xml')).layoutRuns({document:received,storyId:'story',frames,includeSvg:true});
  assert.deepEqual(after.lines,before.lines);assert.deepEqual(received.stories,doc.stories);
});
