// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ReferenceCanvasDoc,type CanvasOp } from '@lolly-tools/core/canvas-op-v1';
import { createMockHost } from '@lolly-tools/core';
import { createRuntime } from '../engine/src/runtime.ts';
import { loadTool } from '../engine/src/loader.ts';
import { createTextStory } from '../engine/src/text-story-document.ts';
import { readDesignText,defaultTextFrameSettings } from '../engine/src/text-design.ts';
import { attachCollabPlumbing } from '../shells/web/src/lib/collab-plumbing.ts';
import { createTextSyncProjection,textSyncState,assertTextSyncReady } from '../shells/web/src/lib/text-collab.ts';
const design=JSON.parse(await readFile('community/design/tool.json','utf8'));
const manifest={id:'text-sync-test',name:'Text sync test',version:'1.0.0',engineVersion:'^1.217.0',status:'community',render:{width:420,height:420,formats:['png']},inputs:design.inputs.filter((item:{id:string})=>['boxes','textDocument'].includes(item.id))};
const tool=await loadTool(manifest.id,async path=>path.endsWith('tool.json')?JSON.stringify(manifest):'<div>{{textDocument}}</div>');
function initial(){const story=createTextStory('article','Original\nSecond',i=>`p${i}`);story.frameIds=['frame'];return {textDocument:JSON.stringify({version:1,stories:[story],styles:[],fonts:[]}),boxes:[{id:'frame',kind:'text',text:'',textStory:story.id,textFrame:JSON.stringify(defaultTextFrameSettings()),w:200,h:200,x:0,y:0}]};}
const tick=()=>new Promise<void>(resolve=>setTimeout(resolve,10));
async function peer(id:string,writer=true){const runtime=await createRuntime(tool,createMockHost(),initial());const adapter=new ReferenceCanvasDoc(id),out:CanvasOp[]=[];const plumbing=attachCollabPlumbing(runtime,{adapter,clientId:id,canEdit:()=>writer,onOps:ops=>out.push(...ops),raf:fn=>fn()})!;return {runtime,adapter,out,plumbing,read:()=>Object.fromEntries(runtime.getModel().map(item=>[item.id,item.value])),close(){plumbing.detach();runtime.destroy();}};}
test('real runtimes admit split text/frame deliveries atomically and keep observer writes off the wire',async()=>{
  const a=await peer('text-a'),b=await peer('text-b',false);
  try{
    const values=initial(),doc=JSON.parse(values.textDocument);doc.stories[0].frameIds.push('next');doc.stories[0].revision++;
    const boxes=[...values.boxes,{...values.boxes[0]!,id:'next',x:220}];
    await a.runtime.applyPatch({textDocument:JSON.stringify(doc),boxes});
    const text=a.out.filter(op=>op.k==='param'),frames=a.out.filter(op=>op.k!=='param');assert.ok(text.length&&frames.length);
    b.plumbing.applyRemotePatch(text);await tick();
    assert.equal(b.read().textDocument,values.textDocument);assert.ok(textSyncState(b.runtime).pending);assert.throws(()=>assertTextSyncReady(b.runtime),/still syncing/);
    b.plumbing.applyRemotePatch(frames);await tick();
    assert.equal(textSyncState(b.runtime).pending,'');const settled=readDesignText(b.read().textDocument,b.read().boxes as Record<string,unknown>[]);assert.deepEqual(settled.document.stories[0]!.frameIds,['frame','next']);
    assert.deepEqual(b.read(),a.read());const before=b.read();await b.runtime.applyPatch({textDocument:values.textDocument});assert.deepEqual(b.read(),before);assert.equal(b.out.length,0);
  }finally{a.close();b.close();}
});
test('concurrent source changes converge and retain both literal versions for local recovery',async()=>{
  const a=await peer('text-c'),b=await peer('text-d');
  try{
    for(const [target,source]of [[a,'Local **literal**'],[b,'Remote NBSP\u00a0copy']] as const){const doc=JSON.parse(String(target.read().textDocument));doc.stories[0]={...createTextStory('article',source,i=>`new${i}`),frameIds:['frame'],revision:1};await target.runtime.setInput('textDocument',JSON.stringify(doc));}
    a.plumbing.applyRemotePatch(b.out);b.plumbing.applyRemotePatch(a.out);await tick();
    assert.equal(a.read().textDocument,b.read().textDocument);
    for(const target of [a,b]){const sources=[String(target.read().textDocument),...textSyncState(target.runtime).recoveries.map(item=>String(item.values.textDocument))].join('\n');assert.match(sources,/Local \*\*literal\*\*/);assert.match(sources,/Remote NBSP/);}
  }finally{a.close();b.close();}
});
test('malformed ownership remains recoverable, and a complete later projection clears the hold',async()=>{
  const target=await peer('text-e');try{const policy=createTextSyncProjection(target.runtime)!;const values=initial(),doc=JSON.parse(values.textDocument);doc.stories[0].frameIds=['missing'];assert.equal(policy.validate({textDocument:JSON.stringify(doc)},[]),false);assert.ok(textSyncState(target.runtime).recoveries.length);assert.equal(policy.validate(values,[]),true);assertTextSyncReady(target.runtime);}finally{target.close();}
});
