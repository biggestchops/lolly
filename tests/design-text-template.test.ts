// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { createMockHost } from '@lolly-tools/core';
import { evaluateDesignTool, type DesignToolDefinitionV1 } from '@lolly-tools/core/design-tool-v1';
import { createNodeHookExecutor } from '@lolly-tools/node-shell/hook-worker';
import { compileDesignTool } from '../engine/src/design-tool/compiler.ts';
import { loadTool } from '../engine/src/loader.ts';
import { createRuntime } from '../engine/src/runtime.ts';
import { upgradeDesignText } from '../engine/src/text-design.ts';
import * as resolverModule from '../engine/src/text-styles.ts';
import { parseTextDocument } from '../engine/src/text-story-document.ts';
import { createTextCompositionAPI } from '../packages/node-shell/src/text-composition.ts';

const bytes = await readFile('shells/web/public/fonts/SUSE[wght].ttf');
const source = await readFile('community/design/assets/rules-renderer.js', 'utf8');
const parser = new (new JSDOM('').window.DOMParser)();
function definition(): DesignToolDefinitionV1 {
  const initial = upgradeDesignText('', [{id:'title',kind:'text',text:'',x:0,y:0,w:420,h:140}], 'title', {
    storyId:'story',source:'Authored title',character:{font:'sans',size:32,weight:400,color:'#112233'},
    fonts:[{id:'sans',family:'SUSE',sha256:createHash('sha256').update(bytes).digest('hex'),faceIndex:0,source:{kind:'embedded',base64:bytes.toString('base64')}}],
  });
  return {schemaVersion:1,compilerVersion:1,rendererDigest:'fixture',css:'',dependencies:[],id:'composed-template',name:'Composed template',version:'1.0.0',presentation:'sidebar',formats:['svg','png','pdf'],defaultVariant:'main',variants:[{id:'main',label:'Main',width:420,height:140,background:'#ffffff',boxes:initial.boxes,textDocument:parseTextDocument(initial.textDocument)}],inputs:[{input:{id:'heading',type:'longtext',label:'Heading',default:'Authored title',maxLength:2000},targets:[{variantId:'main',layerId:'title',property:'text'}]}],choices:[],recipes:[]};
}
for (const isolated of [false,true]) test(`composed generated tools keep embedded fonts, literal source and export receipts in ${isolated?'strict workers':'ordinary hooks'}`,async()=>{
  const d=definition(),compiled=compileDesignTool(d,{source,styles:''});
  const tool=await loadTool(d.id,async path=>String(compiled.files[path.slice(d.id.length+1)]??''),isolated?{trustClass:'sideloaded-consented'}:{});
  const host=createMockHost();
  host.text={...host.text!,...createTextCompositionAPI(async font=>{
    assert.equal(font.source.kind,'embedded');
    return Buffer.from(font.source.kind==='embedded'?font.source.base64:'','base64');
  },source=>parser.parseFromString(source,'image/svg+xml'))};
  host.export.checkLayout=async()=>({ok:true,issues:[]});let exports=0;
  host.export.render=async()=>{exports++;return new Blob(['svg']);};
  const runtime=await createRuntime(tool,host,{heading:'Office **literal**\r\nÉclair\u2028next'},isolated?{hookExecutor:createNodeHookExecutor({strict:true})}:{});
  try{
    assert.deepEqual(runtime.hookErrors,[]);
    const old=new JSDOM(runtime.getHydrated()).window.document.body;
    assert.match(old.querySelector('title')!.textContent!,/Office \*\*literal\*\*\r\nÉclair\u2028next/);
    await runtime.export(old,'svg',{c2pa:false});assert.equal(exports,1);
    await runtime.setInput('heading','A changed heading');
    await assert.rejects(()=>runtime.export(old,'svg',{c2pa:false}),/layout is still changing/);
    const current=new JSDOM(runtime.getHydrated()).window.document.body;
    await runtime.export(current,'svg',{c2pa:false});assert.equal(exports,2);
    await assert.rejects(()=>runtime.export(new JSDOM('').window.document.body,'svg',{c2pa:false}),/layout is still changing/);
    await runtime.setInput('heading','Long article with much more content. '.repeat(35));
    await assert.rejects(()=>runtime.export(new JSDOM(runtime.getHydrated()).window.document.body,'svg',{c2pa:false}),/Text export needs attention/);
  }finally{runtime.destroy();}
});
test('template replacement keeps valid paragraph ids and font weight preserves unrelated axes',()=>{
  const d=definition(),story=d.variants[0]!.textDocument!.stories[0]!;
  story.paragraphs[0]!.id='story-field-1';story.paragraphs[0]!.paragraph!.character!.axes={wdth:90};
  d.inputs.push({input:{id:'weight',type:'number',label:'Weight',default:400},targets:[{variantId:'main',layerId:'title',property:'weight'}]});
  const value=evaluateDesignTool(d,{heading:'First\nSecond\nThird',weight:700});
  const doc=parseTextDocument(value.variant.textDocument);assert.equal(new Set(doc.stories[0]!.paragraphs.map(p=>p.id)).size,3);
  assert.deepEqual(doc.stories[0]!.paragraphs[0]!.paragraph!.character!.axes,{wdth:90});
  assert.equal(doc.stories[0]!.paragraphs[0]!.paragraph!.character!.weight,700);
});

test('template weight overrides inherited variation coordinates without erasing unrelated axes',()=>{
  const d=definition(),doc=d.variants[0]!.textDocument!,story=doc.stories[0]!;
  doc.styles=[{id:'body',name:'Body',kind:'paragraph',character:{axes:{wght:300,wdth:90}}},{id:'emphasis',name:'Emphasis',kind:'character',character:{axes:{wght:500,slnt:5}}}];
  story.defaultStyle='body';story.spans=[{start:0,end:8,style:'emphasis'}];
  d.inputs.push({input:{id:'weight',type:'number',label:'Weight',default:400},targets:[{variantId:'main',layerId:'title',property:'weight'}]});
  const result=evaluateDesignTool(d,{weight:700});
  const output=parseTextDocument(result.variant.textDocument),{textStyleResolver}=resolverModule;
  assert.deepEqual(textStyleResolver(output).character(output.stories[0]!,output.stories[0]!.paragraphs[0]!,0).axes,{wght:700,wdth:90,slnt:5});
  assert.equal(doc.styles[0]!.character!.axes!.wght,300);
});
